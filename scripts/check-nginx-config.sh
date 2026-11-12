#!/usr/bin/env bash
#
# Validates the edge proxy configuration with the real nginx image (`nginx -t`).
#
# Why this exists: the deploy job runs `nginx -t` then `nginx -s reload`, but only *after* the new
# images are built and the containers replaced. A broken upstream/`resolve`/`add_header` directive
# therefore turns a deploy into a full outage - nginx refuses to start and nothing is served. This
# check moves that failure into CI, where it costs seconds.
#
# The config loads /etc/nginx/certs/{fullchain,privkey}.pem, so throwaway self-signed certificates
# are generated in a temp directory: no real certificate is needed and nothing is written into the
# repository.
#
# Usage: ./scripts/check-nginx-config.sh        (NGINX_IMAGE=... to override the tag)

set -Eeuo pipefail

# Keep in sync with the nginx service in docker-compose.prod.yml: the deploy uses this exact image,
# and `resolve` in an upstream block only exists in nginx >= 1.27.3.
IMAGE="${NGINX_IMAGE:-nginx:1.29-alpine}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONF_DIR="$ROOT/docker/nginx"
SITE_CONF="$CONF_DIR/conf.d/collab.conf"

if [ ! -f "$CONF_DIR/nginx.conf" ] || [ ! -f "$SITE_CONF" ]; then
  echo "::error::expected $CONF_DIR/nginx.conf and $SITE_CONF" >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/certs" "$work/certbot"

openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -keyout "$work/certs/privkey.pem" \
  -out "$work/certs/fullchain.pem" \
  -subj "/CN=collab.example.com" >/dev/null 2>&1

# A refactor can silently drop `resolve` (the config stays valid, but nginx then pins the first app
# IP - the bug that made every redeploy 502), and `resolve` without a resolver is a startup error.
# Assert the pair before parsing, so the failure message names the problem.
if ! grep -q 'resolver[[:space:]]\+127\.0\.0\.11' "$CONF_DIR/nginx.conf"; then
  echo "::error::docker/nginx/nginx.conf no longer sets 'resolver 127.0.0.11' - upstream name resolution needs Docker's DNS" >&2
  exit 1
fi
if ! grep -q 'server app:3000 resolve' "$SITE_CONF" || ! grep -q 'zone collab_app' "$SITE_CONF"; then
  echo "::error::$SITE_CONF must keep 'zone collab_app' + 'server app:3000 resolve' (nginx >= 1.27.3), or a redeploy points at a dead container IP" >&2
  exit 1
fi

echo "nginx -t using $IMAGE"
if ! docker run --rm \
  -v "$CONF_DIR/nginx.conf:/etc/nginx/nginx.conf:ro" \
  -v "$CONF_DIR/conf.d:/etc/nginx/conf.d:ro" \
  -v "$work/certs:/etc/nginx/certs:ro" \
  -v "$work/certbot:/var/www/certbot:ro" \
  "$IMAGE" nginx -t; then
  echo "::error::nginx rejected the configuration - deploying it would leave the edge down" >&2
  exit 1
fi

echo "nginx configuration OK"

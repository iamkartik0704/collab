#!/bin/sh
# =============================================================================
# Daily PostgreSQL backups for docker-compose.prod.yml (service "backup").
#   - pg_dump custom format (compressed, restorable table by table with pg_restore)
#   - written to a temp file, verified with `pg_restore --list`, then renamed (no half files)
#   - keeps BACKUP_RETENTION_DAYS days of dumps (default 14)
#
# Settings (environment):
#   PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE   connection (direct to postgres, not PgBouncer)
#   BACKUP_TIME             daily run time, UTC, HH:MM (default 20:30 = 02:00 IST)
#   BACKUP_RETENTION_DAYS   default 14
#   BACKUP_ON_START         "true" = also take one backup when the container starts
#   BACKUP_RUN_ONCE         "true" = take one backup and exit (manual / CI use)
#
# Restore (into an empty database):
#   pg_restore --clean --if-exists --no-owner -d "$DATABASE" /backups/collab-YYYYMMDD-HHMMSS.dump
# Copy /backups off the host (object storage, another region): a backup on the same disk as the
# database does not survive losing that disk.
# =============================================================================
set -eu

BACKUP_DIR=/backups
BACKUP_TIME="${BACKUP_TIME:-20:30}"
RETENTION="${BACKUP_RETENTION_DAYS:-14}"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) pg-backup: $*"; }

backup() {
  stamp=$(date -u +%Y%m%d-%H%M%S)
  target="$BACKUP_DIR/${PGDATABASE}-${stamp}.dump"
  tmp="$target.partial"
  log "starting dump of ${PGDATABASE}@${PGHOST}"
  if ! pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$tmp"; then
    rm -f "$tmp"
    log "ERROR: pg_dump failed"
    return 1
  fi
  if ! pg_restore --list "$tmp" >/dev/null; then
    rm -f "$tmp"
    log "ERROR: dump failed verification"
    return 1
  fi
  mv "$tmp" "$target"
  log "wrote $target ($(du -h "$target" | cut -f1))"
  find "$BACKUP_DIR" -maxdepth 1 -name "${PGDATABASE}-*.dump" -type f -mtime "+$RETENTION" -print -delete | sed 's/^/pruned /'
  find "$BACKUP_DIR" -maxdepth 1 -name "*.partial" -type f -mmin +120 -delete
}

seconds_until_next_run() {
  now=$(date -u +%s)
  next=$(date -u -d "today $BACKUP_TIME" +%s)
  if [ "$next" -le "$now" ]; then next=$(date -u -d "tomorrow $BACKUP_TIME" +%s); fi
  echo $((next - now))
}

mkdir -p "$BACKUP_DIR"
until pg_isready -q; do log "waiting for postgres"; sleep 5; done

if [ "${BACKUP_RUN_ONCE:-false}" = "true" ]; then
  backup
  exit $?
fi
if [ "${BACKUP_ON_START:-false}" = "true" ]; then backup || true; fi

while true; do
  wait_for=$(seconds_until_next_run)
  log "next backup in ${wait_for}s (daily at ${BACKUP_TIME} UTC, keeping ${RETENTION} days)"
  sleep "$wait_for"
  # A failed night is retried once after 10 minutes, then left for the next day (and the logs).
  backup || { sleep 600; backup || log "ERROR: backup failed twice; will try again tomorrow"; }
done

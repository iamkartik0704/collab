# syntax=docker/dockerfile:1.7
# =============================================================================
# Collab web app (Next.js 15, output: standalone).
#   docker build -t collab-app \
#     --build-arg NEXT_PUBLIC_APP_URL=https://collab.example.com \
#     --build-arg NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_... \
#     --build-arg NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_live_... \
#     --build-arg S3_PUBLIC_BASE_URL=https://cdn.example.com .
# NEXT_PUBLIC_* values are inlined into the bundles at build time; every other variable is read
# at runtime from the environment (validated by src/env.ts at boot).
# Targets: runner (default, the web server) and migrate (one-shot `prisma migrate deploy`).
# =============================================================================
ARG NODE_VERSION=22.20.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- dependencies (cached on the lockfile) ------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ---- build ----------------------------------------------------------------------------
FROM deps AS build
COPY . .
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_RAZORPAY_KEY_ID
ARG S3_PUBLIC_BASE_URL
ARG APP_VERSION=dev
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL} \
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY} \
    NEXT_PUBLIC_RAZORPAY_KEY_ID=${NEXT_PUBLIC_RAZORPAY_KEY_ID} \
    S3_PUBLIC_BASE_URL=${S3_PUBLIC_BASE_URL} \
    APP_VERSION=${APP_VERSION} \
    SKIP_ENV_VALIDATION=1
RUN test -n "$NEXT_PUBLIC_APP_URL" || (echo "NEXT_PUBLIC_APP_URL build arg is required" && exit 1)
RUN npm run build

# ---- migrations (one-shot job; needs the Prisma CLI from devDependencies) -------------
FROM deps AS migrate
COPY prisma ./prisma
COPY scripts/check-migrations.ts ./scripts/check-migrations.ts
USER node
CMD ["sh", "-c", "npx tsx scripts/check-migrations.ts && npx prisma migrate deploy"]

# ---- runtime --------------------------------------------------------------------------
FROM base AS runner
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    APP_VERSION=${APP_VERSION}
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health?live=1').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.js"]

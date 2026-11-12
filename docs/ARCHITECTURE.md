# Collab — Architecture & Project Structure

Collab is a single Next.js 15 application (storefront, customer account, admin portal, API) plus one BullMQ worker process. Both share the same `src/` code, Prisma schema and environment contract. One repository and one `package.json` keep the shared domain code, Zod schemas and types in one place. The app and the worker build into separate container images.

```
             ┌────────────┐     ┌──────────────────────────────┐     ┌───────────────┐
 browser ──▶ │ nginx (TLS)│ ──▶ │ app ×2 (Next.js standalone)  │ ──▶ │ PgBouncer ─▶  │
             └────────────┘     │  RSC pages · Route Handlers  │     │ PostgreSQL 16 │
                                │  SSE (inventory, AI chat)    │     │ pgvector      │
                                │  webhooks (Stripe, Razorpay, │     └───────▲───────┘
                                │  WhatsApp)                   │             │
                                └──────┬──────────────┬────────┘             │
                     cache · locks ·   │              │ presigned POST /     │
                     limits · pub/sub  ▼              ▼ private PDFs         │
                                ┌─────────────┐  ┌──────────────┐  ┌─────────┴───────────────┐
                                │  Redis 7    │◀─│ S3 / R2      │◀─│ worker (BullMQ)          │
                                │  AOF        │  │ (MinIO dev)  │  │ notifications · invoices │
                                └─────────────┘  └──────────────┘  │ refunds · RAG indexing   │
                                                                   │ reservations · analytics │
                                                                   └──────────┬───────────────┘
                                                      Resend/SMTP · WhatsApp Cloud API ·
                                                      Anthropic Messages API · Voyage AI
```

## Build phases

| Phase | Scope |
|---|---|
| **1 — Foundation** ✅ | Directory tree, Prisma schema, `package.json`, `tsconfig.json`, `.env.example`, `src/env.ts`, `src/lib/db.ts`, `src/lib/redis/*` |
| **2 — Backend services & APIs** ✅ | Auth.js v5 (Google + email/WhatsApp OTP), rotating refresh tokens, RBAC + security-header middleware, atomic inventory reservation/release (FOR UPDATE + Redis locks + BullMQ expiry + sweeper), server-side cart/coupons/pricing, idempotent checkout, Stripe/Razorpay webhooks with HMAC + replay protection, migrations, reference seed, dev `docker-compose.yml`. |
| **3 — Storefront UI** ✅ | Design tokens, header with live search, home, URL-synced faceted catalog + `/deals`, product page, cart, 3-step checkout (Stripe Payment Element / Razorpay), `/login`, `/wishlist`, `/account`, `/support`. Demo catalogue seed + generated artwork. |
| **4 — Admin portal** ✅ | `/admin` shell + RBAC nav; executive dashboard (KPIs, charts, alerts); products list + multi-variant SKU builder (`/admin/products/new`, `/admin/products/[id]`) with direct-to-bucket image uploads; Inventory Control Center (live SSE table, optimistic-concurrency adjust dialog, low-stock thresholds, append-only movements log + CSV export); orders list/detail (state-machine transitions, tracking, partial/full refunds, refund retry); coupon manager; audit-log viewer (field diffs, CSV export). Seeded staff accounts + 90 days of demo orders. MinIO in dev compose. Playwright e2e suite. |
| **5 — Worker, notifications & AI** ✅ | BullMQ consumers for notifications (Resend/SMTP email via React Email, WhatsApp Cloud API templates, delivery receipts webhook, opt-out), GST PDF invoices (`@react-pdf/renderer`, private storage, attached to confirmation emails, downloadable), refund execution, analytics rollups, RAG indexing; AI support agent (Claude, streaming tool-use loop, pgvector RAG + full-text fallback, order lookup with ownership checks, human escalation) with a storefront chat widget and an admin support inbox (takeover, reply, resolve). |
| **6.1 — Production hardening** ✅ | Product-level HSN / GST-rate overrides; optional buyer GSTIN at checkout (checksum-validated) printed on invoices; sequential GST credit notes for every successful refund; device serial / IMEI capture at Packed / Shipped printed on invoices; customer order page with return / replacement / warranty (RMA) requests and admin approve / reject; abandoned-cart reminder job; hardened guest order lookup in the AI agent; `npm run ai:reindex` + admin "rebuild" button (pgvector backfill incl. `Product.embedding`); `pgsty/silo` in dev; pinned image whitelist; daily `pg_dump` backups. |
| **6 — Delivery** ✅ | `Dockerfile` (app + migrate targets), `Dockerfile.worker`, `docker-compose.prod.yml`, nginx (TLS 1.3, rate-limit zones, SSE passthrough, static caching), `/api/health`, ESLint flat config, Vitest unit tests, GitHub Actions CI/CD (lint · types · migration guard · unit · e2e · GHCR images · Trivy · SSH deploy · smoke test). |

## Directory tree

```
collab_web/
├── .github/workflows/ci-cd.yml        lint · tsc · migration guard · vitest · playwright · buildx/GHCR · trivy · deploy
├── docker/nginx/nginx.conf            TLS 1.3, gzip, rate-limit zones, JSON access log
├── docker/nginx/conf.d/collab.conf    upstream app ×N, SSE locations, webhook passthrough, static caching
├── docs/ARCHITECTURE.md
├── prisma/
│   ├── schema.prisma
│   ├── migrations/                    generated + hand-written SQL (constraints, HNSW, triggers, invoice sequence)
│   ├── seed.ts · catalog-data.ts      reference data + demo catalogue
│   └── seed-demo.ts                   staff accounts + 160 deterministic demo orders (90 days)
├── docker/backup/pg-backup.sh         daily pg_dump (verified, atomic rename, retention)
├── scripts/
│   ├── check-migrations.ts            fails if a migration drops protected hand-written SQL
│   ├── ai-reindex.ts                  `npm run ai:reindex`: rebuild RAG index + backfill embeddings
│   ├── generate-product-art.ts
│   └── prepare-standalone.mjs         postbuild: copies static assets into .next/standalone
├── src/
│   ├── env.ts                         validated environment (server + client)
│   ├── middleware.ts                  CSRF origin check, auth gate, RBAC, CSP nonce, request id
│   ├── app/
│   │   ├── (storefront)/              home, catalog, products, cart, checkout, account, support (+ chat widget)
│   │   │   └── account/orders/[orderNumber]   order detail, invoice / credit notes, RMA requests
│   │   ├── admin/
│   │   │   ├── page.tsx               executive dashboard
│   │   │   ├── products/ · products/new · products/[id]
│   │   │   ├── inventory/ · inventory/movements
│   │   │   ├── orders/ · orders/[orderNumber]
│   │   │   ├── support/ · support/[sessionId]
│   │   │   ├── coupons/
│   │   │   └── audit-log/
│   │   └── api/
│   │       ├── admin/{products,uploads,inventory,orders,refunds,coupons,alerts,audit-log,support}/…
│   │       ├── ai/chat/route.ts       POST → SSE stream; GET → transcript
│   │       ├── orders/[orderNumber]/invoice/route.ts · credit-notes/[creditNoteId]/route.ts
│   │       ├── account/orders/[orderNumber]/returns/route.ts
│   │       ├── admin/returns/[id]/route.ts · admin/ai/reindex/route.ts
│   │       ├── webhooks/{stripe,razorpay,whatsapp}/route.ts
│   │       └── health/route.ts        liveness (?live=1) + readiness (Postgres, Redis)
│   ├── components/admin/{dashboard,products,inventory,orders,coupons,audit,support}/
│   ├── components/chat/support-chat.tsx
│   ├── emails/                        React Email templates (order updates, OTP, staff alerts)
│   ├── invoices/invoice-document.tsx  react-pdf GST invoice
│   ├── lib/                           db, redis, auth, security, storage (S3), realtime (inventory pub/sub), api client
│   ├── queues/index.ts                queue names, Zod job payloads, producers
│   ├── schemas/                       shared Zod schemas (forms + route handlers)
│   ├── server/
│   │   ├── admin/                     products, inventory, orders, coupons, analytics, audit
│   │   ├── ai/                        agent, tools, guardrails, rag, embeddings, chat.service, knowledge/policies.ts
│   │   ├── invoices/invoice.service.ts    tax invoices + GST credit notes
│   │   ├── returns/return.service.ts      RMA eligibility, requests, decisions
│   │   ├── marketing/abandoned-cart.service.ts
│   │   ├── notifications/{notify,render}.ts
│   │   └── cart/ catalog/ coupons/ inventory/ orders/ payments/ webhooks/ …
│   ├── services/{email,whatsapp}.service.ts
│   └── workers/                       index (process), runtime (DLQ wiring), inventory, notifications,
│                                      payments, ai, analytics, documents, marketing
├── tests/unit/                        Vitest: guardrails, invoice maths, chunking, CSV, schemas
├── tests/e2e/                         Playwright: access control, dashboard, SKU builder, inventory (SSE),
│                                      orders/refunds, coupons + audit log, support hand-off
├── Dockerfile · Dockerfile.worker · .dockerignore
├── docker-compose.yml                 dev: Postgres+pgvector, PgBouncer, Redis, Silo/MinIO (+ bucket init)
├── docker-compose.prod.yml            nginx, app ×2, worker, migrate (one-shot), Postgres, PgBouncer, Redis, backup
├── eslint.config.mjs · vitest.config.ts · playwright.config.ts
├── tsconfig.json · tsconfig.worker.json   (worker: automatic JSX runtime for tsx)
└── next.config.ts · postcss.config.mjs · package.json
```

## Local development

```bash
docker compose up -d                       # Postgres, PgBouncer, Redis, Silo (+ creates the bucket)
cp .env.example .env                       # fill in; see the MinIO block in .env.example
npm ci
npm run db:deploy && npm run db:seed       # schema + catalogue + staff + demo orders
npm run dev                                # http://localhost:3000
npm run worker:dev                         # separate terminal: notifications, refunds, RAG, rollups
```

Staff sign in with the email OTP flow. Seeded accounts: `admin@collab.example.com` (super admin), `inventory@collab.example.com` (inventory manager), `support@collab.example.com` (support agent); override with `SEED_*_EMAIL`. With `EMAIL_PROVIDER=log` / `NOTIFICATIONS_DRY_RUN=true` the worker prints emails (including OTP codes) to its log instead of sending them; both settings are refused when `NODE_ENV=production` unless `ALLOW_DRY_RUN_IN_PRODUCTION=1` (test builds only).

Object storage: MinIO stopped publishing community images, so the dev compose uses `pgsty/silo:RELEASE.2026-11-09T00-00-00Z`, the actively patched community successor of `pgsty/minio` (same S3 API, data format and `MINIO_*` settings; the server binary is `silo`, and `mc` is included). Console: http://localhost:9001. `next/image` only accepts images from `S3_PUBLIC_BASE_URL` (host, port and path prefix pinned) and, for path-style endpoints, the bucket on `S3_ENDPOINT`.

## Phase 2 — how the backend fits together

**Tokens.** The Auth.js JWT session cookie is the *access token*. Its `accessExp` claim (15 min) decides validity. A separate rotating *refresh token* (`collab.rt`, HttpOnly, SameSite=Lax, `Path=/api/auth`, only its HMAC is stored) re-issues the access token at `/api/auth/refresh`, re-reading role and active status from the database each time. Reusing a rotated token revokes its whole family. Logout and bans also set a Redis "revoked-before" marker, so outstanding access tokens die immediately.

**Request path.** The middleware (Node runtime, no database) runs these checks in order:
1. CSRF origin check on state-changing `/api` calls.
2. Authentication gate for `/account`, `/checkout` and `/admin`.
3. Permission-based RBAC (`src/lib/auth/rbac.ts`). Staff without the specific permission are sent to `/admin?denied=1`.
4. A per-request nonce CSP plus security headers.

Route handlers re-check with `requireUser()` / `requirePermission()`; admin pages with `requireAdminPage()`.

**Stock.**
- `reserveStock` → `consumeReservations` (verified payment) or `releaseReservations` (expiry, failure or cancel).
- Rows are locked with `SELECT … FOR UPDATE`, ordered by `variantId` so concurrent checkouts can't deadlock.
- Redis locks serialise per user (`checkout:{userId}`) and per order (`order:{orderId}`); the order row lock is authoritative if Redis is down.
- BullMQ runs `release-expired-reservation` (delayed 15 min) plus a one-minute sweeper.
- A payment that arrives after expiry re-acquires stock if it is still available, otherwise the order is cancelled and refunded automatically.

**Money.** Clients send only `{ variantId, quantity, couponCode }` and checkout ids. `priceCart` computes GST-inclusive prices, coupons, shipping and totals from PostgreSQL. Coupon uses are reserved with the order and released with the stock.

**Webhooks.** The raw body is HMAC-verified: Stripe `constructEvent` with a 5-minute tolerance, Razorpay hex HMAC-SHA256, WhatsApp `X-Hub-Signature-256`, all compared in constant time. Each event is then claimed once in `ProcessedWebhook` (duplicate → 200, failed → reclaimable on retry) and dispatched to idempotent handlers. WhatsApp sends no event id, so the body hash is the claim key.

**Migrations.** `npm run db:migrate` generates the migration, then runs `scripts/check-migrations.ts`. That guard fails if Prisma tries to drop the hand-written HNSW indexes, partial indexes, CHECK constraints or append-only triggers. CI runs the same guard; the `migrate` image runs it before `prisma migrate deploy`.

## Phase 4 — admin portal

| Area | How it works |
|---|---|
| Roles | `SUPPORT_AGENT` (dashboard, orders read, support inbox), `INVENTORY_MANAGER` (+ catalogue, inventory, fulfilment), `SUPER_ADMIN` (+ refunds, coupons, audit log). Nav items are filtered by permission; every page and route re-checks. |
| Audit | Every mutation writes `AdminAuditLog` **in the same transaction** (actor, role, IP, user agent, request id, before/after, top-level diff). The table rejects UPDATE/DELETE (trigger). `/admin/audit-log` filters by action, entity, actor and date; CSV export neutralises spreadsheet formulas. |
| SKU builder | Colour × storage × RAM matrix; edited rows survive option changes (keyed by option combination); dropped existing SKUs are archived, not deleted. Regeneration compares the current option sets with the initial ones (idempotent under React Strict Mode's double effects) so an existing sparse matrix is never densified on mount. Opening stock is a `RESTOCK` movement. Images go browser → bucket via presigned POST (exact key, type and size pinned). |
| Inventory | `/admin/inventory` renders server-side, then an `EventSource` on `/api/admin/inventory/stream` patches rows as stock commits (Redis pub/sub fan-out; events carry `InventoryItem.version`, so out-of-order events never move a row backwards). Falls back to 15 s polling when the feed is unavailable. The adjust dialog pins the row version when it opens and sends `expectedVersion`; a concurrent change returns 409 and shows the latest numbers. |
| Orders | Transitions follow `ORDER_TRANSITIONS`; each runs under the per-order Redis lock + row lock. Shipping requires tracking. Cancelling a paid order before dispatch restocks and refunds (super admin only). Refunds are idempotent per `Idempotency-Key`, split per line with floor-telescoping so partial refunds never exceed the line, and execute asynchronously (retry button for stuck ones). |
| Dashboard | `DailyMetric` rollups (IST days) plus live queries; cached 60 s in Redis; the worker refreshes rollups every 15 minutes. |

## Phase 5 — worker, notifications, invoices, AI

### Queues

| Queue | Jobs | Failure handling |
|---|---|---|
| `inventory` | `release-expired-reservation` (delayed), `sweep-expired-reservations` (every minute) | DLQ → `WEBHOOK_FAILURE` alert |
| `documents` | `issue-credit-note` (queued when a refund turns SUCCEEDED), `sweep-credit-notes` (hourly backfill) | DLQ → `PAYMENT_ANOMALY` alert |
| `marketing` | `abandoned-cart-reminders` (every 15 min) | DLQ alert |
| `notifications` | `deliver` (email or WhatsApp per `NotificationLog`) | 5 attempts, exponential backoff from 3 s; permanent provider errors stop immediately; a retry whose previous attempt is still `SENDING` stops instead of re-sending (WhatsApp has no idempotency key) and raises an `ambiguous-delivery` alert; DLQ marks the log `DEAD_LETTERED` + `NOTIFICATION_DEAD_LETTER` alert |
| `payments` | `execute-refund` | provider call is idempotent per refund; DLQ → `PAYMENT_ANOMALY` alert; admins can re-queue |
| `ai` | `reindex-product` (debounced 30 s after a product save), `reindex-all` (nightly 02:30 IST and on an empty index) | DLQ alert |
| `analytics` | `rollup-daily-metrics` (every 15 min) | DLQ alert |

All consumers share `src/workers/runtime.ts` (concurrency, logging, dead-letter alerts). Failed jobs stay in Redis for 7 days. The process drains in-flight jobs on SIGTERM (30 s budget; `tini` in the image forwards signals).

### Notifications

`queueNotification()` writes a `NotificationLog` row first, then enqueues a job keyed by its id. Delivery is at-least-once, made duplicate-safe by claiming the row (`QUEUED`/`FAILED` → `SENDING`) **before** the provider call: a log already `SENT` is skipped, and a retry that finds the row `SENDING` inside the 15-minute lease reports `outcome-unknown` and raises an alert instead of sending again, because the earlier attempt may already have been accepted. Resend also receives the log id as its idempotency key; WhatsApp has no such mechanism, so an ambiguous outcome is escalated to a human rather than retried. OTP codes older than their TTL are never delivered, and codes are redacted from the log payload. Order emails are rendered from the live order (items, totals, tracking) with React Email. WhatsApp uses approved templates; delivery receipts (`sent → delivered → read`, or `failed`) arrive on `/api/webhooks/whatsapp` and never move a message backwards; an inbound `STOP` opts the customer out.

WhatsApp templates to register in WhatsApp Manager (language `en`, body parameters in this order):

| Template | Category | Parameters |
|---|---|---|
| `collab_login_otp` | Authentication | `{{1}}` code (+ copy-code button) |
| `collab_order_confirmed` | Utility | name, order number, total |
| `collab_order_shipped` | Utility | name, order number, carrier, tracking number |
| `collab_out_for_delivery` / `collab_order_delivered` | Utility | name, order number |
| `collab_refund_issued` | Utility | name, amount, order number |
| `collab_low_stock_alert` | Utility | SKU, product, available, threshold |
| `collab_support_escalation` | Utility | ticket number, priority, subject |
| `collab_cart_reminder` | Marketing | name, item summary |

### GST invoices

Issued once per paid order on first use (confirmation email or download). Numbers come from the `invoice_number_seq` PostgreSQL sequence as `INV/<financial year>/<serial>` and are claimed with a conditional update, so concurrent requests agree. CGST + SGST when the delivery state equals `INVOICE_SELLER_STATE`, otherwise IGST. PDFs are stored privately under `invoices/<orderNumber>/` and re-rendered from the order snapshot if the object is missing. `GET /api/orders/:orderNumber/invoice` serves the owner or staff with `orders:read` (404 otherwise, so order numbers are not enumerable). `@react-pdf/renderer` is always loaded with `import()` because parts of it are ESM-only. `next.config.ts` declares `outputFileTracingIncludes` for `/api/orders/**`: pdfkit loads its built-in font metrics through dynamic requires that `@vercel/nft` cannot trace, so without it the standalone image ships without `pdfkit/js/standard-fonts` and every invoice render fails.

### Live inventory across containers

Every committed stock change publishes an `InventoryEvent` on the Redis channel `collab:events:inventory` from the shared inventory code (`applyChange` → post-commit effect → `redis.publish`), so changes made in the **worker** container (reservation expiry, sweeper, refund restocks) and in webhook handlers reach every web replica. Each web process holds one `ioredis` subscriber connection and fans messages out to its open SSE streams (an in-process emitter is used only for that local fan-out). Responses carry `X-Accel-Buffering: no`, and nginx disables `proxy_buffering` on `/api/admin/inventory/stream` and `/api/ai/chat`.

### GST documents, serials and returns

- **HSN / GST rate**: per product (`Product.hsnCode`, `Product.gstRateBps`) with the category as default (`Category.hsnCode`, `Category.taxRateBps`, default 1800 = 18%). Pricing and the order-line snapshot use the product value when set; invoices print the HSN on every line (falling back to the current product/category HSN for older lines).
- **Buyer GSTIN**: optional at checkout ("Buying for a business?"), validated with the GSTN mod-36 check character, stored on `Order.customerGstin` (DB CHECK on the format) and printed on invoices and credit notes.
- **Credit notes**: `ensureCreditNote(refundId)` issues `CN/<FY>/<serial>` from `credit_note_number_seq` once per successful refund (`CreditNote.refundId` unique), referencing the original invoice (issued first if needed). GST is reversed in proportion to the GST charged on the goods and never beyond what remains on the invoice; CGST/SGST vs IGST follows the invoice. Downloadable by the customer and staff.
- **Failed refunds are reversible**: an item-mode refund decrements `OrderItem.refundedQuantity` and (with restock) returns units to the shelf inside the transaction that creates the `PENDING` refund, before the provider call. `Refund.lines` / `Refund.restocked` record exactly what moved, so a provider `FAILED` gives the quantities back and reverses the restock in the same transaction as the status transition (`unrestockUnits`, clamped to on-hand stock and logged as `MANUAL_ADJUSTMENT` / `SYSTEM_CORRECTION`; an incomplete reversal raises `PAYMENT_ANOMALY` instead of failing the transition).
- **Serial / IMEI**: entered per unit in the Packed / Shipped dialog (`OrderItem.serialNumbers`); 15-digit IMEIs must pass the Luhn check; duplicates within an order are rejected. Recording serials drops the stored invoice PDF so the next download re-renders it with the serials (same invoice number).
- **Returns (RMA)**: `/account/orders/[orderNumber]` lets the customer raise a return or replacement (within 7 days of delivery) or a warranty request (within the product's warranty), with a reason and a defect description. One open request per unit; staff approve or reject on the admin order page (audited). Approval does not move money or stock by itself: refunds and restocking stay behind the existing refund flow and `refunds:issue`.

### Abandoned-cart reminders

Signed-in carts idle for 2+ hours (and active within the last 7 days) that still hold something buyable get **one** reminder: the cart is claimed with a conditional update before anything is queued, and the flag resets only when a purchase empties the cart. Email requires `abandonedCartReminder` (default on); WhatsApp requires an explicit marketing opt-in; a STOP reply on WhatsApp (`NotificationPreference.whatsappOptOutAt`) suppresses the WhatsApp reminder only, so the email still goes out unless email cart reminders are off; customers who paid since their last cart activity are skipped. Guest carts have no contact details and are never reminded.

### AI support agent

- **Loop** (`src/server/ai/agent.ts`): manual streaming tool-use loop on the Messages API, model from `AI_CHAT_MODEL` (default `claude-sonnet-5-5`), `effort: low` for chat latency, up to 6 tool rounds per turn. Server-side refusal fallbacks (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) are enabled for models that support them; a final refusal becomes a polite hand-off line.
- **History** is append-only: every API turn's exact content blocks (thinking, tool_use, fallback, tool_result) are stored in `ChatMessage.apiContent` and replayed unchanged. A turn interrupted between tool_use and tool_result is closed with error results instead of being edited away.
- **Caching**: frozen system prompt + fixed tool list (cache breakpoint), per-customer context in a second system block, conversation cached by top-level automatic caching.
- **Tools** (`tools.ts`): `search_help_center` (RAG), `search_products` (live prices/stock), `get_order_status`, `list_my_orders`, `escalate_to_human`. Tools authorise from the session, never from model input: signed-in customers see only their own orders. Guests must give BOTH the order number AND the order's email or phone (there is no lookup by contact details alone); the proof check runs before any database read, so replies never reveal whether an order number exists, and guest lookups are limited to 8 per chat per 15 minutes. Results carry the delivery city only - never street address, landmark, PIN code or phone. Inputs are validated with Zod (eager input streaming disables server-side validation).
- **Reindex**: `npm run ai:reindex` (or the "Rebuild & backfill embeddings" button in `/admin/support`, super admins, `ai:manage`) rebuilds the index and backfills embeddings for every chunk and `Product.embedding` that lacks one. Run it once after adding the production `VOYAGE_API_KEY`; it exits non-zero while embeddings are missing.
- **RAG** (`rag.ts`): products + policy documents (`knowledge/policies.ts`, keep in sync with `/support`) chunked to ≤1.6k chars, embedded with Voyage (`voyage-3.5`, 1024 dims, query/document input types), searched with pgvector cosine distance (HNSW). Unchanged chunks are not re-embedded (sha256). Without working embeddings, search falls back to PostgreSQL full-text ranking.
- **Guardrails** (`guardrails.ts`): control/bidi characters stripped, 2,000-char messages, 40 customer turns per session, prompt-injection heuristics flag the session for review, card numbers and OTPs removed before they reach the model or logs. Signed-in users get 20 messages / 10 min; guests get 10 / 10 min keyed on the **client IP**, not the guest cookie (the server mints a fresh cookie on demand, so a cookie key would be trivially resettable). The transcript `GET` is limited per IP so the widget's polling cannot be turned into an unauthenticated database loop.
- **Hand-off**: `escalate_to_human` opens a `SupportTicket`, marks the session `ESCALATED`, raises an alert and emails `ADMIN_ALERT_EMAILS`. In `/admin/support` an agent takes over (`HUMAN_TAKEOVER`, audited as `CHAT_TAKEOVER`), replies in the customer's widget (it polls during a hand-off), hands back to the assistant or resolves (closes the ticket and acknowledges the alert).

## Phase 6 — delivery

| Piece | Notes |
|---|---|
| `Dockerfile` | node 22 bookworm-slim; `deps` → `build` (`NEXT_PUBLIC_*` + `S3_PUBLIC_BASE_URL` as build args; inlined at build time) → `runner` (standalone server, non-root, healthcheck on `/api/health?live=1`). `migrate` target runs the migration guard then `prisma migrate deploy`. |
| `Dockerfile.worker` | production dependencies + generated Prisma client + `src/`; runs `tsx --tsconfig tsconfig.worker.json` under `tini`, non-root. |
| Backups | service `backup` runs `docker/backup/pg-backup.sh`: daily `pg_dump -Fc` at `BACKUP_TIME` (UTC, default 20:30 = 02:00 IST) into `./backups`, verified with `pg_restore --list`, atomic rename, `BACKUP_RETENTION_DAYS` (default 14). Restore: `pg_restore --clean --if-exists --no-owner -d <db> <file>`. Sync `./backups` off the host. |
| `docker-compose.prod.yml` | nginx → app ×2 (read-only root fs, dropped capabilities) and worker on both `edge` and the internal `backend` network (it must reach provider APIs: email, WhatsApp, payments, object storage, AI); `migrate` must complete before app/worker start; Postgres tuned for PgBouncer transaction pooling; Redis AOF + `noeviction` + password. Object storage is external (S3/R2). |
| nginx | TLS 1.3, HSTS, gzip, per-IP rate-limit zones (general, auth, checkout, AI), SSE locations without buffering, immutable caching for `/_next/static`, webhooks never rate limited, `X-Real-IP` from the TCP peer (the app trusts only that header). The upstream uses `zone` + `resolve` against Docker DNS (127.0.0.11, 10 s TTL) so a redeploy re-resolves the replicas instead of pinning the first IP, and the deploy job runs `nginx -t` + `nginx -s reload`. HSTS is repeated in any location that sets its own `add_header` (nginx does not inherit it). Keep every `proxy_set_header` at server level — nginx drops them in any location that declares its own. |
| Certificates | `certbot` runs under the `tools` profile: its state lives in `docker/letsencrypt` (mounted whole, because `live/` symlinks into `archive/`) and a `--deploy-hook` copies the live pair into `docker/nginx/certs`, which is where nginx reads `fullchain.pem` / `privkey.pem`. Renew, then `docker compose exec nginx nginx -s reload`. Back up `docker/letsencrypt`. |
| CI/CD | quality (lint, types, migration guard, unit + coverage, audit), nginx config (`scripts/check-nginx-config.sh`: `nginx -t` with the production image and throwaway certs, gating the image build) and e2e (Postgres + Redis services, build for the test origin, seeded DB, Playwright) on every push/PR; on `main`: build + push app/migrate/worker images to GHCR, Trivy (fail on fixable HIGH/CRITICAL), SSH deploy (`pull` + `up -d`), health-check smoke test. |

## Testing

| Suite | Command | Notes |
|---|---|---|
| Unit | `npm test` | Vitest, pure logic only (no network/DB). |
| E2E | `APP_URL=http://localhost:3100 NEXT_PUBLIC_APP_URL=http://localhost:3100 ALLOW_DRY_RUN_IN_PRODUCTION=1 npm run build && npm run test:e2e` | Serves `.next/standalone` on port 3100 against the dev compose stack with the seed applied. Global setup mints Auth.js session cookies for the seeded staff (no inbox needed); everything after login goes through the real middleware and permission checks. `E2E_DEV=1` runs against `next dev` (Strict Mode). |

## Data-model decisions

- **Money** is integer minor units (`priceMinor`, `totalMinor`). Tax rates are basis points (`taxRateBps`). Prices are GST-inclusive; `OrderItem.lineTotalMinor` is net of discounts and includes tax.
- **Inventory** uses `InventoryItem` (on hand / reserved / available, `version` for optimistic concurrency) → `StockReservation` (15-minute TTL, tied to a `PENDING_PAYMENT` order) → `StockMovementLog` (append-only, after-state snapshot for every change).
- **Idempotency** works at two levels: Redis `collab:idempotency:{key}` for fast replay detection, plus unique `Order.idempotencyKey` / `Payment.idempotencyKey` / `Refund.idempotencyKey` so a duplicate charge or refund is impossible even if Redis loses the key.
- **Webhook replay protection:** `ProcessedWebhook @@unique([source, eventId])`.
- **Secrets at rest:** refresh tokens, OTP codes, gift-card codes and chat guest tokens are stored as HMAC-SHA256 hashes keyed by `AUTH_TOKEN_PEPPER`.
- **Embeddings:** `vector(1024)` on `Product` and `KnowledgeChunk` (Voyage `voyage-3.5`), read and written with raw SQL.
- **Chat replay:** `ChatMessage.apiContent` holds the exact Messages API blocks of each turn.

## SQL that ships with the migrations

Prisma cannot express these, so they are hand-written:

- `CHECK` constraints: inventory quantities `>= 0` and `available = onHand - reserved`; `Review.rating BETWEEN 1 AND 5`; positive quantities; non-negative money; coupon shape and limits.
- Partial unique indexes: one default address per user, one default variant and one primary image per product, one settled payment per order.
- HNSW indexes: `USING hnsw (embedding vector_cosine_ops)` on `Product` and `KnowledgeChunk`; trigram indexes on order numbers and SKUs.
- Append-only triggers: `AdminAuditLog` and `StockMovementLog` raise an exception on `UPDATE`/`DELETE`.
- `invoice_number_seq` (Phase 5), `credit_note_number_seq` (6.1).
- `Product_gst_rate_range`, `Order_customer_gstin_format`, `CreditNote_amounts_valid` (6.1).

## Redis key space (`REDIS_KEY_PREFIX`, default `collab:`)

| Key | Purpose |
|---|---|
| `collab:catalog:{hash}` · `collab:facets:{hash}` | catalog listings / facet counts (TTL 5 min + 1 min SWR) |
| `collab:home:bento` · `collab:home:tabs` | home aggregations (TTL 10 min + 2 min SWR) |
| `collab:product:{slug}` | product page payload |
| `collab:admin-dashboard:{hash}` | dashboard payload (TTL 60 s + 30 s SWR) |
| `collab:tag:{tag}` · `collab:tagv:{tag}` | tag → keys set, and tag version for race-free invalidation |
| `collab:rl:{policy}:{sha256(id)}` | sliding-window rate-limit log (incl. `ai-chat`) |
| `collab:lock:{resource}` · `collab:lockfence:{resource}` | distributed locks and fencing counters |
| `collab:idempotency:{key}` | checkout/order idempotency records (24 h) |
| `collab:events:inventory` | pub/sub channel for the live inventory feed |
| `bull:*` | BullMQ queues (separate connections) |

Redis runs as a single primary. The tag-invalidation script deletes keys discovered at run time, which Redis Cluster does not allow.

## Before going live

- Fill `.env.production` with live keys; set `INVOICE_SELLER_GSTIN` and confirm the seller address/state.
- After adding `VOYAGE_API_KEY`, run the reindex once (`exec worker ... scripts/ai-reindex.ts` or the admin button).
- Point an off-host sync at `./backups` and rehearse a restore.
- Register the WhatsApp templates above and the webhook (`/api/webhooks/whatsapp`, verify token = `WHATSAPP_WEBHOOK_VERIFY_TOKEN`).
- Review `src/server/ai/knowledge/policies.ts` and `/support` copy with the business (return windows, hours, delivery charges); the assistant quotes them as fact.
- Configure the bucket: public read only for `products/`, private `invoices/`, CORS for the site origin (presigned POST uploads).
- Point DNS at the host, issue certificates into `docker/nginx/certs`, replace `collab.example.com` in `docker/nginx/conf.d/collab.conf`.

# Collab — Production Remediation Plan

Hand-off document for a coding agent. It lists every confirmed production defect found in the
`iamkartik0704/collab` repository, with the exact change, the acceptance test, and the evidence
that the defect is real.

Work through the items in order. **Do not** ship a partial item: each one has an acceptance test
that must be executed, not just reasoned about.

---

## 0. Ground rules

1. **No dependency changes.** Do not run `npm update`, `npm audit fix`, or edit `package-lock.json`.
   The installed tree is what was tested (Next 15.5.29, Node 22 target).
2. **No destructive migrations.** Only additive DDL (`ADD COLUMN`, `ADD VALUE`). Never edit an
   existing file under `prisma/migrations/`; always create a new migration directory.
3. **Never weaken security to make a check pass.** If a test fails, fix the cause.
4. **One commit per item** (suggested messages are given). Keep `main` deployable after every
   commit.
5. **The migration guard must stay green:** `npm run db:check-migrations` protects hand-written SQL
   (HNSW indexes, partial indexes, CHECK constraints, append-only triggers). If Prisma ever wants to
   drop one of those objects, stop and report instead of regenerating.
6. Node is pinned to `>=22.11` by `package.json`. Use Node 22 LTS for builds; the production images
   are `node:22.20.0-bookworm-slim`.

---

## 1. Baseline — what is already known good

Run this once to establish the starting point. All of it currently passes on a clean checkout:

```bash
npm ci
npx prisma validate                      # schema valid
npx tsc --noEmit                          # 0 errors
npx eslint . --max-warnings=0             # 0 errors, 0 warnings
npx vitest run                            # 30 tests, 5 files, all pass
SKIP_ENV_VALIDATION=1 NEXT_TELEMETRY_DISABLED=1 npx next build
```

The build compiles the whole route table and emits `.next/standalone/server.js`, which boots.

**Do not "fix" these — they were investigated and are correct:**

| Investigated | Verdict |
|---|---|
| `src/middleware.ts` uses `runtime: "nodejs"` with no `experimental.nodeMiddleware` flag | Correct on Next 15.5. Middleware is compiled into `.next/server/middleware.js` and shipped inside `.next/standalone`. No flag needed. |
| `app` container runs `read_only: true` and Next may want `.next/cache` | Safe. There is no ISR, no `revalidate`, no `unstable_cache` and no `fetch(..., { cache: "force-cache" })` anywhere in `src/`. The image disk cache is disabled unless `experimental.isrFlushToDisk` is set (it is not). |
| `prisma` runs through PgBouncer | Correct: `datasource db` declares `directUrl = env("DIRECT_DATABASE_URL")`, so migrations use the direct connection. |
| CSP blocks Stripe | **False alarm — no change.** [`src/lib/security/headers.ts`](../src/lib/security/headers.ts) already contains every directive Stripe publishes for Stripe.js (`script-src https://js.stripe.com https://*.js.stripe.com`, `frame-src https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com`, `connect-src https://api.stripe.com`, `img-src https://*.stripe.com`). See <https://docs.stripe.com/security/guide> ("Stripe.js"). Do not add `m.stripe.network` / `q.stripe.com` unless a real browser console shows a violation. |

---

## 2. Priority overview

| ID | Severity | Area | Symptom in production |
|---|---|---|---|
| R1 | **P0** | Build packaging | GST invoices and credit notes are impossible to produce (500) |
| R2 | **P0** | Docker networking | Worker cannot reach any third-party API: no email, no WhatsApp, no refunds, no invoice storage, no AI indexing |
| R3 | **P1** | nginx + deploy | Every deploy after the first returns 502 until nginx is restarted; only 1 of 2 replicas gets traffic |
| R4 | **P1** | Notifications | Customers receive duplicate WhatsApp messages when a job retries |
| R5 | **P1** | Refunds | A refund that fails at the gateway leaves stock restocked and items marked refunded |
| R6 | **P2** | AI chat | Guest rate limits can be reset for free; transcript endpoint is unthrottled (LLM cost abuse) |
| R7 | **P3** | nginx | HSTS header missing on `/_next/static/` and `/images/` |
| R8 | **P3** | Ops tooling | `certbot` writes certificates where nginx does not read them (renewal silently no-ops) |

Total: 2 × P0, 3 × P1, 1 × P2, 2 × P3.

---

## R1 — P0: invoice/credit-note PDFs are broken in the production image

### Symptom

`GET /api/orders/:orderNumber/invoice` and
`GET /api/orders/:orderNumber/credit-notes/:creditNoteId` return 500 in the Docker image; the
invoice attachment on order-confirmation emails is dropped (the error is swallowed at
[`src/server/notifications/render.ts:132`](../src/server/notifications/render.ts#L132)). GST
invoicing is a legal obligation, so this is a release blocker.

### Root cause (verified)

`@react-pdf/renderer` → `pdfkit` loads its built-in font metrics through a **dynamic**
`require("./standard-fonts/Helvetica.cjs")`. `@vercel/nft` cannot see dynamic requires, so the
standalone trace only copies `pdfkit/js/pdfkit.node.mjs`, `pdfkit/js/data/sRGB_IEC61966_2_1.icc`
and `pdfkit/package.json`. Reproduced on a clean build:

```
$ ls .next/standalone/node_modules/pdfkit/js/
data          # standard-fonts is missing
$ cd .next/standalone && node --input-type=module -e "…renderToBuffer…"
MODULE_NOT_FOUND: …/.next/standalone/node_modules/pdfkit/js/standard-fonts/Helvetica.cjs
```

The worker image is **not** affected (it copies `node_modules` wholesale).

### Change

[`next.config.ts`](../next.config.ts) — insert directly after `serverExternalPackages` (line 45):

```ts
  // pdfkit (pulled in by @react-pdf/renderer) loads its built-in font metrics with dynamic
  // requires, which @vercel/nft cannot trace. Without this the standalone image cannot render
  // GST invoices or credit notes at all.
  outputFileTracingIncludes: {
    "/api/orders/**": ["./node_modules/pdfkit/js/**"],
  },
```

Do not add `pdfkit` to `serverExternalPackages` (it already is external); the missing piece is the
trace, not the bundling.

### Acceptance test

```bash
rm -rf .next
SKIP_ENV_VALIDATION=1 NEXT_TELEMETRY_DISABLED=1 npx next build

# 1. the font metrics are now part of the artefact
ls .next/standalone/node_modules/pdfkit/js/standard-fonts/Helvetica.cjs

# 2. rendering actually works from inside the standalone tree
cd .next/standalone && node --input-type=module -e "
const m = await import('@react-pdf/renderer');
const React = (await import('react')).default;
const b = await m.renderToBuffer(React.createElement(m.Document, null,
  React.createElement(m.Page, null, React.createElement(m.Text, null, 'invoice'))));
console.log('RENDER_OK bytes=' + b.length);"
```

Expected: `RENDER_OK bytes=…` (1524 bytes was observed with this patch applied; the exact size does
not matter, the absence of an exception does). **This was verified working before hand-off** — if
it fails, the patch was not applied correctly.

Then, with the Docker image built, download a real invoice end to end:

```bash
curl -fsS -b "authjs.session-token=<staff session>" \
  "https://<host>/api/orders/<orderNumber>/invoice" -o /tmp/inv.pdf
file /tmp/inv.pdf   # PDF document
```

Commit: `fix(build): trace pdfkit font metrics into the standalone output`

---

## R2 — P0: the worker container has no outbound network

### Symptom

In the production compose stack the worker can talk to Postgres and Redis but **not to the
internet**. Consequently: no confirmation/shipping emails, no WhatsApp messages, refunds never
executed (stuck `PENDING`), invoice/credit-note PDFs never written to S3/R2, and the AI/RAG
reindex jobs fail. The web app keeps accepting orders, so this looks like "notifications silently
stopped working".

### Root cause (verified)

[`docker-compose.prod.yml`](../docker-compose.prod.yml):

```yaml
worker:
  networks: [backend]          # line 76
networks:
  backend:
    internal: true             # line 177 — no default route, no egress
```

`app` is on `[edge, backend]` (line 56), which is why the web app can reach Stripe/S3 but the
worker cannot. Confirmed with `docker compose config`, which resolves the worker to only
`backend`.

### Change

Give the worker the same egress network as the app (it needs DNS + HTTPS to Resend/SMTP,
`graph.facebook.com`, `api.stripe.com`, `api.razorpay.com`, S3/R2, Anthropic and Voyage):

```yaml
  worker:
    # …
    networks: [edge, backend]
```

Keep `backend` internal — that part is correct (database traffic stays isolated). Do not put
`postgres`, `pgbouncer`, `redis` or `backup` on `edge`.

### Acceptance test

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production config \
  | sed -n '/^  worker:/,/^  migrate:/p' | grep -A3 networks
# must list both edge and backend

# from inside the running worker (node is available; curl is not installed in the image)
docker compose -f docker-compose.prod.yml exec -T worker \
  node -e "fetch('https://api.resend.com/', {method:'GET'}).then(r=>console.log('egress ok', r.status)).catch(e=>{console.error('egress FAILED', e.message); process.exit(1)})"
```

Then trigger one real notification and confirm it lands:
`/admin/coupons` → create a coupon (fires no email, cheap) is not enough — instead re-send an order
confirmation from the admin order page, or place a test order in the staging stack, and confirm the
`NotificationLog` row moves `QUEUED → SENT` and the email arrives.

Commit: `fix(docker): give the worker egress for provider APIs`

---

## R3 — P1: stale upstream IP breaks the site after every deploy

### Symptom

`nginx` proxies to `app:3000` with no dynamic resolution. It resolves that name **once at
startup**, keeps the first address, and never re-resolves. Therefore:

* only one of the two `app` replicas ever receives traffic (`deploy.replicas: 2` is wasted);
* the deploy job recreates the `app` containers (new IPs) but leaves nginx running, so nginx keeps
  proxying to a dead address → **blanket 502 until someone restarts nginx**.

### Change

**a) [`docker/nginx/nginx.conf`](../docker/nginx/nginx.conf)** — add to the `http { }` block (before
`include /etc/nginx/conf.d/*.conf;`):

```nginx
  # Docker's embedded DNS. Required for `resolve` in upstream blocks (nginx >= 1.27.3).
  resolver 127.0.0.11 valid=10s ipv6=off;
```

**b) [`docker/nginx/conf.d/collab.conf:4-8`](../docker/nginx/conf.d/collab.conf#L4)** — replace the
upstream block:

```nginx
upstream collab_app {
  zone collab_app 64k;
  server app:3000 resolve max_fails=3 fail_timeout=10s;
  keepalive 64;
}
```

`zone` and `resolve` must be used together; both are supported by the pinned image
(`nginx:1.29-alpine`, where `resolve` is no longer nginx-Plus-only). Verify with
`docker compose exec nginx nginx -v`.

**c) [`.github/workflows/ci-cd.yml:256`](../.github/workflows/ci-cd.yml)** — after `up -d`, reload
nginx so config changes (and any stale state) are picked up:

```yaml
            docker compose -f docker-compose.prod.yml --env-file .env.production up -d --remove-orphans
            # nginx resolves `app` dynamically, but a reload also applies config changes and
            # guarantees no stale upstream survives a deploy.
            docker compose -f docker-compose.prod.yml exec -T nginx nginx -t
            docker compose -f docker-compose.prod.yml exec -T nginx nginx -s reload
```

Do not replace this with `restart nginx` (that drops in-flight SSE connections unnecessarily);
`-s reload` is graceful.

### Acceptance test

```bash
docker compose -f docker-compose.prod.yml exec -T nginx nginx -T | grep -A4 "upstream collab_app"
# shows zone + resolve

# recreate only the app containers, exactly like a deploy, and confirm the site stays up
docker compose -f docker-compose.prod.yml up -d --force-recreate --no-deps app
for i in $(seq 1 12); do
  curl -fsS -o /dev/null -w '%{http_code} ' https://$APP_HOST/api/health; sleep 5
done; echo
# every status must be 200 (allow at most one blip while DNS re-resolves)
```

Also confirm both replicas serve traffic: `docker compose logs --since 2m app | grep -c 'GET /'`
should show requests on both container ids after a short browsing session.

Commit: `fix(nginx): resolve app replicas dynamically and reload after deploy`

---

## R4 — P1: duplicate WhatsApp deliveries on job retry

### Symptom

[`src/workers/notifications.worker.ts`](../src/workers/notifications.worker.ts) marks the
`NotificationLog` `SENT` **after** the provider call. If Meta accepted the message but the process
died, the DB write failed, or the call timed out after acceptance, the BullMQ retry re-reads a
`QUEUED`/`FAILED` row and messages the customer a second time. Resend is protected by
`idempotencyKey: notification-<logId>`; WhatsApp has no idempotency key at all, so customers get
duplicate order updates and cart reminders (a WhatsApp Business policy problem).

### Change

Introduce an explicit in-flight state so a retry after an ambiguous outcome stops instead of
re-sending.

**a) Schema** — [`prisma/schema.prisma`](../prisma/schema.prisma), the `NotificationStatus` enum:

```prisma
enum NotificationStatus {
  QUEUED
  SENDING   // claimed by a worker; the provider call is in flight or its outcome is unknown
  SENT
  DELIVERED
  READ
  FAILED
  DEAD_LETTERED
}
```

Create the migration in its own directory (PostgreSQL cannot add an enum value and use it in the
same transaction — keep this migration to the `ALTER TYPE` alone):

```bash
npx prisma migrate dev --create-only --name notification_sending
# migration.sql must be exactly:
#   ALTER TYPE "NotificationStatus" ADD VALUE 'SENDING';
npm run db:check-migrations     # must stay green
npx prisma generate
```

**b) Worker** — rewrite `deliver()` so the row is claimed **before** the provider call. Replace
lines 20–62 of [`src/workers/notifications.worker.ts`](../src/workers/notifications.worker.ts) with:

```ts
const DONE = new Set(["SENT", "DELIVERED", "READ"]);

/**
 * A row left SENDING for longer than this is treated as abandoned (process killed mid-call). A
 * duplicate is then acceptable; before the lease expires we never re-send, because that is exactly
 * the window in which the provider may already have accepted the message.
 */
const SENDING_LEASE_MS = 15 * 60_000;

/** Network/timeout failures: the provider may or may not have accepted the request. */
function isAmbiguousDeliveryError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (["TimeoutError", "AbortError", "APIConnectionError", "APIConnectionTimeoutError"].includes(error.name)) return true;
  return /fetch failed|socket hang up|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(error.message);
}

async function deliver(job: Job): Promise<string> {
  const data = notificationJobSchema.parse(job.data);
  const entry = await db.notificationLog.findUnique({ where: { id: data.notificationLogId } });
  if (!entry) return "missing-log";
  if (DONE.has(entry.status)) return "already-sent";
  if (entry.status === "DEAD_LETTERED") return "dead-lettered";

  // A login code that arrives after it expired is worse than none.
  if (data.type === "OTP" && Date.now() - entry.createdAt.getTime() > (env.OTP_TTL_SECONDS ?? 300) * 1000) {
    await db.notificationLog.update({ where: { id: entry.id }, data: { status: "FAILED", failedAt: new Date(), lastError: "expired before delivery" } });
    return "otp-expired";
  }

  // Claimed and still within the lease: an earlier attempt reached the provider and we never saw the
  // result. Re-sending would duplicate a WhatsApp message, so surface it to a human instead.
  if (entry.status === "SENDING" && Date.now() - entry.updatedAt.getTime() < SENDING_LEASE_MS) {
    await db.adminAlert
      .createMany({
        data: [
          {
            type: "NOTIFICATION_DEAD_LETTER",
            severity: "WARNING",
            title: `Delivery outcome unknown: ${data.type} (${data.channel})`,
            message: `NotificationLog ${entry.id} has been SENDING since ${entry.updatedAt.toISOString()}. Check the provider dashboard before resending: sending again risks a duplicate.`,
            entityType: "NotificationLog",
            entityId: entry.id,
            dedupeKey: `ambiguous-delivery:${entry.id}`,
          },
        ],
        skipDuplicates: true,
      })
      .catch(() => undefined);
    return "outcome-unknown";
  }

  // Optimistic claim (status + updatedAt) so two workers cannot both send.
  const claim = await db.notificationLog.updateMany({
    where: { id: entry.id, status: entry.status, updatedAt: entry.updatedAt },
    data: { status: "SENDING", jobId: String(job.id).slice(0, 128), attempts: { increment: 1 } },
  });
  if (claim.count !== 1) return "claim-lost";

  const rendered = await renderNotification({ type: data.type, channel: data.channel, orderId: entry.orderId, templateData: data.templateData });
  try {
    const result =
      rendered.channel === "EMAIL"
        ? await sendEmail({
            to: data.recipient,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            attachments: rendered.attachments,
            idempotencyKey: `notification-${entry.id}`,
            tags: { type: data.type },
          })
        : await sendWhatsAppTemplate(data.recipient, rendered.template);
    await db.notificationLog.update({
      where: { id: entry.id },
      data: { status: "SENT", sentAt: new Date(), providerMessageId: result.providerMessageId.slice(0, 255), templateName: rendered.templateName, lastError: null },
    });
    return `sent:${rendered.channel}`;
  } catch (error) {
    const message = (error as Error).message.slice(0, 1000);
    if (error instanceof PermanentEmailError || error instanceof PermanentWhatsAppError) {
      await db.notificationLog.update({ where: { id: entry.id }, data: { status: "FAILED", failedAt: new Date(), lastError: message } });
      throw new UnrecoverableError(message);
    }
    if (isAmbiguousDeliveryError(error)) {
      // Leave SENDING on purpose: the retry will report "outcome-unknown" instead of sending twice.
      await db.notificationLog.update({ where: { id: entry.id }, data: { lastError: `ambiguous: ${message}` } });
      throw error;
    }
    // Provider answered with a definite rejection (5xx/429): a retry is safe.
    await db.notificationLog.update({ where: { id: entry.id }, data: { status: "FAILED", lastError: message } });
    throw error;
  }
}
```

**c)** In `onDeadLetter()` (same file), also cover the in-flight state:

```ts
    where: { id: parsed.data.notificationLogId, status: { in: ["QUEUED", "FAILED", "SENDING"] } },
```

**d)** Update the comment at the top of the file and the "Notifications" section of
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md) to describe the SENDING lease honestly: delivery is
at-least-once, email has provider idempotency, WhatsApp does not, and an ambiguous WhatsApp
outcome is escalated instead of retried.

### Acceptance test

1. `npx prisma validate`, `npm run db:check-migrations`, `npx tsc --noEmit` all pass.
2. In staging (`EMAIL_PROVIDER=log`, `NOTIFICATIONS_DRY_RUN=true`):
   * trigger a notification → row goes `QUEUED → SENDING → SENT`;
   * force the ambiguous branch by pointing `WHATSAPP_*` at a blackholed host, trigger a
     notification, let the job retry → the log stays `SENDING`, an admin alert
     `ambiguous-delivery:<id>` exists, and **exactly one** send attempt was made (check the worker
     log for one `sendWhatsAppTemplate` call per retry attempt — the retry must log
     `outcome-unknown` and not call the provider).
3. Regression: a permanently invalid WhatsApp number still ends `DEAD_LETTERED` with
   `NOTIFICATION_DEAD_LETTER` raised.

Commit: `fix(notifications): claim deliveries before sending to stop duplicates`

---

## R5 — P1: a failed refund leaves stock restocked and items marked refunded

### Symptom

[`src/server/admin/orders.service.ts:584-616`](../src/server/admin/orders.service.ts#L584): for
item-mode refunds, `orderItem.refundedQuantity` is incremented (line 597) and, with "restock",
units are put back on the shelf (line 613) **inside the transaction that only creates the pending
refund**. The provider call happens later, asynchronously. If it ends FAILED, no money moved but the
line still counts as refunded and the stock is already back — return/RMA eligibility shrinks and
those units can never be refunded again.

### Change

Persist what the refund moved, and reverse it when the provider reports failure.

**a) Schema** — add to `model Refund` in [`prisma/schema.prisma`](../prisma/schema.prisma):

```prisma
  /// Item-mode refunds: what was decremented from OrderItem.refundedQuantity, and whether the
  /// units were put back on the shelf. Used to reverse everything if the provider reports FAILED.
  lines          Json?      @default("[]")
  restocked      Boolean    @default(false)
```

Migration: `npx prisma migrate dev --create-only --name refund_reversal_metadata` (additive only),
then `npm run db:check-migrations && npx prisma migrate dev`.

**b) Record the lines** — `createRefundRecord()` (line 337) gains two required inputs and writes
them:

```ts
async function createRefundRecord(
  tx: TransactionClient,
  ctx: AdminContext,
  input: {
    orderId: string;
    payment: { id: string; provider: "STRIPE" | "RAZORPAY" };
    amountMinor: number;
    reason: string;
    idempotencyKey: string;
    /** Item-mode only: the units this refund decrements and (optionally) restocks. */
    lines: Array<{ orderItemId: string; variantId: string; quantity: number }>;
    restocked: boolean;
  },
) {
  const refund = await tx.refund.create({
    data: {
      // …existing fields…
      lines: input.lines,
      restocked: input.restocked,
    },
    select: { id: true, amountMinor: true },
  });
  // …audit unchanged…
}
```

In `createRefund()` (line 560), declare a `refundLines` accumulator before the item loop and push to
it **inside the existing loop**, where `requested.quantity` and the item's `variantId` are already in
scope (look up `variantId` the same way the loop builds `restockLines` today — do not re-derive it
with a second query):

```ts
const refundLines: Array<{ orderItemId: string; variantId: string; quantity: number }> = [];
// … inside the per-item loop, next to the refundedQuantity increment:
refundLines.push({ orderItemId: item.id, variantId, quantity: requested.quantity });
// … then:
const refund = await createRefundRecord(tx, ctx, {
  orderId,
  payment,
  amountMinor,
  reason: input.reason,
  idempotencyKey,
  lines: refundLines,
  restocked: Boolean(input.restock && refundLines.length > 0),
});
```

The cancel-path call at line 497 passes `lines: [], restocked: false` (nothing item-level moved).

**c) Reverse on FAILED** — in `applyRefundStatusInTx()`
([`src/server/payments/payment-events.service.ts:322`](../src/server/payments/payment-events.service.ts#L322)),
inside the same transaction as the status transition, when `status === "FAILED"`. Add a
`effects: PostCommitEffects` parameter to `applyRefundStatusInTx()` and pass the instance that
`handleRefundUpdated()` (line 298) already created, so post-commit side effects keep working:

```ts
if (status === "FAILED") {
  const refund = await tx.refund.findUniqueOrThrow({
    where: { id: refundId },
    select: { orderId: true, restocked: true, lines: true },
  });
  const lines = (refund.lines ?? []) as Array<{ orderItemId: string; variantId: string; quantity: number }>;

  for (const line of lines) {
    await tx.orderItem.updateMany({
      where: { id: line.orderItemId, orderId: refund.orderId, refundedQuantity: { gte: line.quantity } },
      data: { refundedQuantity: { decrement: line.quantity } },
    });
  }

  if (refund.restocked && lines.length > 0) {
    try {
      await unrestockUnits(tx, {
        orderId: refund.orderId,
        lines: lines.map(({ variantId, quantity }) => ({ variantId, quantity })),
        note: `refund ${refundId} failed at the provider; stock reversal`,
        effects,
      });
    } catch (error) {
      // Never block the refund status on the stock reversal: alert and continue.
      await tx.adminAlert.createMany({
        data: [{
          type: "PAYMENT_ANOMALY",
          severity: "WARNING",
          title: `Refund failed; stock reversal incomplete (${refundId})`,
          message: (error as Error).message.slice(0, 900),
          entityType: "Refund",
          entityId: refundId,
          dedupeKey: `refund-reversal:${refundId}`,
        }],
        skipDuplicates: true,
      });
    }
  }
}
```

**d) New helper** — add to
[`src/server/inventory/reservation.service.ts`](../src/server/inventory/reservation.service.ts)
next to `restockUnits()`. It must **clamp** so it can never violate the
`InventoryItem_quantities_nonnegative` / `InventoryItem_available_consistent` CHECK constraints
(the units may have been resold in the meantime), and it must write a movement row:

Copy `restockUnits()` (line 470) and negate the delta; keep the same `applyChange` argument order
(`tx, row, change, log, effects`) and the same `LockedInventoryRow` map discipline.

```ts
/**
 * Takes back units that a later-failed refund had restocked. Clamped to what is still on hand above
 * the reserved quantity, so the reversal can never violate the inventory CHECK constraints or push
 * stock negative (those units may have been resold in the meantime). The movement note records how
 * many units were actually reversed.
 */
export async function unrestockUnits(
  tx: TransactionClient,
  input: { orderId: string; lines: readonly StockLine[]; note: string; effects: PostCommitEffects },
): Promise<number> {
  const totals = aggregate(input.lines);
  const rows = await lockInventory(tx, [...totals.keys()]);
  let units = 0;
  for (const [variantId, quantity] of [...totals.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const row = rows.get(variantId);
    if (!row) continue;
    const reversible = Math.min(quantity, row.quantityOnHand - row.quantityReserved);
    if (reversible <= 0) continue;
    rows.set(
      variantId,
      await applyChange(
        tx,
        row,
        { onHandDelta: -reversible, reservedDelta: 0 },
        {
          type: "MANUAL_ADJUSTMENT",
          reason: "SYSTEM_CORRECTION",
          note: `${input.note} (reversed ${reversible}/${quantity})`.slice(0, 500),
          orderId: input.orderId,
          actorId: null,
        },
        input.effects,
      ),
    );
    units += reversible;
  }
  return units;
}
```

`PostCommitEffects` is imported as a **type** in `reservation.service.ts`, so never `new` it inside a
helper — take it as a parameter (as above). `handleRefundUpdated` already owns an effects instance;
thread it through so post-commit side effects (inventory SSE) still fire.

### Acceptance test

1. Typecheck + unit tests pass; migration guard green.
2. In staging, with a Stripe **test** key:
   * refund one item of a delivered order with restock → note `onHand` and
     `refundedQuantity`;
   * force the refund to fail: `UPDATE "Refund" SET status='PENDING', "providerRefundId"=NULL WHERE id='<id>'`
     then make the provider call fail (point `STRIPE_SECRET_KEY` at an invalid key and re-queue the
     job, or call the retry endpoint);
   * assert: `Refund.status = 'FAILED'`, `OrderItem.refundedQuantity` back to its original value,
     `InventoryItem.quantityOnHand` back to its original value, and a `StockMovementLog` row of type
     `MANUAL_ADJUSTMENT` / `SYSTEM_CORRECTION` referencing the order.
3. A successful refund is unchanged (`refundedQuantity` and stock stay where they were).

Commit: `fix(refunds): reverse item quantities and restock when the provider fails`

---

## R6 — P2: guest AI-chat limits can be reset at will

### Symptom

[`src/app/api/ai/chat/route.ts:53-64`](../src/app/api/ai/chat/route.ts#L53): the guest limit is keyed
`guest:${tokenHash}`, but that token is **minted by the server** for any request without a chat
cookie, and a new session is created whenever `sessionId` is absent. A client that discards cookies
therefore gets a fresh 20-message budget on every request, leaving only the IP limit (120/min) — 120
billable model calls per minute per IP from anonymous traffic. `GET /api/ai/chat` (line 33) has no
rate limit at all and hits the database.

### Change

**a)** [`src/lib/redis/rate-limit.ts`](../src/lib/redis/rate-limit.ts) — add a guest policy:

```ts
  /** AI chatbot, guests not signed in: 10 messages / 10 min / IP (cookie rotation cannot reset it). */
  aiChatGuest: { name: "ai-chat-guest", limit: 10, windowMs: 10 * 60_000, failMode: "closed" },
```

**b)** `POST` — replace line 60:

```ts
  const ip = getClientIp(request.headers);
  if (identity.user) {
    await enforceRateLimit(RateLimitPolicies.aiChat, `user:${identity.user.id}`);
  } else {
    // Keyed on IP, not on the (freely recreatable) guest cookie.
    await enforceRateLimit(RateLimitPolicies.aiChatGuest, `guest-ip:${ip}`);
  }
  await enforceRateLimit(RateLimitPolicies.publicApi, `ai-chat-ip:${ip}`);
```

**c)** `GET` — add before `findOwnedSession`:

```ts
  await enforceRateLimit(RateLimitPolicies.publicApi, `ai-chat-read:${getClientIp(request.headers)}`);
```

**d)** Raise the visibility of this in code comments only — do not add a captcha/Turnstile, that is a
product decision.

### Acceptance test

1. Signed-in users are unaffected: 20 messages / 10 min per user id.
2. Guests: 10 messages / 10 min per IP. Verify by scripting 12 POSTs with a fresh cookie jar each
   time (`curl -c /dev/null`) from one IP — requests 11 and 12 return `429` with `Retry-After`.
3. `GET /api/ai/chat?sessionId=…` returns `429` after 120 requests in a minute.
4. Unit tests still pass.

Commit: `fix(ai): rate-limit guests by IP and throttle the transcript endpoint`

---

## R7 — P3: HSTS missing on static asset locations

`add_header` directives are **not** inherited into a `location` that declares its own
`add_header`. [`docker/nginx/conf.d/collab.conf:49-60`](../docker/nginx/conf.d/collab.conf#L49)
declares `add_header Cache-Control` in `/_next/static/` and `/images/`, so the server-level
`Strict-Transport-Security` is dropped for exactly those responses.

Add the header to both locations:

```nginx
  location /_next/static/ {
    proxy_pass http://collab_app;
    expires 365d;
    add_header Cache-Control "public, max-age=31536000, immutable";
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    access_log off;
  }
  location /images/ {
    proxy_pass http://collab_app;
    expires 7d;
    add_header Cache-Control "public, max-age=604800";
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    access_log off;
  }
```

Acceptance: `curl -sI https://<host>/_next/static/<any-file> | grep -i strict-transport-security`
returns the header, and the same for `/images/...`.

Commit: `fix(nginx): keep HSTS on cached static locations`

---

## R8 — P3: certbot writes certificates nginx never reads

[`docker-compose.prod.yml:165-172`](../docker-compose.prod.yml#L165) mounts
`./docker/nginx/certs` at `/etc/letsencrypt/live/collab`. Certbot's `live/` directory contains
symlinks into `archive/`, which is outside that mount, so renewal produces broken links and nginx
(which reads `/etc/nginx/certs/fullchain.pem`) keeps serving the old certificate. The documented
renewal command therefore silently does nothing useful.

Give certbot the whole Let's Encrypt tree and copy the live files into the directory nginx reads:

```yaml
  certbot:
    image: certbot/certbot:latest
    profiles: ["tools"]
    volumes:
      - ./docker/letsencrypt:/etc/letsencrypt
      - ./docker/nginx/certs:/deploy:rw
      - certbot-webroot:/var/www/certbot
    entrypoint:
      - /bin/sh
      - -c
      - >
        certbot certonly --webroot -w /var/www/certbot -d "$$APP_HOST"
        --deploy-hook "cp -L /etc/letsencrypt/live/$$APP_HOST/fullchain.pem /deploy/fullchain.pem
        && cp -L /etc/letsencrypt/live/$$APP_HOST/privkey.pem /deploy/privkey.pem"
        && echo 'certificates deployed; run: docker compose exec nginx nginx -s reload'
```

Document in the header comment of the compose file that renewal is
`docker compose -f docker-compose.prod.yml --profile tools run --rm certbot renew` followed by the
nginx reload, and that `docker/letsencrypt` must be backed up.

Acceptance: on a staging host with a real domain, a fresh issuance creates `fullchain.pem` and
`privkey.pem` in `docker/nginx/certs`, `nginx -t` passes, and `openssl s_client -connect <host>:443`
shows the new certificate dates.

Commit: `fix(ops): make certbot issuance/renewal reach the nginx cert path`

---

## 3. Global verification gate (run before you say you are done)

```bash
set -e
npm ci
npx prisma validate
npx tsc --noEmit
npx eslint . --max-warnings=0
npx vitest run
npm run db:check-migrations
SKIP_ENV_VALIDATION=1 NEXT_TELEMETRY_DISABLED=1 npx next build
ls .next/standalone/node_modules/pdfkit/js/standard-fonts/Helvetica.cjs
docker compose -f docker-compose.prod.yml --env-file .env.production config -q
```

Then the staging smoke test, which is the only thing that proves R2/R3/R4/R5:

1. `docker compose -f docker-compose.prod.yml --env-file .env.production up -d` on the staging host.
2. `curl -fsS https://<host>/api/health` → `{"status":"ok"}`; `?live=1` → 200.
3. Place a test order end to end (catalogue → cart → checkout with a Stripe test card) and confirm:
   order reaches `PLACED`, stock reserved then consumed, confirmation email logged/sent, invoice PDF
   downloads, credit note appears after a refund.
4. Refund the order, force one to fail, and confirm R5 behaviour.
5. `docker compose up -d --force-recreate --no-deps app`, then confirm the site stays up (R3).
6. Trigger a notification and confirm exactly one delivery (R4).

## 4. Definition of done

- [ ] R1: `RENDER_OK` printed from inside `.next/standalone`, invoice PDF downloads in staging.
- [ ] R2: `docker compose exec worker node -e "fetch(...)"` succeeds; a real email is delivered.
- [ ] R3: two forced `app` recreations with zero sustained 502s; both replicas seen in the access log.
- [ ] R4: a retried ambiguous WhatsApp job produces one send and an `ambiguous-delivery` alert.
- [ ] R5: a failed refund fully reverses `refundedQuantity` and stock, with a movement log row.
- [ ] R6: guest chat returns 429 after 10 messages from one IP across fresh cookies.
- [ ] R7: HSTS present on `/_next/static/` and `/images/`.
- [ ] R8: fresh issuance + renewal write valid certificates to `docker/nginx/certs`.
- [ ] `docs/ARCHITECTURE.md` updated where behaviour changed (R3 resolution, R4 delivery semantics,
      R5 refund reversal, R8 renewal command).
- [ ] No dependency or lockfile changes; no edits to existing migrations.

## 5. Suggested commit order

1. `fix(build): trace pdfkit font metrics into the standalone output` (R1) — smallest, unblocks
   invoice testing for the rest.
2. `fix(docker): give the worker egress for provider APIs` (R2).
3. `fix(nginx): resolve app replicas dynamically and reload after deploy` (R3).
4. `fix(notifications): claim deliveries before sending to stop duplicates` (R4, includes migration).
5. `fix(refunds): reverse item quantities and restock when the provider fails` (R5, includes
   migration).
6. `fix(ai): rate-limit guests by IP and throttle the transcript endpoint` (R6).
7. `fix(nginx): keep HSTS on cached static locations` (R7).
8. `fix(ops): make certbot issuance/renewal reach the nginx cert path` (R8).

## 6. Out of scope for this pass

These were found in the earlier security/behaviour review and are **not** part of the production
blockers above. Do not fold them into these commits; raise them separately.

- `getClientIp()` trusts `x-real-ip` unconditionally ([`src/lib/security/request.ts:10`](../src/lib/security/request.ts#L10)) — safe only while nginx is the sole ingress. Needs an explicit trusted-proxy switch before the app is ever exposed directly.
- `GET /api/auth/refresh` is a state-changing GET reachable by cross-site top-level navigation ([`src/app/api/auth/refresh/route.ts`](../src/app/api/auth/refresh/route.ts)).
- `decideReturnRequest()` is not serialised ([`src/server/returns/return.service.ts`](../src/server/returns/return.service.ts)) — a conditional `updateMany({ where: { id, status: "REQUESTED" } })` fixes it.
- Product images rely on the bucket policy keeping the `invoices/` prefix private; there is no startup assertion.
- `ANTHROPIC_API_KEY` / `VOYAGE_API_KEY` are mandatory even when the AI features are unused ([`src/env.ts`](../src/env.ts)).

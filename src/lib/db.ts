import { Prisma, PrismaClient } from "@prisma/client";
import { env } from "@/env";
import { logger } from "@/lib/logger";

if (typeof window !== "undefined") {
  throw new Error("@/lib/db is server-only and must not be imported from client code.");
}

/** Queries slower than this are logged at `warn` with their duration. */
const SLOW_QUERY_MS = 500;

function createPrismaClient() {
  const client = new PrismaClient({
    // Emit as events so everything flows through the structured logger.
    log: [
      { emit: "event", level: "query" },
      { emit: "event", level: "warn" },
      { emit: "event", level: "error" },
    ],
    errorFormat: env.NODE_ENV === "production" ? "minimal" : "pretty",
    transactionOptions: {
      maxWait: 5_000,
      timeout: 10_000,
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    },
  });

  client.$on("query", (event) => {
    if (event.duration >= SLOW_QUERY_MS) {
      logger.warn(
        { durationMs: event.duration, query: event.query, target: event.target },
        "slow database query",
      );
    } else if (logger.isLevelEnabled("trace")) {
      // Parameters are only logged at trace level; they can contain personal data.
      logger.trace(
        { durationMs: event.duration, query: event.query, params: event.params },
        "database query",
      );
    }
  });
  client.$on("warn", (event) => logger.warn({ target: event.target }, event.message));
  // Prisma emits `error` events even for failures the caller catches and handles (e.g. an
  // expected unique violation on a duplicate webhook). Real failures surface as exceptions
  // and are logged by the code that handles them, so these events stay at debug level.
  client.$on("error", (event) => logger.debug({ target: event.target }, event.message));

  return client;
}

type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;

// Reuse one client across Next.js hot reloads in development; each reload would
// otherwise open a new connection pool and exhaust PgBouncer.
const globalForPrisma = globalThis as unknown as { __collabPrisma?: ExtendedPrismaClient };

export const db: ExtendedPrismaClient = globalForPrisma.__collabPrisma ?? createPrismaClient();

if (env.NODE_ENV !== "production") {
  globalForPrisma.__collabPrisma = db;
}

export type TransactionClient = Prisma.TransactionClient;

export interface TransactionOptions {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  /** Attempts after the first one for serialization failures / deadlocks. */
  maxRetries?: number;
  /** Max time the transaction may run, in ms. */
  timeoutMs?: number;
  /** Max time to wait for a connection from the pool, in ms. */
  maxWaitMs?: number;
}

/**
 * Runs `fn` in an interactive transaction and transparently retries it when PostgreSQL
 * aborts it because of a write conflict, serialization failure (40001) or deadlock (40P01).
 * `fn` must be free of side effects outside the database because it can run more than once.
 */
export async function withTransaction<T>(
  fn: (tx: TransactionClient) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const {
    isolationLevel = Prisma.TransactionIsolationLevel.ReadCommitted,
    maxRetries = 3,
    timeoutMs = 10_000,
    maxWaitMs = 5_000,
  } = options;

  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(fn, { isolationLevel, timeout: timeoutMs, maxWait: maxWaitMs });
    } catch (error) {
      if (attempt >= maxRetries || !isRetryableTransactionError(error)) {
        throw error;
      }
      const delayMs = Math.min(1_000, 25 * 2 ** attempt) + Math.floor(Math.random() * 25);
      logger.warn({ attempt: attempt + 1, delayMs, err: error }, "retrying aborted transaction");
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

const RETRYABLE_SQLSTATES = new Set(["40001", "40P01"]);

export function isRetryableTransactionError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  // P2034: "Transaction failed due to a write conflict or a deadlock".
  if (error.code === "P2034") {
    return true;
  }
  // P2010: raw query failed - inspect the underlying PostgreSQL SQLSTATE.
  if (error.code === "P2010") {
    const sqlState = (error.meta as { code?: unknown } | undefined)?.code;
    return typeof sqlState === "string" && RETRYABLE_SQLSTATES.has(sqlState);
  }
  return false;
}

/** True for a unique-constraint violation, optionally on a specific field. */
export function isUniqueConstraintError(error: unknown, field?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  if (!field) {
    return true;
  }
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  return Array.isArray(target) ? target.includes(field) : target === field;
}

/** True when PostgreSQL rejected a write with CHECK constraint `constraint` (SQLSTATE 23514). */
export function isCheckViolation(error: unknown, constraint: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientUnknownRequestError)) {
    return false;
  }
  return error.message.includes("23514") && error.message.includes(constraint);
}

/** True when an update/delete matched no row (record not found). */
export function isRecordNotFoundError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}

export async function disconnectDatabase(): Promise<void> {
  await db.$disconnect();
}

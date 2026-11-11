import { EventEmitter } from "node:events";
import type Redis from "ioredis";
import { logger } from "@/lib/logger";
import { isRedisAvailable, redis, redisKey } from "@/lib/redis";

/**
 * Live stock feed for the admin Inventory Control Center.
 * Every committed inventory change (checkout reservations, payments, expiry releases in the
 * worker, admin adjustments) is published on one Redis channel. Each web process keeps a single
 * subscriber connection and fans messages out to its open Server-Sent-Event streams.
 */

export interface InventoryEvent {
  variantId: string;
  sku: string;
  onHand: number;
  reserved: number;
  available: number;
  threshold: number;
  /** InventoryItem.version after the change (optimistic-concurrency token for admin edits). */
  version: number;
  at: string;
}

const CHANNEL = redisKey("events", "inventory");

export async function publishInventoryEvent(event: InventoryEvent): Promise<void> {
  if (!isRedisAvailable()) return;
  await redis.publish(CHANNEL, JSON.stringify(event));
}

const globalForEvents = globalThis as unknown as {
  __collabInventoryBus?: { emitter: EventEmitter; subscriber: Redis | null; listeners: number };
};

function bus() {
  globalForEvents.__collabInventoryBus ??= { emitter: new EventEmitter().setMaxListeners(0), subscriber: null, listeners: 0 };
  return globalForEvents.__collabInventoryBus;
}

async function ensureSubscriber(): Promise<void> {
  const state = bus();
  if (state.subscriber) return;
  const subscriber = redis.duplicate({ connectionName: "collab-inventory-sse", lazyConnect: true, maxRetriesPerRequest: null });
  state.subscriber = subscriber;
  subscriber.on("message", (channel, message) => {
    if (channel !== CHANNEL) return;
    try {
      state.emitter.emit("event", JSON.parse(message) as InventoryEvent);
    } catch (error) {
      logger.warn({ err: error }, "ignoring malformed inventory event");
    }
  });
  subscriber.on("error", (error) => logger.warn({ err: error }, "inventory event subscriber error"));
  try {
    await subscriber.connect();
    await subscriber.subscribe(CHANNEL);
  } catch (error) {
    state.subscriber = null;
    subscriber.disconnect();
    throw error;
  }
}

/** Registers a listener; returns the unsubscribe function. */
export async function subscribeInventoryEvents(listener: (event: InventoryEvent) => void): Promise<() => void> {
  const state = bus();
  await ensureSubscriber();
  state.emitter.on("event", listener);
  state.listeners++;
  return () => {
    state.emitter.off("event", listener);
    state.listeners = Math.max(0, state.listeners - 1);
  };
}

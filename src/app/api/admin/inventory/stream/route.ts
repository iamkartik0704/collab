import { route } from "@/lib/api/handler";
import { logger } from "@/lib/logger";
import { subscribeInventoryEvents } from "@/lib/realtime/inventory-events";
import { requireAdmin } from "@/server/admin/context";

export const dynamic = "force-dynamic";

/** Streams close before the 15-minute access token lapses; EventSource reconnects (re-authorising). */
const STREAM_LIFETIME_MS = 5 * 60_000;
const HEARTBEAT_MS = 20_000;

/** GET /api/admin/inventory/stream - Server-Sent Events: one `stock` event per committed change. */
export const GET = route(async (request, { requestId }) => {
  await requireAdmin(request, "inventory:write", requestId, { write: false });
  const encoder = new TextEncoder();
  let cleanup: () => void = () => undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (!closed) controller.enqueue(encoder.encode(chunk));
      };
      const send = (event: string, data: unknown) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      };

      let unsubscribe: () => void = () => undefined;
      try {
        unsubscribe = await subscribeInventoryEvents((event) => send("stock", event));
      } catch (error) {
        logger.warn({ err: error }, "inventory stream unavailable");
        write("retry: 15000\n");
        send("unavailable", { reason: "realtime feed unavailable; falling back to polling" });
        close();
        return;
      }
      write("retry: 3000\n");
      send("ready", { at: new Date().toISOString() });
      const heartbeat = setInterval(() => write(": keep-alive\n\n"), HEARTBEAT_MS);
      const lifetime = setTimeout(() => {
        send("reconnect", {});
        close();
      }, STREAM_LIFETIME_MS);
      cleanup = () => {
        clearInterval(heartbeat);
        clearTimeout(lifetime);
        unsubscribe();
      };
      request.signal.addEventListener("abort", close);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      // nginx: do not buffer the stream.
      "X-Accel-Buffering": "no",
    },
  });
});

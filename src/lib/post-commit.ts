import { logger } from "@/lib/logger";

/**
 * Side effects (queue jobs, cache invalidation, provider calls) that must only happen after a
 * database transaction commits. Services register them inside the transaction callback; the
 * caller flushes them once `$transaction` has resolved. A failing effect is logged and does not
 * undo the committed work - every effect here has a sweeper or retry path behind it.
 */
export class PostCommitEffects {
  private readonly tasks: Array<{ label: string; run: () => Promise<unknown> }> = [];

  add(label: string, run: () => Promise<unknown>): void {
    this.tasks.push({ label, run });
  }

  get size(): number {
    return this.tasks.length;
  }

  async flush(): Promise<void> {
    const tasks = this.tasks.splice(0, this.tasks.length);
    for (const task of tasks) {
      try {
        await task.run();
      } catch (error) {
        logger.error({ err: error, effect: task.label }, "post-commit effect failed");
      }
    }
  }
}

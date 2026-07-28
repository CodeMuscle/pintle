/**
 * EventBus — in-memory pub/sub stub for domain events. Synchronous fan-out,
 * good enough until events move onto BullMQ (Module 13 / Notifications). The
 * publish/subscribe surface is intentionally what a durable bus would expose
 * so callers don't change when it is swapped.
 */
import { Injectable, Logger } from "@nestjs/common";
import type { DomainEvent, DomainEventName } from "@pintle/contracts";

type Handler = (event: DomainEvent<unknown>) => void | Promise<void>;

@Injectable()
export class EventBus {
  private readonly logger = new Logger(EventBus.name);
  private readonly handlers = new Map<DomainEventName, Set<Handler>>();

  subscribe(name: DomainEventName, handler: Handler): () => void {
    const set = this.handlers.get(name) ?? new Set<Handler>();
    set.add(handler);
    this.handlers.set(name, set);
    return () => set.delete(handler);
  }

  async publish<T>(event: DomainEvent<T>): Promise<void> {
    this.logger.log(
      { event: event.name, tenantId: event.tenantId, requestId: event.requestId },
      "domain event published",
    );
    const subs = this.handlers.get(event.name);
    if (!subs?.size) return;
    await Promise.all(
      [...subs].map(async (h) => {
        try {
          await h(event as DomainEvent<unknown>);
        } catch (err) {
          // A subscriber must not break the publisher (nor other subscribers).
          this.logger.error({ err, event: event.name }, "event handler failed");
        }
      }),
    );
  }
}

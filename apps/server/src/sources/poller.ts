import { and, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { sourceItems, sources, withSystem, type Db } from '@runflow/db';
import { fetchFeed } from './feed';

/* Lee las fuentes activas cada pocos minutos y guarda las noticias nuevas. */

export async function refreshSource(
  db: Db,
  source: { id: string; orgId: string; url: string },
  opts: { allowPrivate: boolean },
): Promise<{ added: number; error: string | null }> {
  try {
    const items = await fetchFeed(source.url, opts);
    let added = 0;
    await withSystem(db, async (tx) => {
      if (items.length) {
        const rows = await tx
          .insert(sourceItems)
          .values(
            items.map((i) => ({
              orgId: source.orgId,
              sourceId: source.id,
              guid: i.guid.slice(0, 500),
              title: i.title.slice(0, 500),
              summary: i.summary,
              link: i.link.slice(0, 1000),
              publishedAt: i.publishedAt,
            })),
          )
          .onConflictDoNothing()
          .returning({ id: sourceItems.id });
        added = rows.length;
      }
      await tx
        .update(sources)
        .set({ lastFetchedAt: new Date(), lastError: null })
        .where(eq(sources.id, source.id));
    });
    return { added, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await withSystem(db, (tx) =>
      tx
        .update(sources)
        .set({ lastFetchedAt: new Date(), lastError: message.slice(0, 300) })
        .where(eq(sources.id, source.id)),
    );
    return { added: 0, error: message };
  }
}

export class SourcePoller {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly db: Db,
    private readonly log: FastifyBaseLogger,
    private readonly options: { intervalMs: number; allowPrivate: boolean },
  ) {}

  start(): void {
    if (!this.options.intervalMs) return;
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        const list = await withSystem(this.db, (tx) =>
          tx
            .select({ id: sources.id, orgId: sources.orgId, url: sources.url })
            .from(sources)
            .where(and(eq(sources.enabled, true))),
        );
        for (const s of list) await refreshSource(this.db, s, this.options);
      } catch (err) {
        this.log.warn({ err }, 'Fuentes: error al leer');
      } finally {
        this.running = false;
      }
    };
    this.timer = setInterval(() => void tick(), this.options.intervalMs);
    this.timer.unref?.();
    void tick();
  }

  close(): void {
    clearInterval(this.timer);
  }
}

import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { socialFeeds, socialPosts, withSystem, type Db } from '@runflow/db';
import type { SecretBox } from '../services/secrets';
import { DEFAULT_SOCIAL_BASES, fetchSocial, type SocialBases } from './fetch';

/* F3.4 Lee las búsquedas de redes activas y guarda las publicaciones nuevas (por moderar). */

export interface SocialOptions {
  allowPrivate: boolean;
  bases: SocialBases;
}

export function socialOptions(config: {
  sourcesAllowPrivate: boolean;
  env: string;
  socialBases: Partial<SocialBases>;
}): SocialOptions {
  return {
    allowPrivate: config.sourcesAllowPrivate || config.env === 'test',
    bases: {
      bluesky: config.socialBases.bluesky ?? DEFAULT_SOCIAL_BASES.bluesky,
      x: config.socialBases.x ?? DEFAULT_SOCIAL_BASES.x,
      youtube: config.socialBases.youtube ?? DEFAULT_SOCIAL_BASES.youtube,
    },
  };
}

export async function refreshSocialFeed(
  db: Db,
  secrets: SecretBox,
  feed: typeof socialFeeds.$inferSelect,
  opts: SocialOptions,
): Promise<{ added: number; error: string | null }> {
  try {
    const items = await fetchSocial(
      {
        network: feed.network,
        query: feed.query,
        instance: feed.instance,
        apiKey: feed.apiKeyEnc ? secrets.decrypt(feed.apiKeyEnc) : null,
      },
      opts,
    );
    let added = 0;
    await withSystem(db, async (tx) => {
      if (items.length) {
        const rows = await tx
          .insert(socialPosts)
          .values(
            items.map((i) => ({
              orgId: feed.orgId,
              feedId: feed.id,
              network: feed.network,
              externalId: i.externalId.slice(0, 500),
              author: i.author.slice(0, 120) || '—',
              handle: i.handle.slice(0, 120),
              text: i.text.slice(0, 4000),
              url: i.url.slice(0, 1000),
              mediaUrl: i.mediaUrl.slice(0, 1000),
              postedAt: i.postedAt,
            })),
          )
          .onConflictDoNothing()
          .returning({ id: socialPosts.id });
        added = rows.length;
      }
      await tx
        .update(socialFeeds)
        .set({ lastFetchedAt: new Date(), lastError: null })
        .where(eq(socialFeeds.id, feed.id));
    });
    return { added, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await withSystem(db, (tx) =>
      tx
        .update(socialFeeds)
        .set({ lastFetchedAt: new Date(), lastError: message.slice(0, 300) })
        .where(eq(socialFeeds.id, feed.id)),
    );
    return { added: 0, error: message };
  }
}

export class SocialPoller {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly db: Db,
    private readonly secrets: () => SecretBox,
    private readonly log: FastifyBaseLogger,
    private readonly options: SocialOptions & { intervalMs: number },
  ) {}

  start(): void {
    if (!this.options.intervalMs) return;
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        const list = await withSystem(this.db, (tx) =>
          tx.select().from(socialFeeds).where(eq(socialFeeds.enabled, true)),
        );
        for (const f of list) await refreshSocialFeed(this.db, this.secrets(), f, this.options);
      } catch (err) {
        this.log.warn({ err }, 'Redes: error al leer');
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

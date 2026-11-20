import { and, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import {
  sceneKey,
  screenContentSchema,
  type LiveState,
  type PublicScreenState,
  type ResolvedScreenContent,
  type ScreenContent,
} from '@runflow/core';
import { media, organizations, screenScenes, screens, withSystem, type Db } from '@runflow/db';
import { readLines } from '@runflow/sync';
import type { CollabServer } from '../collab/collab-server';

/* F3.3 Pantallas: estado de cada pantalla y avisos en vivo a sus clientes. */

type Send = (state: PublicScreenState | null) => void;

const parseContent = (v: unknown): ScreenContent => {
  const r = screenContentSchema.safeParse(v);
  return r.success ? r.data : { type: 'none' };
};

export class ScreensManager {
  private readonly subs = new Map<string, Set<{ screenId: string; send: Send }>>();

  constructor(
    private readonly db: Db,
    private readonly collab: CollabServer,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Un cliente de pantalla escucha cambios (devuelve la baja). */
  subscribe(orgId: string, screenId: string, send: Send): () => void {
    let set = this.subs.get(orgId);
    if (!set) this.subs.set(orgId, (set = new Set()));
    const sub = { screenId, send };
    set.add(sub);
    return () => {
      set.delete(sub);
      if (!set.size) this.subs.delete(orgId);
    };
  }

  clients(orgId: string): number {
    return this.subs.get(orgId)?.size ?? 0;
  }

  /** Estado que pinta una pantalla (null si ya no existe). */
  async stateFor(screenId: string): Promise<PublicScreenState | null> {
    return withSystem(this.db, async (tx) => {
      const [row] = await tx
        .select({ screen: screens, orgName: organizations.name, timezone: organizations.timezone })
        .from(screens)
        .innerJoin(organizations, eq(organizations.id, screens.orgId))
        .where(eq(screens.id, screenId));
      if (!row) return null;
      const [scene] = await tx
        .select()
        .from(screenScenes)
        .where(and(eq(screenScenes.orgId, row.screen.orgId), eq(screenScenes.active, true)))
        .limit(1);
      const fromScene = scene
        ? (scene.contents as Record<string, unknown>)[row.screen.id]
        : undefined;
      const content = parseContent(fromScene ?? row.screen.content);
      let resolved: ResolvedScreenContent;
      if (content.type === 'media') {
        const [m] = await tx
          .select({ mime: media.mime })
          .from(media)
          .where(and(eq(media.id, content.mediaId), eq(media.orgId, row.screen.orgId)));
        const kind = m?.mime.split('/')[0];
        resolved =
          kind === 'video' || kind === 'image' || kind === 'audio'
            ? {
                ...content,
                kind,
                src: `/api/public/screens/${row.screen.token}/media/${content.mediaId}`,
              }
            : { type: 'none' };
      } else {
        resolved = content;
      }
      return {
        orgName: row.orgName,
        name: row.screen.name,
        timezone: row.timezone,
        scene: scene?.name ?? null,
        content: resolved,
      };
    });
  }

  /** Reenvía el estado a todas las pantallas conectadas de la empresa. */
  async notify(orgId: string): Promise<void> {
    const set = this.subs.get(orgId);
    if (!set?.size) return;
    const cache = new Map<string, PublicScreenState | null>();
    for (const sub of [...set]) {
      try {
        if (!cache.has(sub.screenId)) cache.set(sub.screenId, await this.stateFor(sub.screenId));
        sub.send(cache.get(sub.screenId)!);
      } catch (err) {
        this.log.warn({ err }, 'pantallas: no se pudo avisar');
      }
    }
  }

  /** Activa una escena (null = contenido por defecto en todas). */
  async activate(orgId: string, sceneId: string | null): Promise<boolean> {
    const ok = await withSystem(this.db, async (tx) => {
      if (sceneId) {
        const [s] = await tx
          .select({ id: screenScenes.id })
          .from(screenScenes)
          .where(and(eq(screenScenes.id, sceneId), eq(screenScenes.orgId, orgId)));
        if (!s) return false;
      }
      await tx
        .update(screenScenes)
        .set({ active: false })
        .where(and(eq(screenScenes.orgId, orgId), eq(screenScenes.active, true)));
      if (sceneId)
        await tx.update(screenScenes).set({ active: true }).where(eq(screenScenes.id, sceneId));
      return true;
    });
    if (ok) await this.notify(orgId);
    return ok;
  }

  /**
   * GO: si la línea que entra en el aire tiene en PANTALLAS el nombre de una
   * escena, se activa. Sin valor o sin escena con ese nombre, no cambia nada.
   */
  onLive(rundownId: string, orgId: string, prev: LiveState, next: LiveState): void {
    const lineId = next.onAir?.lineId;
    if (
      !lineId ||
      (prev.onAir?.lineId === lineId && prev.onAir?.startedAt === next.onAir?.startedAt)
    )
      return;
    void (async () => {
      const value = await this.collab.withDoc(rundownId, orgId, (doc) => {
        const line = readLines(doc).find((l) => l.id === lineId);
        const v = line?.cells.pantallas;
        return typeof v === 'string' ? v : '';
      });
      const key = sceneKey(value);
      if (!key) return;
      const [scene] = await withSystem(this.db, (tx) =>
        tx
          .select({ id: screenScenes.id, active: screenScenes.active })
          .from(screenScenes)
          .where(and(eq(screenScenes.orgId, orgId), eq(screenScenes.key, key))),
      );
      if (scene && !scene.active) await this.activate(orgId, scene.id);
    })().catch((err) => this.log.warn({ err }, 'pantallas: GO'));
  }
}

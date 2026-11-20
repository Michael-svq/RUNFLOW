import { createHmac, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { lineTypeLabel, type LiveState, type WebhookEvent } from '@runflow/core';
import { readLines } from '@runflow/sync';
import { webhooks, withSystem, type Db } from '@runflow/db';
import type { CollabServer } from '../collab/collab-server';
import type { SecretBox } from '../services/secrets';
import { assertPublicUrl } from '../sources/feed';

/*
 * Webhooks (F2.4): avisos firmados a otros sistemas (grafismo, web, redes…).
 * Firma: X-RunFlow-Signature: t=<segundos>,v1=<HMAC-SHA256(secreto, "t.cuerpo")>.
 */

const CACHE_MS = 30_000;
const RETRIES = [0, 1000, 5000];

type HookRow = typeof webhooks.$inferSelect;

export function signWebhook(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

export class WebhookDispatcher {
  private readonly cache = new Map<string, { at: number; hooks: HookRow[] }>();

  constructor(
    private readonly db: Db,
    private readonly secrets: () => SecretBox,
    private readonly collab: CollabServer,
    private readonly log: FastifyBaseLogger,
    private readonly options: { allowPrivate: boolean },
  ) {}

  invalidate(orgId: string): void {
    this.cache.delete(orgId);
  }

  private async hooksFor(orgId: string): Promise<HookRow[]> {
    const cached = this.cache.get(orgId);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.hooks;
    const hooks = await withSystem(this.db, (tx) =>
      tx
        .select()
        .from(webhooks)
        .where(and(eq(webhooks.orgId, orgId), eq(webhooks.enabled, true))),
    );
    this.cache.set(orgId, { at: Date.now(), hooks });
    return hooks;
  }

  /** Envía un evento a los webhooks de la empresa que lo escuchan (sin esperar). */
  emit(orgId: string, event: WebhookEvent, data: Record<string, unknown>): void {
    void this.hooksFor(orgId)
      .then((hooks) => {
        for (const hook of hooks) {
          if ((hook.events as string[]).includes(event)) void this.deliver(hook, event, data);
        }
      })
      .catch((err: unknown) => this.log.warn({ err }, 'Webhooks: error'));
  }

  async deliver(
    hook: HookRow,
    event: string,
    data: Record<string, unknown>,
  ): Promise<{ status: number | null; error: string | null }> {
    const body = JSON.stringify({
      id: randomUUID(),
      event,
      createdAt: new Date().toISOString(),
      orgId: hook.orgId,
      data,
    });
    let status: number | null = null;
    let error: string | null = null;
    for (const wait of RETRIES) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      try {
        if (!this.options.allowPrivate) await assertPublicUrl(hook.url);
        const secret = this.secrets().decrypt(hook.secretEnc);
        const res = await fetch(hook.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'user-agent': 'RunFlow-Webhooks/1.0',
            'x-runflow-event': event,
            'x-runflow-signature': signWebhook(secret, body),
          },
          body,
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000),
        });
        status = res.status;
        error = res.ok ? null : `Respuesta ${res.status}`;
        if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) break;
      } catch (err) {
        status = null;
        error = err instanceof Error ? err.message : String(err);
      }
    }
    await withSystem(this.db, (tx) =>
      tx
        .update(webhooks)
        .set({ lastStatus: status, lastError: error, lastDeliveryAt: new Date() })
        .where(eq(webhooks.id, hook.id)),
    ).catch(() => undefined);
    return { status, error };
  }

  /** Cambios del directo → live.go y live.ended. */
  onLive(rundownId: string, orgId: string, prev: LiveState, next: LiveState): void {
    const changed =
      prev.onAir?.lineId !== next.onAir?.lineId || prev.onAir?.startedAt !== next.onAir?.startedAt;
    if (next.showEndedAt && !prev.showEndedAt) {
      this.emit(orgId, 'live.ended', {
        rundownId,
        endedAt: new Date(next.showEndedAt).toISOString(),
      });
    }
    if (!changed || !next.onAir) return;
    const onAir = next.onAir;
    void this.collab
      .withDoc(rundownId, orgId, (doc) => readLines(doc).find((l) => l.id === onAir.lineId))
      .then((line) =>
        this.emit(orgId, 'live.go', {
          rundownId,
          rehearsal: next.rehearsal,
          onAir: {
            lineId: onAir.lineId,
            num: String(line?.cells.num ?? ''),
            name: String(line?.cells.nombre ?? ''),
            type: lineTypeLabel(line?.cells.tipo),
            startedAt: new Date(onAir.startedAt).toISOString(),
          },
          previousLineId: prev.onAir?.lineId ?? null,
        }),
      )
      .catch(() => undefined);
  }
}

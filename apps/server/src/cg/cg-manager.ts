import { and, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import {
  casparConfigSchema,
  GRAPHIC_LAYER,
  graphicCues,
  initialCgState,
  normalizeClip,
  parseTimecode,
  readOrgSettings,
  resolveNext,
  templateData,
  TIMECODE_LINE_TYPES,
  type CasparConfig,
  type CgState,
  type DeviceStatus,
  type GraphicCue,
  type GraphicData,
  type LiveState,
  type OrgSettings,
  type TimingLine,
} from '@runflow/core';
import { lineScript, readLines, type LineSnapshot } from '@runflow/sync';
import { devices, organizations, withTenant, type Db } from '@runflow/db';
import type { CollabServer } from '../collab/collab-server';
import { amcp, AmcpClient, parseCls, type ClipInfo } from './amcp';
import { OscListener, type ClipTime } from './osc';

/*
 * RunFlow CG (PLAN §11, §13 y §15): mueve CasparCG con el directo.
 *
 * - GO a un VTR: lanza su clip (precargado si era la SIGUIENTE) y programa
 *   sus rótulos por TC sobre la posición real del vídeo (OSC).
 * - GO a otra línea: los rótulos de la anterior salen y el VTR se para.
 * - Rótulos manuales ▶/■ en cualquier momento; los de cámara pueden salir
 *   solos según la Configuración Master.
 * - Desarmado o en ensayo, el GO no mueve equipos.
 * - Si un equipo falla: aviso ⚠ y el directo continúa.
 */

export const MSG_CG = 105;
const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';
const CLIPS_TTL_MS = 15_000;
/** Desfase (ms) a partir del cual se reprograman los rótulos con la posición real del vídeo. */
const DRIFT_MS = 250;

class CasparDevice {
  readonly client: AmcpClient;
  osc: OscListener | undefined;
  version: string | null = null;
  clips: ClipInfo[] = [];
  clipsAt = 0;

  constructor(
    readonly id: string,
    readonly name: string,
    readonly config: CasparConfig,
    private readonly onStatus: () => void,
    private readonly log: FastifyBaseLogger,
  ) {
    this.client = new AmcpClient(config.host, config.port, { reconnectMs: 3000 });
    this.client.on('status', () => {
      if (this.client.connected) void this.refresh();
      this.onStatus();
    });
    this.client.connect();
  }

  status(): DeviceStatus {
    return {
      connected: this.client.connected,
      error: this.client.connected ? null : this.client.lastError,
      version: this.version,
    };
  }

  /** Versión y lista de clips (comprobación de VTR OK). */
  async refresh(): Promise<void> {
    try {
      this.version = (await this.client.send(amcp.version())).data[0] ?? null;
      this.clips = parseCls((await this.client.send(amcp.cls())).data);
      this.clipsAt = Date.now();
    } catch (err) {
      this.log.debug({ err, device: this.name }, 'CasparCG: no se pudo leer la lista de clips');
    }
  }

  close(): void {
    this.client.close();
    this.osc?.close();
  }
}

interface OrgCg {
  settings: OrgSettings;
  devices: CasparDevice[];
}

interface RundownCg {
  rundownId: string;
  orgId: string;
  state: CgState;
  /** Temporizadores de salida automática de cada rótulo en aire. */
  outTimers: Map<string, NodeJS.Timeout>;
  /** Rótulos por TC del VTR en aire y sus temporizadores. */
  cues: GraphicCue[];
  cueTimers: NodeJS.Timeout[];
  cueLineId: string | null;
  /** Epoch ms en que empezó (según CasparCG) el clip en aire. */
  clipStart: number | null;
  queue: Promise<unknown>;
  live: LiveState | null;
}

interface Actor {
  orgId: string;
  userId: string;
}

const clipOf = (line: LineSnapshot | undefined): string =>
  typeof line?.cells.clip === 'string' ? line.cells.clip.trim() : '';
const isVtr = (line: LineSnapshot | undefined): boolean =>
  !!line && TIMECODE_LINE_TYPES.has(String(line.cells.tipo ?? ''));

export class CgManager {
  private readonly orgs = new Map<string, Promise<OrgCg>>();
  private readonly rundowns = new Map<string, RundownCg>();

  constructor(
    private readonly db: Db,
    private readonly collab: CollabServer,
    private readonly log: FastifyBaseLogger,
    private readonly options: { serverBaseUrl: string },
  ) {
    collab.cgSnapshot = (rundownId, orgId) => this.snapshot(rundownId, orgId);
  }

  /* ---------- Empresa: ajustes y equipos ---------- */

  private org(orgId: string): Promise<OrgCg> {
    let entry = this.orgs.get(orgId);
    if (!entry) {
      entry = this.loadOrg(orgId);
      this.orgs.set(orgId, entry);
      entry.catch(() => this.orgs.delete(orgId));
    }
    return entry;
  }

  private async loadOrg(orgId: string): Promise<OrgCg> {
    const ctx = { orgId, userId: SYSTEM_USER };
    const [org, rows] = await withTenant(this.db, ctx, (tx) =>
      Promise.all([
        tx
          .select({ settings: organizations.settings })
          .from(organizations)
          .where(eq(organizations.id, orgId)),
        tx
          .select()
          .from(devices)
          .where(and(eq(devices.orgId, orgId), eq(devices.enabled, true))),
      ]),
    );
    const list: CasparDevice[] = [];
    for (const row of rows) {
      if (row.kind !== 'casparcg') continue;
      const config = casparConfigSchema.safeParse(row.config);
      if (!config.success) continue;
      const device = new CasparDevice(
        row.id,
        row.name,
        config.data,
        () => this.onDeviceStatus(orgId),
        this.log,
      );
      if (config.data.oscPort) {
        const osc = new OscListener(config.data.oscPort);
        osc.on('time', (t: ClipTime) => this.onClipTime(orgId, device, t));
        osc.on('error-status', (err: Error) =>
          this.log.warn({ err, device: row.name }, 'OSC de CasparCG no disponible'),
        );
        osc.start();
        device.osc = osc;
      }
      list.push(device);
    }
    return { settings: readOrgSettings(org[0]?.settings), devices: list };
  }

  /** Ajustes o equipos cambiados: se vuelven a cargar. */
  async invalidate(orgId: string): Promise<void> {
    const entry = this.orgs.get(orgId);
    this.orgs.delete(orgId);
    if (entry) {
      const org = await entry.catch(() => null);
      for (const d of org?.devices ?? []) d.close();
    }
    // Las escaletas en directo reciben el estado de los equipos nuevos.
    if ([...this.rundowns.values()].some((rc) => rc.orgId === orgId)) {
      const org = await this.org(orgId);
      for (const rc of this.rundowns.values()) {
        if (rc.orgId !== orgId) continue;
        rc.state.devices = this.deviceMap(org);
        this.broadcast(rc);
      }
    }
  }

  async settings(orgId: string): Promise<OrgSettings> {
    return (await this.org(orgId)).settings;
  }

  async deviceStatuses(orgId: string): Promise<Record<string, DeviceStatus>> {
    const org = await this.org(orgId);
    return Object.fromEntries(org.devices.map((d) => [d.id, d.status()]));
  }

  private deviceMap(org: OrgCg): CgState['devices'] {
    return Object.fromEntries(org.devices.map((d) => [d.id, { ...d.status(), name: d.name }]));
  }

  private onDeviceStatus(orgId: string): void {
    const entry = this.orgs.get(orgId);
    if (!entry) return;
    void entry.then((org) => {
      for (const rc of this.rundowns.values()) {
        if (rc.orgId !== orgId) continue;
        rc.state.devices = this.deviceMap(org);
        this.broadcast(rc);
      }
    });
  }

  /** Clips disponibles en los CasparCG de la empresa (columna PLAY / VTR OK). */
  async clips(orgId: string): Promise<{ clips: ClipInfo[]; devices: number; connected: number }> {
    const org = await this.org(orgId);
    const connected = org.devices.filter((d) => d.client.connected);
    await Promise.all(
      connected.filter((d) => Date.now() - d.clipsAt > CLIPS_TTL_MS).map((d) => d.refresh()),
    );
    const seen = new Map<string, ClipInfo>();
    for (const d of connected) for (const c of d.clips) seen.set(normalizeClip(c.name), c);
    return { clips: [...seen.values()], devices: org.devices.length, connected: connected.length };
  }

  /** Prueba de conexión desde Configuración. */
  static async test(config: CasparConfig): Promise<{ version: string; clips: number }> {
    const client = new AmcpClient(config.host, config.port, { timeoutMs: 3000 });
    try {
      await client.ready(3000);
      const version = (await client.send(amcp.version())).data[0] ?? '';
      const clips = parseCls((await client.send(amcp.cls())).data).length;
      return { version, clips };
    } finally {
      client.close();
    }
  }

  /* ---------- Escaletas ---------- */

  private rundown(rundownId: string, orgId: string): RundownCg {
    let rc = this.rundowns.get(rundownId);
    if (!rc || rc.orgId !== orgId) {
      rc = {
        rundownId,
        orgId,
        state: initialCgState(),
        outTimers: new Map(),
        cues: [],
        cueTimers: [],
        cueLineId: null,
        clipStart: null,
        queue: Promise.resolve(),
        live: null,
      };
      this.rundowns.set(rundownId, rc);
    }
    return rc;
  }

  /** Estado de RunFlow CG de una escaleta, con el de los equipos de la empresa. */
  async snapshot(rundownId: string, orgId: string): Promise<CgState> {
    const org = await this.org(orgId);
    const rc = this.rundowns.get(rundownId);
    const base = rc && rc.orgId === orgId ? rc.state : initialCgState();
    return { ...base, devices: this.deviceMap(org) };
  }

  private enqueue<T>(rc: RundownCg, fn: () => Promise<T>): Promise<T> {
    const run = rc.queue.then(fn, fn);
    rc.queue = run.catch((err: unknown) => {
      this.log.error({ err, rundownId: rc.rundownId }, 'RunFlow CG: error');
    });
    return run;
  }

  private broadcast(rc: RundownCg): void {
    this.collab.broadcastCustom(rc.rundownId, MSG_CG, rc.state);
  }

  /** Ejecuta una orden en todos los CasparCG de la empresa; los fallos se avisan, el directo sigue. */
  private async run(
    rc: RundownCg,
    org: OrgCg,
    build: (d: CasparDevice) => string | null,
  ): Promise<void> {
    if (!org.devices.length) return;
    const results = await Promise.allSettled(
      org.devices.map(async (d) => {
        const command = build(d);
        if (command) await d.client.send(command);
      }),
    );
    const failed = results
      .map((r, i) =>
        r.status === 'rejected'
          ? `${org.devices[i]!.name}: ${String((r.reason as Error).message)}`
          : null,
      )
      .filter(Boolean);
    const warning = failed.length ? `CasparCG ${failed.join(' · ')}` : null;
    if (warning) this.log.warn({ rundownId: rc.rundownId, warning }, 'RunFlow CG');
    if (warning !== rc.state.warning) rc.state.warning = warning;
  }

  private async readDoc(rc: RundownCg): Promise<{
    lines: LineSnapshot[];
    graphics: Map<string, { line: LineSnapshot; graphic: GraphicData }>;
  }> {
    return this.collab.withDoc(rc.rundownId, rc.orgId, (doc) => {
      const lines = readLines(doc);
      const graphics = new Map<string, { line: LineSnapshot; graphic: GraphicData }>();
      for (const line of lines) {
        for (const g of lineScript(doc, line.id).graphics) {
          graphics.set(g.id, { line, graphic: g as unknown as GraphicData });
        }
      }
      return { lines, graphics };
    });
  }

  private templateUrl(d: CasparDevice, type: string): string {
    const base = (d.config.templateBaseUrl || this.options.serverBaseUrl).replace(/\/+$/, '');
    return `${base}/cg/templates/${type}.html`;
  }

  /* ---------- Directo ---------- */

  /** Lo llama el motor de directo tras cada cambio. */
  onLive(rundownId: string, orgId: string, prev: LiveState, next: LiveState): void {
    const rc = this.rundown(rundownId, orgId);
    rc.live = next;
    const changedOnAir =
      prev.onAir?.lineId !== next.onAir?.lineId || prev.onAir?.startedAt !== next.onAir?.startedAt;
    const changedNext = prev.next !== next.next || changedOnAir;
    if (!changedOnAir && !changedNext) return;
    void this.enqueue(rc, () => this.transition(rc, next, changedOnAir));
  }

  private async transition(rc: RundownCg, live: LiveState, changedOnAir: boolean): Promise<void> {
    const org = await this.org(rc.orgId);
    rc.state.devices = this.deviceMap(org);
    const active = live.armed && !live.rehearsal;
    const { lines, graphics } = await this.readDoc(rc);
    const onAirId = live.onAir?.lineId ?? null;
    const layers = (d: CasparDevice) => d.config.layers;

    if (changedOnAir) {
      this.clearCues(rc);
      // Los rótulos de las líneas anteriores salen.
      for (const [id, g] of Object.entries(rc.state.graphics)) {
        if (g.lineId !== onAirId) await this.outGraphic(rc, org, id, active || !g.auto);
      }
      const line = lines.find((l) => l.id === onAirId);
      const clip = clipOf(line);
      if (active && line && isVtr(line) && clip) {
        const preloaded =
          rc.state.preroll?.lineId === line.id &&
          normalizeClip(rc.state.preroll.name) === normalizeClip(clip);
        await this.run(rc, org, (d) =>
          preloaded
            ? amcp.play(d.config.channel, layers(d).vtr)
            : amcp.play(d.config.channel, layers(d).vtr, clip),
        );
        const startedAt = live.onAir!.startedAt;
        rc.clipStart = startedAt;
        rc.state.clip = {
          lineId: line.id,
          name: clip,
          state: 'playing',
          loop: false,
          startedAt,
          duration:
            this.clipDuration(org, clip) ??
            (typeof line.cells.dur_vtr === 'number' ? line.cells.dur_vtr : null),
          position: null,
          positionAt: null,
        };
        rc.state.preroll = null;
        const lineGraphics = [...graphics.values()]
          .filter((g) => g.line.id === line.id)
          .map((g) => g.graphic);
        rc.cues = graphicCues(lineGraphics, org.settings.graphicSeconds);
        rc.cueLineId = line.id;
        this.scheduleCues(rc, org);
      } else if (rc.state.clip) {
        if (active) await this.run(rc, org, (d) => amcp.stop(d.config.channel, layers(d).vtr));
        rc.state.clip = null;
        rc.clipStart = null;
      }
      if (!live.onAir && !live.showStartedAt) {
        // Vuelta a preparación: todo limpio.
        rc.state.done = {};
      }
    }

    // Precarga del VTR de la línea SIGUIENTE.
    const nextId = live.showEndedAt ? null : resolveNext(lines as TimingLine[], live);
    const nextLine = lines.find((l) => l.id === nextId);
    const nextClip = clipOf(nextLine);
    if (active && org.settings.prerollNext && nextLine && isVtr(nextLine) && nextClip) {
      if (rc.state.preroll?.lineId !== nextLine.id || rc.state.preroll.name !== nextClip) {
        await this.run(rc, org, (d) => amcp.loadbg(d.config.channel, layers(d).vtr, nextClip));
        rc.state.preroll = { lineId: nextLine.id, name: nextClip };
      }
    } else {
      rc.state.preroll = null;
    }
    this.broadcast(rc);
  }

  private clipDuration(org: OrgCg, clip: string): number | null {
    const n = normalizeClip(clip);
    for (const d of org.devices) {
      const c = d.clips.find((x) => normalizeClip(x.name) === n);
      if (c?.duration) return c.duration;
    }
    return null;
  }

  private clearCues(rc: RundownCg): void {
    for (const t of rc.cueTimers) clearTimeout(t);
    rc.cueTimers = [];
    rc.cues = [];
    rc.cueLineId = null;
  }

  /** Programa los rótulos por TC respecto al inicio real del clip. */
  private scheduleCues(rc: RundownCg, org: OrgCg): void {
    for (const t of rc.cueTimers) clearTimeout(t);
    rc.cueTimers = [];
    if (rc.clipStart === null || !rc.cueLineId) return;
    const now = Date.now();
    for (const cue of rc.cues) {
      const inAt = rc.clipStart + cue.inAt * 1000;
      const outAt = rc.clipStart + cue.outAt * 1000;
      if (outAt <= now) continue;
      const onAir = rc.state.graphics[cue.id];
      if (!onAir && !rc.state.done[cue.id]) {
        const t = setTimeout(
          () =>
            void this.enqueue(rc, async () => {
              if (rc.cueLineId && !rc.state.graphics[cue.id] && !rc.state.done[cue.id]) {
                await this.takeGraphic(rc, org, cue.id, { auto: true, outAt });
                this.broadcast(rc);
              }
            }),
          Math.max(0, inAt - now),
        );
        t.unref?.();
        rc.cueTimers.push(t);
      } else if (onAir?.auto) {
        onAir.outAt = outAt;
        this.armOut(rc, org, cue.id, outAt);
      }
    }
  }

  /** Posición real del VTR (OSC): si el clip va desfasado, se reprograman sus rótulos. */
  private onClipTime(orgId: string, device: CasparDevice, t: ClipTime): void {
    if (t.channel !== device.config.channel || t.layer !== device.config.layers.vtr) return;
    for (const rc of this.rundowns.values()) {
      if (rc.orgId !== orgId || !rc.state.clip || rc.state.clip.state !== 'playing') continue;
      const now = Date.now();
      const start = now - t.elapsed * 1000;
      rc.state.clip.position = t.elapsed;
      rc.state.clip.positionAt = now;
      if (t.total && !rc.state.clip.duration) rc.state.clip.duration = t.total;
      if (rc.clipStart === null || Math.abs(start - rc.clipStart) > DRIFT_MS) {
        rc.clipStart = start;
        rc.state.clip.startedAt = start;
        void this.enqueue(rc, async () => {
          this.scheduleCues(rc, await this.org(orgId));
          this.broadcast(rc);
        });
      }
    }
  }

  /* ---------- Rótulos ---------- */

  private armOut(rc: RundownCg, org: OrgCg, graphicId: string, outAt: number | null): void {
    clearTimeout(rc.outTimers.get(graphicId));
    rc.outTimers.delete(graphicId);
    if (outAt === null) return;
    const t = setTimeout(
      () =>
        void this.enqueue(rc, async () => {
          if (rc.state.graphics[graphicId]) {
            await this.outGraphic(rc, org, graphicId, true);
            this.broadcast(rc);
          }
        }),
      Math.max(0, outAt - Date.now()),
    );
    t.unref?.();
    rc.outTimers.set(graphicId, t);
  }

  private async takeGraphic(
    rc: RundownCg,
    org: OrgCg,
    graphicId: string,
    opts: { auto: boolean; outAt: number | null; graphic?: GraphicData; lineId?: string },
  ): Promise<void> {
    let graphic = opts.graphic;
    let lineId = opts.lineId;
    if (!graphic || !lineId) {
      const found = (await this.readDoc(rc)).graphics.get(graphicId);
      if (!found) return;
      graphic = found.graphic;
      lineId = found.line.id;
    }
    const layerKind = GRAPHIC_LAYER[graphic.type] ?? 'lower';
    // Otro rótulo en la misma capa: lo sustituye.
    for (const [id, g] of Object.entries(rc.state.graphics)) {
      if (id !== graphicId && (GRAPHIC_LAYER[g.type] ?? 'lower') === layerKind) {
        clearTimeout(rc.outTimers.get(id));
        rc.outTimers.delete(id);
        delete rc.state.graphics[id];
        rc.state.done[id] = Date.now();
      }
    }
    const data = templateData(graphic, org.settings.cgDesign);
    const g = graphic;
    await this.run(rc, org, (d) =>
      amcp.cgAdd(d.config.channel, d.config.layers[layerKind], this.templateUrl(d, g.type), data),
    );
    rc.state.graphics[graphicId] = {
      lineId,
      type: graphic.type,
      since: Date.now(),
      outAt: opts.outAt,
      auto: opts.auto,
    };
    delete rc.state.done[graphicId];
    this.armOut(rc, org, graphicId, opts.outAt);
  }

  private async outGraphic(
    rc: RundownCg,
    org: OrgCg,
    graphicId: string,
    send: boolean,
  ): Promise<void> {
    const g = rc.state.graphics[graphicId];
    if (!g) return;
    clearTimeout(rc.outTimers.get(graphicId));
    rc.outTimers.delete(graphicId);
    const layerKind = GRAPHIC_LAYER[g.type] ?? 'lower';
    if (send) {
      await this.run(rc, org, (d) => amcp.cgStop(d.config.channel, d.config.layers[layerKind]));
    }
    delete rc.state.graphics[graphicId];
    rc.state.done[graphicId] = Date.now();
  }

  /** ▶ manual de un rótulo. */
  async take(actor: Actor, rundownId: string, graphicId: string): Promise<CgState> {
    const rc = this.rundown(rundownId, actor.orgId);
    return this.enqueue(rc, async () => {
      const org = await this.org(actor.orgId);
      const found = (await this.readDoc(rc)).graphics.get(graphicId);
      if (!found) throw Object.assign(new Error('Rótulo no encontrado'), { statusCode: 404 });
      const { graphic, line } = found;
      const secs = org.settings.graphicSeconds;
      let outAt: number | null;
      if (isVtr(line)) {
        const tin = graphic.tcIn ? parseTimecode(graphic.tcIn) : null;
        const tout = graphic.tcOut ? parseTimecode(graphic.tcOut) : null;
        outAt =
          Date.now() + (tin !== null && tout !== null && tout > tin ? tout - tin : secs) * 1000;
      } else {
        // Cámara / directo: salida manual ■ o automática según la Configuración Master.
        outAt = org.settings.cameraAutoOut ? Date.now() + secs * 1000 : null;
      }
      rc.state.devices = this.deviceMap(org);
      await this.takeGraphic(rc, org, graphicId, { auto: false, outAt, graphic, lineId: line.id });
      this.broadcast(rc);
      return rc.state;
    });
  }

  /** ■ manual de un rótulo. */
  async out(actor: Actor, rundownId: string, graphicId: string): Promise<CgState> {
    const rc = this.rundown(rundownId, actor.orgId);
    return this.enqueue(rc, async () => {
      const org = await this.org(actor.orgId);
      await this.outGraphic(rc, org, graphicId, true);
      this.broadcast(rc);
      return rc.state;
    });
  }

  /** Saca todos los rótulos en aire. */
  async clearGraphics(actor: Actor, rundownId: string): Promise<CgState> {
    const rc = this.rundown(rundownId, actor.orgId);
    return this.enqueue(rc, async () => {
      const org = await this.org(actor.orgId);
      for (const id of Object.keys(rc.state.graphics)) await this.outGraphic(rc, org, id, true);
      this.broadcast(rc);
      return rc.state;
    });
  }

  /** Control manual del VTR en aire: pausa, continuar, parar o bucle. */
  async clip(
    actor: Actor,
    rundownId: string,
    action: 'pause' | 'resume' | 'stop' | 'loop',
  ): Promise<CgState> {
    const rc = this.rundown(rundownId, actor.orgId);
    return this.enqueue(rc, async () => {
      const org = await this.org(actor.orgId);
      const clip = rc.state.clip;
      if (!clip) return rc.state;
      const ch = (d: CasparDevice) => d.config.channel;
      const vtr = (d: CasparDevice) => d.config.layers.vtr;
      if (action === 'pause' && clip.state === 'playing') {
        await this.run(rc, org, (d) => amcp.pause(ch(d), vtr(d)));
        clip.state = 'paused';
        clip.position = rc.clipStart !== null ? (Date.now() - rc.clipStart) / 1000 : null;
        clip.positionAt = Date.now();
        for (const t of rc.cueTimers) clearTimeout(t);
        rc.cueTimers = [];
      } else if (action === 'resume' && clip.state === 'paused') {
        await this.run(rc, org, (d) => amcp.resume(ch(d), vtr(d)));
        clip.state = 'playing';
        rc.clipStart = Date.now() - (clip.position ?? 0) * 1000;
        clip.startedAt = rc.clipStart;
        this.scheduleCues(rc, org);
      } else if (action === 'stop') {
        await this.run(rc, org, (d) => amcp.stop(ch(d), vtr(d)));
        clip.state = 'stopped';
        // Si el VTR se para, sus rótulos salen.
        this.clearCues(rc);
        for (const [id, g] of Object.entries(rc.state.graphics)) {
          if (g.lineId === clip.lineId) await this.outGraphic(rc, org, id, true);
        }
      } else if (action === 'loop') {
        clip.loop = !clip.loop;
        await this.run(rc, org, (d) =>
          clip.loop ? amcp.play(ch(d), vtr(d), clip.name, { loop: true }) : null,
        );
        if (clip.loop) {
          rc.clipStart = Date.now();
          clip.startedAt = rc.clipStart;
          clip.state = 'playing';
        }
      }
      this.broadcast(rc);
      return rc.state;
    });
  }

  close(): void {
    for (const rc of this.rundowns.values()) {
      for (const t of rc.cueTimers) clearTimeout(t);
      for (const t of rc.outTimers.values()) clearTimeout(t);
    }
    this.rundowns.clear();
    for (const entry of this.orgs.values()) {
      void entry.then((org) => org.devices.forEach((d) => d.close())).catch(() => undefined);
    }
    this.orgs.clear();
  }
}

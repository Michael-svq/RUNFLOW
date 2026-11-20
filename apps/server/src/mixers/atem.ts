import { EventEmitter } from 'node:events';
import { Atem } from 'atem-connection';
import type { AtemConfig, StreamAction } from '@runflow/core';
import type { MixerDriver } from './driver';

/*
 * Blackmagic ATEM con atem-connection (protocolo UDP 9910 de Sofie).
 * Cada fuente es un número de entrada del ATEM (1 = Cámara 1, 3010 = Media Player 1…).
 */

/** Lo mínimo que se usa de atem-connection (sustituible en pruebas). */
export interface AtemLike extends EventEmitter {
  state?: {
    info?: { productIdentifier?: string; apiVersion?: number };
    inputs?: Record<string, { longName?: string }>;
    streaming?: { status?: { state?: number } };
    recording?: { status?: { state?: number } };
  };
  connect(address: string, port?: number): Promise<void>;
  disconnect(): Promise<void>;
  destroy?(): Promise<void>;
  changeProgramInput(input: number, me?: number): Promise<void>;
  changePreviewInput(input: number, me?: number): Promise<void>;
  autoTransition(me?: number): Promise<void>;
  startStreaming?(): Promise<void>;
  stopStreaming?(): Promise<void>;
  startRecording?(): Promise<void>;
  stopRecording?(): Promise<void>;
}

export class AtemDriver extends EventEmitter implements MixerDriver {
  private readonly atem: AtemLike;
  connected = false;
  lastError: string | null = null;
  version: string | null = null;
  private closed = false;

  constructor(
    private readonly config: AtemConfig,
    factory: () => AtemLike = () => new Atem({ disableMultithreaded: true }) as unknown as AtemLike,
  ) {
    super();
    this.atem = factory();
    this.atem.on('connected', () => {
      this.connected = true;
      this.lastError = null;
      const info = this.atem.state?.info;
      this.version = info?.productIdentifier ?? 'ATEM';
      this.emit('status');
    });
    this.atem.on('disconnected', () => {
      this.connected = false;
      this.lastError = this.closed ? null : 'ATEM desconectado';
      this.emit('status');
    });
    this.atem.on('error', (err: unknown) => {
      this.lastError = err instanceof Error ? err.message : String(err);
    });
  }

  connect(): void {
    // atem-connection reconecta solo.
    void this.atem.connect(this.config.host).catch((err: Error) => {
      this.lastError = err.message;
      this.emit('status');
    });
  }

  close(): void {
    this.closed = true;
    void (this.atem.destroy?.() ?? this.atem.disconnect()).catch(() => undefined);
  }

  async cut(input: string): Promise<void> {
    if (!this.connected) throw new Error(this.lastError ?? 'ATEM no está conectado');
    const n = Number.parseInt(input, 10);
    if (!Number.isFinite(n)) throw new Error(`Entrada de ATEM no válida: ${input}`);
    if (this.config.transition === 'auto') {
      await this.atem.changePreviewInput(n, this.config.me);
      await this.atem.autoTransition(this.config.me);
    } else {
      await this.atem.changeProgramInput(n, this.config.me);
    }
  }

  async output(action: StreamAction): Promise<void> {
    if (!this.connected) throw new Error(this.lastError ?? 'ATEM no está conectado');
    const fn = {
      startStream: this.atem.startStreaming,
      stopStream: this.atem.stopStreaming,
      startRecord: this.atem.startRecording,
      stopRecord: this.atem.stopRecording,
    }[action];
    if (!fn) throw new Error('Este ATEM no emite ni graba');
    await fn.call(this.atem);
  }

  async outputStatus(): Promise<{ streaming: boolean; recording: boolean }> {
    // StreamingStatus.Streaming = 4 · RecordingStatus.Recording = 1
    return {
      streaming: this.atem.state?.streaming?.status?.state === 4,
      recording: this.atem.state?.recording?.status?.state === 1,
    };
  }

  async inputs(): Promise<string[]> {
    return Object.entries(this.atem.state?.inputs ?? {}).map(
      ([id, i]) => `${id} · ${i?.longName ?? ''}`,
    );
  }
}

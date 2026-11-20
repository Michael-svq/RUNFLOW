import type { EventEmitter } from 'node:events';
import type { StreamAction } from '@runflow/core';

/** Interfaz común de los mezcladores (OBS, vMix, ATEM). Emiten `status` al conectar o caer. */
export interface MixerDriver extends EventEmitter {
  readonly connected: boolean;
  readonly lastError: string | null;
  readonly version: string | null;
  connect(): void;
  close(): void;
  /** Pone la entrada en programa (corte o transición según la configuración). */
  cut(input: string): Promise<void>;
  /** Entradas o escenas disponibles (para el mapa de fuentes). */
  inputs(): Promise<string[]>;
  /** Emisión en streaming y grabación (F2.3). */
  output(action: StreamAction): Promise<void>;
  outputStatus(): Promise<{ streaming: boolean; recording: boolean }>;
}

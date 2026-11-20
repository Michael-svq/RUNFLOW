import type { EventEmitter } from 'node:events';

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
}

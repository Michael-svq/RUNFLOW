import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import type { WebsocketProvider } from 'y-websocket';

/** Mensajes propios sobre el WebSocket de colaboración (ver servidor). */
export const MSG_LIVE = 100;
export const MSG_PROMPTER = 101;
export const MSG_STAGE = 102;
export const MSG_OUTPUT_SETTINGS = 103;

export function onCustom<T>(
  provider: WebsocketProvider,
  type: number,
  handler: (payload: T) => void,
): void {
  provider.messageHandlers[type] = (_encoder: unknown, decoder: decoding.Decoder) => {
    handler(JSON.parse(decoding.readVarString(decoder)) as T);
  };
}

/** Envía un mensaje propio (solo si hay conexión). */
export function sendCustom(provider: WebsocketProvider, type: number, payload: unknown): boolean {
  const ws = provider.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, type);
  encoding.writeVarString(enc, JSON.stringify(payload));
  ws.send(encoding.toUint8Array(enc));
  return true;
}

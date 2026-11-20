import { createContext, useContext } from 'react';

export interface ScriptContextValue {
  /** Tipo de la línea (VTR, ACTING…): decide si los rótulos llevan TC. */
  lineType: string;
  /** Duración de la pieza en segundos (para validar los TC). */
  pieceSeconds: number | null;
  /** Duración por defecto de un rótulo sin TC de salida. */
  defaultSeconds: number;
}

export const ScriptContext = createContext<ScriptContextValue>({
  lineType: '',
  pieceSeconds: null,
  defaultSeconds: 6,
});

export function useScriptContext(): ScriptContextValue {
  return useContext(ScriptContext);
}

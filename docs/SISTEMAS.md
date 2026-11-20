# Otros sistemas (F4.4)

Para equipos sin driver propio, **10 Configuración → Equipos → Otro sistema** crea un conector
genérico. Recibe los cues de las **pistas del timeline** que se marquen (FX, Audio, Rótulos…) y
los manda con una plantilla. Variables: `{cue}` (el «Dato para automatizar» del cue o, si está
vacío, su texto), `{label}`, `{target}` y `{track}`.

| Protocolo | Uso típico                                  | Ejemplo                                          |
| --------- | ------------------------------------------- | ------------------------------------------------ |
| HTTP      | TriCaster (shortcuts), APIs web, Companion  | `http://tricaster/v1/shortcut?name={cue}`        |
| TCP texto | Ross DashBoard / XPression (RossTalk, 7788) | `TAKE {cue}` con fin de línea CR LF              |
| UDP texto | Automatismos y controladores sencillos      | `PLAY {cue}`                                     |
| OSC       | Audio (QLab, mesas digitales), show control | Dirección `/cue/{cue}/start`, argumento opcional |

- Se ejecutan en directo con **Armar equipos** y fuera de ensayo (como el resto de la
  automatización, F4.2). Si un sistema falla, el cue queda marcado con ⚠ en el timeline.
- «Probar cue» manda la plantilla con el valor que escribas; «Probar conexión» abre y cierra la
  conexión TCP sin mandar nada.
- En la nube no se llaman direcciones de la red interna (mismo control que las fuentes); en una
  Station sí.
- Un mismo cue puede ir a un equipo con driver (p. ej. Rótulos → CasparCG) y a otro sistema a la
  vez.

Pendiente según demanda: MOS (intercambio de escaletas con iNEWS/ENPS) y drivers específicos de
Chyron o Autoscript.

# Iluminación (F4.3)

RunFlow dispara la iluminación desde la pista **Luces** del timeline (F4.1/F4.2) o a mano con
«Probar cue» en **10 Configuración → Equipos**. Todo va por UDP desde el servidor (en un estudio,
la Station): las mesas no confirman, así que conviene probar un cue antes del directo.

| Protocolo                  | Qué se manda                               | En el cue se escribe       |
| -------------------------- | ------------------------------------------ | -------------------------- |
| OSC                        | Mensaje a la dirección configurada         | Número de cue (`{cue}`)    |
| MIDI Show Control (ipMIDI) | `GO` MSC (formato iluminación) por UDP     | Número de cue (y lista)    |
| Art-Net                    | Universo DMX completo (ArtDmx)             | Nombre de escena o canales |
| sACN / E1.31               | Universo DMX completo (multidifusión o IP) | Nombre de escena o canales |

## OSC

- **ETC Eos**: dirección `/eos/cue/{cue}/fire`, puerto el de la consola (p. ej. 8000).
- **grandMA3**: dirección `/gma3/cmd`, argumento `Go+ Sequence 1 Cue {cue}`.
- **QLC+, Chamsys, Onyx…**: la dirección que indique su manual; `{cue}` se sustituye.

## MIDI Show Control

Se envía por **ipMIDI** (MIDI en UDP, grupo `225.0.0.37`, puerto 21928) o a la IP de un puente
MIDI de red. Id de dispositivo 127 = todos.

## DMX (Art-Net y sACN)

- **Escenas DMX**: nombre → canales, p. ej. `CALLE` → `1=255,2-4=50%,10=128`.
- En el cue se escribe el nombre de la escena o directamente los canales.
- Si el cue tiene **duración**, se hace un fundido en ese tiempo; si no, el cambio es al corte.
- RunFlow repite el universo cada segundo (sACN considera perdida la fuente a los 2,5 s).
- Art-Net sin dirección: difusión `255.255.255.255`; sACN sin dirección: multidifusión
  `239.255.x.y` del universo.

Los cues de luces solo se ejecutan solos con **Armar equipos** y fuera de ensayo.

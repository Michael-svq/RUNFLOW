# Control de cámara

**Dirección TV → Control de cámara** maneja las cámaras PTZ del plató y vigila su señal.

## Dar de alta una cámara

RunFlow Station → **Equipos** → **Cámara PTZ**:

| Protocolo            | Marcas                                     | Qué hace falta                                       |
| -------------------- | ------------------------------------------ | ---------------------------------------------------- |
| VISCA sobre IP (UDP) | Sony, PTZOptics, Lumens, Avonic, Marshall… | IP, puerto 52381 (0 = por defecto) y dirección VISCA |
| Panasonic AW (HTTP)  | AW-UE, AW-HE…                              | IP y puerto 80                                       |
| Simulada             | —                                          | Nada (para probar sin cámaras)                       |

«Probar conexión» pregunta a la cámara si está encendida. Las cámaras están en la red del
estudio: úsalas desde una **RunFlow Station** (o con la nube en la misma red).

## Qué se puede hacer

- **PTZ**: joystick (velocidad según la distancia al centro; también con las flechas), zoom T/W y
  foco lejos/cerca mientras se pulsan, AF / MF / enfoque automático una vez, velocidad general y
  **12 posiciones** (marca «Grabar posición» y pulsa un número para guardarla).
- **Monitor de señal**: imagen de la cámara (imagen fija de la cámara o una URL JPEG configurada) o
  una **entrada de vídeo del ordenador** (capturadora). Muestra **histograma**, **forma de onda**,
  **vectorscopio** (con las marcas de barras al 75 % y la línea de piel) y **desfile RGB**, más el
  nivel medio, el % de blancos quemados y negros empastados y la dominante de color.
- **Imagen**: diafragma, ganancia, obturador, rojo y azul (balance de blancos), pedestal y
  detalle. Botones de **balance de blancos (AWB)** y **de negros (ABB)** automáticos.
  «Copiar estos ajustes a» los pasa a otras cámaras.
- **Memorias de ajustes**: «Grabar ajustes actuales» guarda la imagen y los objetivos del control
  automático con un nombre; **Leer** los aplica a la cámara y **Copiar a…** a otras. Son de la
  empresa (las ven todas las personas de Dirección TV).
- **Control automático**: con el monitor de señal activo, RunFlow corrige cada momento el
  diafragma (y, si no basta, la ganancia hasta el máximo que pongas) para mantener el **nivel
  medio** dentro del margen, cierra si hay más **blancos quemados** de los permitidos y corrige el
  **color** con las zonas neutras de la imagen. Si la escena es oscura y a la vez tiene blancos
  quemados, no toca nada y lo avisa (hay que revisar la luz).

## Traducción de los ajustes

RunFlow usa sus propias unidades (diafragma 0–100 %, ganancia en dB, rojo/azul y pedestal −50…50) y
cada protocolo las lleva a su rango:

- **VISCA**: exposición manual + `CAM_Iris`, `CAM_Gain`, `CAM_Shutter` directos; balance manual +
  `R/B Gain` directos; `Aperture` para el detalle. El balance de blancos usa _One Push WB_. VISCA no
  tiene balance de negros ni pedestal estándar: RunFlow lo avisa.
- **Panasonic AW**: `#AXI` (diafragma), `OGU` (ganancia), `OSH` (obturador), `ORI`/`OBI` (rojo y
  azul), `OTD` (pedestal), `ODT` (detalle), `OWS` (AWB) y `OAS` (ABB); imagen fija en
  `/cgi-bin/camera`.

Las tablas de cada modelo varían: comprueba los extremos con tu cámara y ajusta las memorias. Lo
probado en automático es la traducción de órdenes y la cámara simulada; con cámaras reales,
pruébalo antes de un directo.

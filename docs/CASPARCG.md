# RunFlow CG con CasparCG

RunFlow controla **CasparCG 2.3+** para los rótulos y el playout de los VTR (PLAN §13 y §15).

## Conexión

1. En CasparCG, deja AMCP en su puerto (5250) y añade RunFlow como cliente OSC para que
   RunFlow conozca la posición real de los vídeos (los rótulos por TC se ajustan a ella):

   ```xml
   <osc>
     <predefined-clients>
       <predefined-client>
         <address>IP-del-servidor-RunFlow</address>
         <port>6250</port>
       </predefined-client>
     </predefined-clients>
   </osc>
   ```

2. En RunFlow, **10 Configuración → Equipos → Añadir CasparCG**: dirección, puerto AMCP,
   puerto OSC, canal y capas (por defecto: VTR 10, inferiores 20, banners 30, fecha/mosca 40).
   _Probar conexión_ muestra la versión y el número de clips.
3. Si CasparCG está en otro equipo, indica en «Dirección de RunFlow vista desde CasparCG» la
   dirección con la que CasparCG llega a RunFlow (p. ej. `http://192.168.1.20:8080`): de ahí
   carga las plantillas. Con CasparCG en el mismo PC que la Station no hace falta.

En una Station enlazada, ajustes y equipos se configuran en la nube y la Station los recibe.

## Plantillas

Siete plantillas HTML (TOT, LOC, INF, DAT, BAN, HIG y RRS de redes sociales) servidas en `/cg/templates/<TIPO>.html`.
RunFlow las lanza con `CG <canal>-<capa> ADD 1 "<url>" 1 "<json>"`; el JSON lleva los textos y
el **diseño de la empresa** (colores, tipografía, alineación, márgenes, animación, mosca), que se
edita en Configuración con una vista previa que usa la misma plantilla. También aceptan datos
XML estándar de CasparCG (`<componentData id="f0">…`).

## En directo

| Situación                       | Qué hace RunFlow                                                 |
| ------------------------------- | ---------------------------------------------------------------- |
| Una línea VTR pasa a SIGUIENTE  | `LOADBG` del clip (precarga, opción de Configuración)            |
| GO a un VTR                     | `PLAY` (instantáneo si estaba precargado) y programa sus rótulos |
| Rótulo con TC de entrada/salida | Entra y sale en esos TC sobre la posición real del vídeo         |
| Rótulo con solo TC de entrada   | Sale tras la duración por defecto (6 s, configurable)            |
| Rótulo de cámara ▶             | Entra; sale con ■ o solo tras la duración (Configuración Master) |
| GO a otra línea                 | Salen los rótulos de la anterior y se para el VTR                |
| VTR parado a mano               | Sus rótulos salen                                                |
| Desarmado o ensayo              | El GO no mueve equipos (▶/■ manuales siguen funcionando)        |
| CasparCG no responde            | Aviso ⚠ en la barra; el directo continúa; se reconecta solo     |

La columna **CLIP** guarda el archivo (sin extensión) y **PLAY** muestra ◼ preparado con su
duración, ► en reproducción con barra y restante, 🔁 bucle o ⚠ si el clip no está en CasparCG.

## Media → CasparCG

En **05 Media** se suben vídeos, imágenes y audio (ffprobe lee duración y tamaño; ffmpeg crea una
vista previa ligera de 480p). Cada fichero tiene un **nombre de clip** (`CARPETA/NOMBRE`, en
mayúsculas y sin acentos) que es el que se escribe en la columna CLIP. Si en Configuración el
CasparCG tiene **Carpeta de medios** (la carpeta `media` del servidor, accesible desde el equipo de
RunFlow, normalmente la Station), el botón **A CasparCG** copia allí el vídeo con ese nombre.
La previsualización muestra el código de tiempo y permite **marcar TC** para los rótulos.

## Sin equipos

`apps/server/src/cg/simulator.ts` es un CasparCG simulado (AMCP + OSC) que usan las pruebas y
que sirve para practicar.

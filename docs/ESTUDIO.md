# Estudio virtual (Docker, un clic)

Para probar RunFlow completo en tu ordenador **sin equipos y sin tocar su configuración**: todo
corre dentro de Docker y solo es accesible desde el propio ordenador.

Incluye RunFlow, su base de datos, un **CasparCG simulado**, un **OBS simulado** y un **monitor de
programa** donde se ve lo que saldría en antena: la cámara o el vídeo en el aire y, encima, los
rótulos con las plantillas reales de RunFlow CG. La primera vez se crean datos de ejemplo: la
escaleta «Informativo de prueba» con guion, rótulos y vídeos, y los equipos ya conectados.

## Windows

1. Instala **Docker Desktop** (https://www.docker.com/products/docker-desktop/) y ábrelo.
2. Descarga RunFlow (en GitHub: _Code → Download ZIP_) y descomprímelo.
3. Doble clic en **`Estudio-RunFlow.bat`**. La primera vez tarda unos minutos (construye la
   imagen); después arranca en segundos.
4. Se abren dos pestañas:
   - **RunFlow**: http://localhost:3000 — `demo@runflow.test` / `runflow-demo`
   - **Monitor de programa**: http://localhost:8090

Para parar: **`Parar-Estudio.bat`** (los datos se conservan). Para empezar de cero:
**`Borrar-Estudio.bat`**.

macOS / Linux: `./estudio.sh` (y `./estudio.sh parar`).

## Qué probar

- **04 Escaletas → Informativo de prueba → GO**: la cabecera sale en el monitor (VTR); con el
  siguiente GO corta a CAM 1. Los equipos ya están armados.
- **Rótulos**: ▶ en el rótulo de la presentadora (columna GRAFISMO o en el guion) y aparece en el
  monitor; en la pieza «PRESUPUESTOS» los rótulos entran solos en su TC.
- **Teleprompter**: botón **Prompter** de la escaleta (o _Salidas_ para abrirlo en otra ventana).
- **Timeline**: botón _Timeline_ de la escaleta; los cues de cámara cortan el OBS a su tiempo.
- Todo lo demás (guion, IA, producción, pantallas, redes…) funciona igual que en la nube.

## Usar tus equipos reales

El estudio virtual ya deja RunFlow configurado; para cambiar a tus programas de verdad instalados
en el mismo Windows, en **10 Configuración → Equipos → Editar**:

| Equipo   | Dirección              | Además                                                                                                                                         |
| -------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| CasparCG | `host.docker.internal` | Puerto 5250. «Dirección de RunFlow vista desde CasparCG»: `http://localhost:3000`. En `casparcg.config` añade un cliente OSC `127.0.0.1:6250`. |
| OBS      | `host.docker.internal` | En OBS: _Herramientas → Ajustes del servidor WebSocket_ (puerto 4455 y contraseña). Pulsa «Leer entradas del mezclador» y asigna tus escenas.  |
| vMix     | `host.docker.internal` | Añade un equipo vMix con puerto 8099 y su mapa de fuentes.                                                                                     |

Los vídeos de la columna CLIP deben estar en la carpeta de medios de CasparCG (05 Media puede
copiarlos si indicas esa carpeta).

## Abrirlo a la red local (tabletas, prompter en otro equipo)

Por seguridad solo escucha en el propio ordenador. Para usar el prompter o la escaleta desde otro
dispositivo de la red, en `docker-compose.estudio.yml` cambia `'127.0.0.1:3000:3000'` por
`'3000:3000'` y vuelve a arrancar; entra con `http://<ip-de-tu-portátil>:3000`.

## Problemas

- **«Falta Docker Desktop»**: instálalo y ábrelo antes de lanzar el estudio.
- **El puerto 3000 u 8090 está ocupado**: cierra el programa que lo usa o cambia el puerto de la
  izquierda en `docker-compose.estudio.yml` (p. ej. `'127.0.0.1:3100:3000'`).
- **Ver qué pasa**: `docker compose -f docker-compose.estudio.yml logs -f app`.

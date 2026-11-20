# Mezcladores y mando

Con **GO**, RunFlow corta el mezclador a la **FUENTE** de la línea que pasa a EN AIRE, a la
vez que CasparCG lanza el VTR (objetivo < 100 ms en red local). Orden de soporte: OBS → vMix
→ ATEM (decisión D13 del PLAN).

## Mapa de fuentes

La columna **FUENTE** de la escaleta dice qué se ve (CAM 1, CAM 2, EXT 1…). Una línea VTR sin
fuente usa «VTR». Cada mezclador traduce esas fuentes a sus entradas en
**10 Configuración → Equipos del estudio**:

| Mezclador | Entrada                                      | Conexión                      |
| --------- | -------------------------------------------- | ----------------------------- |
| OBS       | Nombre de la escena                          | obs-websocket 5 (puerto 4455) |
| vMix      | Número o nombre de la entrada                | API TCP (puerto 8099)         |
| ATEM      | Número de entrada (1 = Cámara 1, 3010 = MP1) | Protocolo ATEM (UDP 9910)     |

Mayúsculas y espacios no importan («cam 2» = «CAM 2»). _Leer entradas del mezclador_ sugiere
los valores de un equipo ya guardado.

- **OBS**: escena directa a programa, o en **modo estudio** a previo + transición.
- **vMix**: `CutDirect` (corte) u otra transición con su duración.
- **ATEM**: corte directo a programa o previo + AUTO, en el M/E elegido.

## Seguridad en directo

- **Armar equipos** desactivado o **Ensayo**: el GO avanza la escaleta sin mover equipos.
- Si un mezclador no responde: aviso ⚠ en la barra de equipos y el directo sigue; se reconecta
  solo.
- La barra muestra la fuente en programa (`PGM CAM 1`) y la latencia del último corte.

## Mando por enlace (Companion, Stream Deck, tablet)

En **Salidas → Tipo: Mando** se crea un enlace con token (solo quien puede dar GO; revocable).

- Abierto en una **tablet**: botones grandes de GO, Volver, Siguiente rótulo y Sacar rótulos,
  con la línea en aire, su tiempo restante y la siguiente.
- En **Bitfocus Companion** (Stream Deck), módulo «Generic HTTP», una petición POST por tecla:

  ```
  POST https://<servidor>/api/public/control/<token>/go
  POST https://<servidor>/api/public/control/<token>/back
  POST https://<servidor>/api/public/control/<token>/next-graphic
  POST https://<servidor>/api/public/control/<token>/clear-graphics
  POST https://<servidor>/api/public/control/<token>/stop
  GET  https://<servidor>/api/public/control/<token>          (estado para las teclas)
  ```

Las órdenes quedan en el registro de emisión a nombre de quien creó el mando. El tiempo mínimo
entre dos GO (700 ms) también protege el mando.

## Pruebas sin equipos

`apps/server/src/mixers/` incluye OBS y vMix simulados (los usan las pruebas); el ATEM se
prueba con un sustituto de `atem-connection`. Falta la prueba con equipos reales.

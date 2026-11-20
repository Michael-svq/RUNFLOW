# API pública de RunFlow (v1)

Para conectar RunFlow con otros sistemas: web de la televisión, grafismo externo, redes,
automatismos, Bitfocus Companion… (PLAN F2.4).

## Tokens

En **10 Configuración → API y webhooks** se crean tokens con permisos:

| Permiso | Permite                                        |
| ------- | ---------------------------------------------- |
| `read`  | Leer escaletas, líneas y el estado del directo |
| `live`  | GO, volver, parar; lanzar y sacar rótulos      |
| `write` | Añadir líneas y cambiar celdas                 |

El token (`rf_…`) se muestra una sola vez y se puede revocar. Va en la cabecera:

```bash
curl -H "Authorization: Bearer rf_…" https://<servidor>/api/v1/rundowns
```

Límite: 600 peticiones por minuto. Las órdenes de directo quedan en el registro de emisión a
nombre de quien creó el token.

## Endpoints

| Método  | Ruta                                    | Permiso | Qué hace                                            |
| ------- | --------------------------------------- | ------- | --------------------------------------------------- |
| `GET`   | `/api/v1/rundowns?from=AAAA-MM-DD&to=…` | read    | Escaletas (las 200 más recientes)                   |
| `GET`   | `/api/v1/rundowns/:id`                  | read    | Escaleta, líneas (celdas) y estado del directo      |
| `GET`   | `/api/v1/rundowns/:id/live`             | read    | Estado del directo                                  |
| `POST`  | `/api/v1/rundowns/:id/live/go`          | live    | GO                                                  |
| `POST`  | `/api/v1/rundowns/:id/live/back`        | live    | Volver                                              |
| `POST`  | `/api/v1/rundowns/:id/live/stop`        | live    | Terminar                                            |
| `POST`  | `/api/v1/rundowns/:id/cg/take`          | live    | ▶ rótulo `{ "graphicId": "…" }`                    |
| `POST`  | `/api/v1/rundowns/:id/cg/out`           | live    | ■ rótulo `{ "graphicId": "…" }`                     |
| `POST`  | `/api/v1/rundowns/:id/lines`            | write   | Nueva línea `{ "cells": {…}, "index": 0 }`          |
| `PATCH` | `/api/v1/rundowns/:id/lines/:lineId`    | write   | Cambiar celdas `{ "cells": { "presenta": "EDU" } }` |

Las celdas usan las claves de las columnas: `nombre`, `tipo` (`ACTING`, `TEMA`, `VTR`…),
`t_est` (segundos), `presenta`, `fuente`, `clip`, `dur_vtr`, `observaciones`… (ver
`packages/core/src/rundown.ts`). Los cambios llegan al instante a quien tiene la escaleta abierta.

## Webhooks

RunFlow envía un `POST` JSON a la dirección configurada en cada evento elegido:

| Evento        | Cuándo                  | `data`                                                                                             |
| ------------- | ----------------------- | -------------------------------------------------------------------------------------------------- |
| `live.go`     | Cambia la línea EN AIRE | `rundownId`, `onAir` (`lineId`, `num`, `name`, `type`, `startedAt`), `previousLineId`, `rehearsal` |
| `live.ended`  | Termina el directo      | `rundownId`, `endedAt`                                                                             |
| `graphic.in`  | Entra un rótulo         | `rundownId`, `graphicId`, `lineId`, `type`, `auto`                                                 |
| `graphic.out` | Sale un rótulo          | igual                                                                                              |

Cuerpo: `{ "id", "event", "createdAt", "orgId", "data" }`. Cabeceras: `X-RunFlow-Event` y
`X-RunFlow-Signature: t=<segundos>,v1=<firma>`, con `firma = HMAC-SHA256(secreto, "<t>.<cuerpo>")`
en hexadecimal (el secreto `whsec_…` se muestra al crear el webhook). Se reintenta dos veces si
falla; el último estado se ve en Configuración y hay un botón de prueba (evento `ping`).

```js
// Comprobar la firma (Node)
const [, t] = sig.match(/t=(\d+)/);
const [, v1] = sig.match(/v1=([0-9a-f]+)/);
const ok = crypto.createHmac('sha256', secreto).update(`${t}.${cuerpo}`).digest('hex') === v1;
```

## Companion / Stream Deck

Para teclas de GO y rótulos sin tokens de API, usa la salida **Mando** (ver
`docs/MEZCLADORES.md`); con un token `live`, el módulo «Generic HTTP» de Companion también puede
llamar a `/api/v1/…` con la cabecera `Authorization`.

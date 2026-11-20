# 0003 · Colaboración en tiempo real con Yjs y servidor propio

Estado: aceptada (M1)

## Contexto

Varias personas editan la misma escaleta a la vez, a veces sin red (plató, exteriores).
No se puede perder ningún cambio y todas deben ver lo mismo.

## Decisión

- **Yjs (CRDT)**: cada escaleta es un documento Yjs (`packages/sync`). Las líneas están en un
  mapa por id con **posición fraccional**; mover una línea es cambiar su posición, así que dos
  personas moviendo a la vez nunca la duplican. Los empates se ordenan por id en todos los clientes.
- Cada celda es un valor independiente: dos ediciones en celdas distintas se combinan; en la
  misma celda gana la última.
- **Servidor propio** del protocolo estándar (`y-protocols` sync + awareness) en
  `apps/server/src/collab`, compatible con el cliente `y-websocket`. Se descartó Hocuspocus 4 por
  ser una versión mayor muy reciente: así controlamos sesión, permisos y guardado.
- Autenticación por la cookie de sesión; se comprueba el `Origin` (secuestro de WebSocket entre
  sitios). Si no procede, se cierra con códigos 44xx y el cliente no reintenta.
- **Solo lectura**: sin `rundown.edit_cells` ni `rundown.edit_structure`, el servidor ignora los
  cambios de esa conexión. La diferencia entre editar celdas y editar estructura se aplica en la
  interfaz (el servidor no distingue aún operaciones dentro de una actualización Yjs).
- **Guardado**: el documento se guarda en `rundowns.ydoc` agrupando cambios (≤ 5 s) y siempre al
  salir la última persona; se proyectan las líneas en `rundown_lines` para listados e informes.
- **Sin conexión**: copia local en IndexedDB (`y-indexeddb`); al volver la red se fusiona.
  Los eventos `offline`/`online` del navegador cambian el estado al instante.
  Al cerrar sesión se borran las copias locales.

## Consecuencias

- Un solo proceso de servidor mantiene los documentos abiertos; para escalar en la nube habrá
  que repartir por escaleta o añadir Redis (más adelante).
- Recargar la página sin red todavía no funciona (la sesión se consulta al servidor).

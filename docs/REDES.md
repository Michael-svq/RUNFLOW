# Redes sociales (F3.4)

**03 Social Media** reúne publicaciones de redes y mensajes de la audiencia para moderarlos y
rotularlos en directo con el rótulo de redes (**RRS**: nombre, @usuario, texto y red).

## Búsquedas automáticas (hasta 6 por empresa)

| Red      | Qué se sigue                                     | Clave                                 |
| -------- | ------------------------------------------------ | ------------------------------------- |
| Bluesky  | `#hashtag`, `@cuenta` o palabras                 | No (API pública)                      |
| Mastodon | `#hashtag` o `@cuenta` en el servidor que elijas | No (API pública del servidor)         |
| X        | `#hashtag`, `@cuenta` o palabras                 | Bearer token de la API de X (de pago) |
| YouTube  | Comentarios de un vídeo o directo (id o enlace)  | Clave de la API de YouTube Data v3    |

- Se leen cada 2 minutos (`SOCIAL_POLL_MS`; `0` para no leer solas) y con «Leer» a mano.
- Las claves se guardan cifradas y no se vuelven a mostrar.
- Si una red falla, el error queda a la vista en la búsqueda; el resto sigue.
- En la nube no se leen direcciones de la red interna (mismo control que las fuentes RSS).

## Mensajes de la audiencia

WhatsApp, Instagram, llamadas… se escriben o pegan a mano en «Mensaje de la audiencia» y entran
ya aprobados.

## Moderación y rotulación

1. Las publicaciones llegan a **Nuevas**; se **aprueban** o se **descartan**.
2. **Rotular…** añade a una escaleta una línea de GRAFISMO con el rótulo RRS.
3. En la escaleta, la pestaña **Redes** del panel lista las aprobadas: «Rotular aquí» añade el
   rótulo a la línea seleccionada. Sale con ▶/■ como cualquier rótulo (plantilla RRS de
   RunFlow CG, capa de banner).

Los textos se recortan a las longitudes del rótulo (280 caracteres de texto).

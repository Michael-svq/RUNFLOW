# RunFlow — Plan maestro

> Sistema de escaletas, guiones, rótulos, teleprompter y producción para TV local, educación y eventos.
> Web (PWA) multiempresa en la nube **y** funcionamiento local sin conexión mediante **RunFlow Station**.

Estado: **M0 a M9 y lanzamiento terminados** (falta: publicar staging, que necesita un servidor; probar M7–M8 con equipos reales y M9 con claves reales; verificación de email y textos legales). Fase II terminada: **F2.1 Media**, **F2.2 Fuentes**, **F2.3 Directo y streaming** y **F2.4 API pública**. Siguiente: **beta privada** y la **Fase III**. Documento vivo: se actualiza en cada hito.

---

## Índice

1. Visión y principios
2. Decisiones tomadas
3. Usuarios y roles
4. Modos de despliegue
5. Arquitectura
6. Stack tecnológico
7. Estructura del repositorio
8. Modelo de datos
9. Sincronización en tiempo real y sin conexión
10. Motor de tiempos
11. Directo: botón GO
12. Editor de guion
13. Rótulos
14. Teleprompter y salidas
15. RunFlow CG (CasparCG)
16. RunFlow Station
17. Mezcladores e integraciones
18. Inteligencia artificial
19. Media (Fase II)
20. Fuentes, agencias y redes (Fase II–III)
21. Producción (Fase III)
22. Timeline horizontal de directo (Fase IV)
23. Interfaz de usuario
24. Mapa de pantallas
25. Configuración
26. Permisos
27. Exportación e impresión
28. Seguridad, privacidad y licencias
29. Modelo de negocio
30. Infraestructura
31. Calidad y pruebas
32. Hitos y criterios de aceptación
33. Riesgos
34. Preguntas abiertas
35. Glosario

---

## 1. Visión y principios

RunFlow es la herramienta central de un programa de TV o de un evento en directo: desde que se escribe el guion hasta que sale al aire. Es una herramienta parecida a un sistema de redacción profesional (tipo iNews/ENPS) pero **sin editor de vídeo** y con más peso en **producción, realización y departamentos técnicos**.

Principios:

- **Familiar:** la escaleta se ve y se usa como la hoja que ya usan los equipos (ver `docs/referencias/`).
- **Solo navegador:** ningún usuario instala nada. Lo único instalable es RunFlow Station, una vez por estudio, y solo si hay equipos o se necesita trabajar sin internet.
- **El directo no puede fallar:** el control de directo funciona en la red local aunque se caiga internet.
- **Semántica antes que color:** el color del texto del guion es presentación; internamente cada fragmento tiene un tipo (paso, off, rótulo) y de ahí salen el prompter, los rótulos y los PDF.
- **Un único código:** el mismo servidor funciona en la nube (SaaS) y en local (Station).
- **Configurable por niveles:** Empresa → Programa → Escaleta.
- **Entregas cortas y probables en estudio real.**

---

## 2. Decisiones tomadas

| #   | Decisión                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------- |
| D1  | Público: TV local, educación y eventos (prioridad TV local y educación).                                            |
| D2  | Debe funcionar en local, sin internet, con un ordenador como servidor.                                              |
| D3  | Motor de rótulos y playout: **CasparCG**, integrado y controlado directamente desde RunFlow.                        |
| D4  | Multiempresa: SaaS en la nube + solución local con servidor propio.                                                 |
| D5  | IA multiproveedor: cada empresa configura su API (Anthropic, OpenAI, Gemini…; Ollama en local).                     |
| D6  | Se desarrollan todas las fases, por hitos.                                                                          |
| D7  | Botón **GO** para pasar al siguiente evento y mover los equipos (CasparCG, mezclador, rótulos).                     |
| D8  | Rótulos de VTR automáticos por código de tiempo `mm:ss`; rótulos de cámara manuales con ▶/■.                       |
| D9  | Duración por defecto de rótulo: **6 s**, configurable. Salida automática en cámara según Configuración Master.      |
| D10 | Interfaz muy parecida a la escaleta aportada (gris oscuro, naranja RunFlow, celdas de color).                       |
| D11 | Acceso por navegador; sin apps nativas. Station es un servicio sin ventanas, administrado desde el navegador.       |
| D12 | Sin publicidad dentro de la app (tampoco en el plan gratuito); en su lugar, plan gratuito limitado.                 |
| D13 | Orden de mezcladores: **OBS → vMix → ATEM**.                                                                        |
| D14 | Autonext activado por defecto en VTR, configurable.                                                                 |
| D15 | Cada media/VTR tiene **duración + coleo** (ej. `0:50 +5`): el coleo son segundos de seguridad tras el final.        |
| D16 | Marca: paleta `#FF7A1A` `#FFD24A` `#A3C94A` `#2F7D32` `#1F2A2E`; tipografías Helvetica y Montserrat (Bold/Black).   |
| D17 | Velocidad de lectura por defecto: 3 palabras/segundo. Numeración de líneas de 2 en 2, configurable.                 |
| D18 | Solo español en el lanzamiento, preparado para más idiomas.                                                         |
| D19 | Columnas redimensionables y movibles; la disposición se guarda como **vista con nombre** y se puede elegir después. |

---

## 3. Usuarios y roles

| Rol                             | Qué hace principalmente                                     |
| ------------------------------- | ----------------------------------------------------------- |
| Administrador de empresa        | Usuarios, licencias, configuración global                   |
| Productor / Editor jefe         | Crea escaletas, ordena, aprueba, controla tiempos           |
| Redactor / Periodista           | Escribe guion (paso, off, rótulos) de sus piezas            |
| Realizador                      | Ejecuta el directo (GO), vista realización                  |
| Operador CG                     | Lanza / revisa rótulos                                      |
| Presentador / Operador prompter | Teleprompter, vista de presentador                          |
| Técnicos (VTR, sonido, cámaras) | Vistas de sus columnas, estados (VTR OK, fuentes)           |
| Producción                      | Invitados, teléfonos, sets, logística (y Fase III completa) |
| Profesor / Alumno (educación)   | Igual que los anteriores con clases y grupos                |
| Invitado / Solo lectura         | Ver escaleta o una salida concreta                          |

Los roles son plantillas de permisos; cada empresa puede crear los suyos (ver §26).

---

## 4. Modos de despliegue

| Modo        | Para quién                                      | Cómo funciona                                                                                                                                                                                 |
| ----------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Nube**    | Escuelas, productoras sin equipos que controlar | Todo en `app.runflow.tv`. Nada que instalar.                                                                                                                                                  |
| **Híbrido** | TV local con equipos                            | Nube + Station en el control. El estudio trabaja contra Station (red local); los redactores fuera, contra la nube. Station y nube se sincronizan solos. Si se cae internet, el estudio sigue. |
| **Local**   | Quien no quiera nube                            | Solo Station. Todo dentro de la red del centro. Licencia local.                                                                                                                               |

---

## 5. Arquitectura

```
                       ┌────────────────────────────────────────────┐
                       │                NUBE (SaaS)                 │
   Navegadores  ◄─────►│  Web PWA   API   Sync (Yjs)   Workers      │
   (redacción, casa)   │  Postgres   Almacenamiento (R2)   IA       │
                       └───────────────────▲────────────────────────┘
                                           │ WebSocket saliente (sin abrir puertos)
                                           │ sincronización bidireccional
                       ┌───────────────────┴────────────────────────┐
                       │      RUNFLOW STATION (PC del control)      │
   Navegadores  ◄─────►│  mismo servidor + Postgres local           │
   (control, plató,    │  Motor de directo (autoridad del GO)       │
   prompter, tablets)  │  Drivers: CasparCG · ATEM · vMix · OBS     │
                       │  Servidor de plantillas HTML de rótulos    │
                       └──────┬───────────┬───────────┬─────────────┘
                              │ AMCP/OSC  │ UDP       │ HTTP/WS
                          CasparCG      ATEM       vMix / OBS
```

Piezas:

- **Web (PWA):** toda la interfaz, incluidas las salidas (prompter, relojes, presentador).
- **API:** autenticación, empresas, permisos, configuración, ficheros, IA, exportaciones.
- **Sync:** documentos colaborativos (escaleta y guiones) con Yjs (CRDT): varios usuarios editan a la vez sin conflictos, y funciona sin conexión.
- **Motor de directo:** máquina de estados del directo (línea EN AIRE, SIGUIENTE, rótulos activos, relojes). **Tiene una sola autoridad**: Station si existe; si no, el servidor de la nube. No se guarda como documento colaborativo, para que dos personas no puedan "pisarse" el GO.
- **Drivers de equipos:** solo en Station.
- **Workers:** transcodificación de media, PDF pesados, ingestas de agencias.

---

## 6. Stack tecnológico

| Capa                          | Elección                                                      | Motivo                                                              |
| ----------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------- |
| Lenguaje                      | TypeScript en todo                                            | Un solo lenguaje para web, servidor y Station                       |
| Web                           | React + Vite + `vite-plugin-pwa`                              | Estándar, rápido, PWA instalable                                    |
| Rejilla de escaleta           | Componente propio sobre TanStack Table + TanStack Virtual     | Comportamiento tipo hoja de cálculo, miles de filas fluidas         |
| Editor de guion               | TipTap (ProseMirror) + `y-prosemirror`                        | Edición colaborativa, marcas y bloques propios (paso/off/rótulo)    |
| Estado en cliente             | Zustand + Yjs                                                 | Simple                                                              |
| Colaboración                  | Yjs + Hocuspocus                                              | CRDT probado, persistencia y permisos en servidor                   |
| Servidor                      | Node 22 + Fastify + WebSocket                                 | Rendimiento y ecosistema                                            |
| Base de datos                 | PostgreSQL 16 + Drizzle ORM                                   | Igual en nube y local                                               |
| Autenticación                 | Propia: scrypt + sesiones en Postgres (ver `docs/adr/0001`)   | Sin dependencias nativas (Station), control total; SSO más adelante |
| Mensajería entre nodos (SaaS) | Redis (solo nube a escala)                                    | Station no lo necesita                                              |
| Ficheros                      | S3 compatible (Cloudflare R2) en nube; disco local en Station | Sin coste de salida                                                 |
| Subidas                       | Protocolo tus (subidas reanudables)                           | Vídeos grandes                                                      |
| Transcodificación             | ffmpeg en worker                                              | Proxies, miniaturas, duración                                       |
| PDF                           | Generación en el navegador (pdfmake o react-pdf)              | Funciona igual sin conexión                                         |
| Importar/Exportar             | CSV, XLSX (ExcelJS), JSON propio                              | Migrar desde hojas actuales                                         |
| CasparCG                      | `casparcg-connection` (AMCP) + OSC                            | Librería madura                                                     |
| ATEM                          | `atem-connection`                                             | Librería madura                                                     |
| OBS                           | `obs-websocket-js` (v5)                                       | Oficial                                                             |
| vMix                          | API HTTP/TCP de vMix                                          | Oficial                                                             |
| Descubrimiento en red         | mDNS (`bonjour-service`)                                      | Encontrar Station y equipos                                         |
| Pruebas                       | Vitest, Playwright, simuladores propios de equipos            |                                                                     |
| Monorepo                      | pnpm workspaces (Turborepo si el monorepo crece)              |                                                                     |
| CI                            | GitHub Actions                                                |                                                                     |
| Errores                       | Sentry (desactivable en local)                                |                                                                     |

---

## 7. Estructura del repositorio

```
RUNFLOW/
├─ apps/
│  ├─ web/            PWA: escaleta, guion, directo, salidas, configuración
│  ├─ server/         API + Sync + Motor de directo (modo nube o station)
│  └─ station/        Empaquetado de Station: server + drivers + admin + instaladores
├─ packages/
│  ├─ core/           Tipos, reglas y MOTOR DE TIEMPOS (puro, sin dependencias)
│  ├─ sync/           Esquema Yjs de escaleta y guion
│  ├─ db/             Esquema Drizzle y migraciones
│  ├─ devices/        Drivers CasparCG/ATEM/vMix/OBS + simuladores
│  ├─ cg-templates/   Plantillas HTML de rótulos + SDK de plantillas
│  ├─ ui/             Sistema de diseño (tokens, componentes)
│  ├─ ai/             Capa multiproveedor de IA
│  └─ pdf/            Vistas de impresión
├─ docs/
│  ├─ PLAN.md         Este documento
│  ├─ referencias/    Material aportado (escaleta, propuesta, comparativa)
│  └─ adr/            Registro de decisiones técnicas
└─ .github/workflows/ CI
```

---

## 8. Modelo de datos

Todas las tablas de negocio llevan `org_id` y se protegen con **Row Level Security** en Postgres (una empresa nunca ve datos de otra).

### Núcleo

| Entidad                | Campos principales                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `organizations`        | nombre, plan, modo (nube/híbrido/local), logo, zona horaria                                              |
| `users`, `memberships` | usuario ↔ empresa ↔ rol                                                                                |
| `roles`, `permissions` | permisos por capacidad (§26)                                                                             |
| `programs`             | nombre, tipo (informativo, deportes, magacín, evento…), plantilla, configuración                         |
| `rundowns` (escaletas) | programa, fecha, hora inicio, hora fin, modo de tiempo, estado (borrador/lista/en aire/cerrada), doc Yjs |
| `rundown_lines`        | proyección de la escaleta para búsquedas e informes: orden, nº, tipo, campos (JSONB), duraciones         |
| `blocks`               | bloques/segmentos (ej. "HEADLINES 1") con reloj propio                                                   |
| `line_types`           | ACTING, TEMA, VTR, COLAS, MOCHILA, FIBRA, GRAFISMO… con color, comportamiento y fuente por defecto       |
| `column_defs`          | catálogo de columnas (fijas y personalizadas)                                                            |
| `views`                | vistas por puesto: columnas visibles, orden, anchos                                                      |
| `scripts`              | guion de cada línea (fragmento Yjs) + proyección de texto paso/off                                       |
| `graphics` (rótulos)   | línea, tipo, campos, tc_in, tc_out, modo (auto/manual), estado                                           |
| `graphic_types`        | TOT, LOC, INF, DAT, BAN, HIG… campos con longitud máxima y plantilla                                     |
| `graphic_templates`    | diseño HTML versionado por empresa                                                                       |
| `people`               | base de datos de personas y cargos para rótulos                                                          |
| `settings`             | clave/valor con ámbito empresa/programa/escaleta                                                         |

### Colaboración y archivo

| Entidad                     | Uso                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `rundown_templates`         | plantillas (News, Deportes, Magacín…)                                                            |
| `fridge_items` (nevera)     | líneas, temas e historias preconfiguradas                                                        |
| `versions`                  | historial de versiones de escaletas y guiones                                                    |
| `trash`                     | papelera con caducidad                                                                           |
| `chat_channels`, `messages` | chat por escaleta, directos entre usuarios                                                       |
| `asrun_log`                 | **registro de emisión**: qué salió al aire y cuándo (útil para TV local, publicidad y auditoría) |
| `audit_log`                 | quién cambió qué                                                                                 |

### Equipos, media y otros

| Entidad                            | Uso                                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| `stations`                         | Stations registradas, estado, versión                                                          |
| `devices`                          | CasparCG, mezcladores… con conexión                                                            |
| `source_map`                       | CAM 1 → entrada 1 del mezclador, VTR 1 → CasparCG canal 1 capa 10 …                            |
| `media_assets`, `media_renditions` | Fase II                                                                                        |
| `ai_providers`                     | proveedor, modelo, clave cifrada                                                               |
| `licenses`                         | licencias de Station                                                                           |
| Fase III                           | `projects`, `crew`, `call_sheets`, `guests`, `logistics`, `budgets`, `budget_lines`, `screens` |

---

## 9. Sincronización en tiempo real y sin conexión

- Cada escaleta es un documento Yjs: lista ordenada de líneas, cada una con sus celdas, y un subdocumento de guion por línea.
- Cambios visibles en los demás usuarios en < 300 ms (red normal).
- **Presencia:** se ve quién está en cada celda o guion (color y nombre).
- **Sin conexión en el navegador:** el usuario sigue editando; al volver la red se fusiona sin conflictos.
- **Nube ↔ Station:** Station mantiene copia de las escaletas de sus programas y se sincroniza con la nube por el mismo protocolo. Si se corta internet, el estudio sigue; al volver, se fusiona.
- **Proyección relacional:** el servidor vuelca el contenido de Yjs a tablas Postgres para listados, búsquedas, informes y PDF.
- **Bloqueos opcionales:** guion "aprobado" bloqueado para redactores; escaleta "en aire" con cambios de estructura avisados al realizador.
- **Reloj común:** todos los clientes calculan su desfase con la hora del servidor (como NTP) para mostrar exactamente los mismos tiempos. Station se sincroniza por NTP con la hora oficial.

---

## 10. Motor de tiempos

Paquete puro en `packages/core`, probado con tests deterministas.

### Definiciones

| Término                              | Definición                                                                                                                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duración estimada                    | Introducida a mano o calculada: en ACTING/paso, por nº de palabras ÷ velocidad de lectura (3 palabras/s por defecto); en VTR = DUR. VTR (+ colas).                         |
| Coleo                                | Segundos de seguridad tras el final de un media/VTR (columna COLEAs). Se muestra como `0:50 +5`. No suma a la duración de la línea: es margen por si el corte llega tarde. |
| Duración real                        | Medida entre el GO que entra la línea y el GO que la saca.                                                                                                                 |
| Hora prevista de inicio (front-time) | Hora inicio programa + Σ duraciones anteriores (reales en las emitidas, estimadas en las pendientes).                                                                      |
| Back-time                            | Hora fin programa − Σ duraciones restantes. Indica a qué hora debe empezar cada línea para acabar en hora.                                                                 |
| Descuadre                            | Hora fin prevista − hora fin programada. **+ (rojo)** = vamos largos; **− (verde)** = vamos cortos.                                                                        |
| Sumatorio tiempo VTR                 | Suma acumulada de duraciones de VTR.                                                                                                                                       |
| Línea flotante                       | Excluida del cálculo (ej. reserva).                                                                                                                                        |
| Hora fija (hard time)                | Línea que debe empezar a una hora exacta.                                                                                                                                  |

Se puede alternar la vista entre **hora real** y **hora estimada**.

### Modos de funcionamiento

| Modo       | Comportamiento                                                                |
| ---------- | ----------------------------------------------------------------------------- |
| Manual     | Solo avanza con GO.                                                           |
| Automático | Cada línea pasa a la siguiente al cumplir su duración.                        |
| Híbrido    | Automático en las líneas marcadas (ej. VTR con autonext), manual en el resto. |
| Evento     | Arranca solo a la hora programada y respeta las horas fijas.                  |

### Relojes (cabecera, como en la referencia)

- **Escaleta (inicio hh:mm):** tiempo hasta inicio / hasta fin / descuadre.
- **Bloque actual** (ej. HEADLINES 1): transcurrido / restante.
- **Línea en aire:** cuenta adelante y cuenta atrás.
- **Cronómetro** libre.
- **Media en reproducción:** duración + coleo del VTR en aire (ej. `0:50 +5`). La cuenta atrás llega a 0 al final de la duración y después cuenta el coleo en ámbar; al agotarse el coleo, aviso en rojo.

Colores de cuenta atrás configurables (ej. amarillo a 30 s, rojo a 10 s, parpadeo en 0).

---

## 11. Directo: botón GO

### Estados de línea en directo

🔴 **EN AIRE** · 🟢 **SIGUIENTE** · ⚪ pendiente · ✔ emitida · ⏭ saltada

### Al pulsar GO (botón, espacio, Stream Deck o pedal)

1. Si la siguiente es un VTR: CasparCG lanza el clip (precargado con antelación configurable).
2. El mezclador corta a la fuente de la línea (según `source_map`).
3. Se programan los rótulos automáticos (VTR por TC) y se dejan listos los manuales.
4. La línea anterior pasa a EMITIDO; se registran tiempos reales y descuadre.
5. La siguiente línea pasa a SIGUIENTE (saltando flotantes y ocultas).
6. Se escribe en el registro de emisión (`asrun_log`).

Objetivo de latencia: **< 100 ms** del GO al equipo en red local.

### Autonext

Un VTR pasa solo a la línea siguiente al terminar su duración (**activado por defecto en VTR**; configurable por tipo de línea y por línea). Opción de configuración: cortar al final de la duración (por defecto) o al final del coleo.

### Seguridad

- Protección contra doble pulsación (tiempo mínimo entre GO configurable).
- **Armar / desarmar** automatismos: desarmado, el GO avanza la escaleta sin mover equipos.
- **Modo ensayo:** igual que desarmado, marcado visualmente.
- Saltar línea, volver atrás, "fijar como siguiente" cualquier línea.
- Toma manual en cualquier momento; los equipos no se bloquean.
- Solo los roles con permiso de directo ven el GO; un único "puesto de GO" activo a la vez (los demás ven el estado).
- Si un equipo no responde: aviso ⚠ en la celda y en la cabecera, el directo continúa.

---

## 12. Editor de guion

Cada línea tiene su guion, editable en un panel lateral o a pantalla completa.

| Tipo       | Color           | Uso                                  | Destino                                    |
| ---------- | --------------- | ------------------------------------ | ------------------------------------------ |
| **Paso**   | 🟢 Verde        | Lo que lee el presentador            | Teleprompter, PDF de presentador           |
| **Off**    | ⚫ Negro        | Lo que se locuta en la pieza         | PDF, exportación a edición o IA de voz     |
| **Rótulo** | 🔵 Azul         | Bloque estructurado (no texto libre) | Lista de rótulos, CasparCG, PDF de rótulos |
| Nota       | Gris (opcional) | Indicaciones internas                | No sale en prompter                        |

- Atajos para cambiar de tipo (ej. `Ctrl+1/2/3`).
- Contador de palabras y **duración estimada** del paso según velocidad de lectura del presentador.
- Estados de guion: borrador → revisado → aprobado (relacionado con el estado de la línea).
- Comentarios y sugerencias en el texto.
- Asistencia de IA (§18).

---

## 13. Rótulos

### Tipos por defecto (editables en configuración)

| Tipo | Nombre      | Campos                                |
| ---- | ----------- | ------------------------------------- |
| TOT  | Total       | NOMBRE + CARGO                        |
| LOC  | Localizador | LOCALIZACIÓN, PROVINCIA               |
| INF  | Informa     | NOMBRE PERIODISTA + CÁMARA y/o EDITOR |
| DAT  | Fecha       | FECHA                                 |
| BAN  | Banner      | LÍNEA 1 + LÍNEA 2                     |
| HIG  | Highlights  | LÍNEA 1 + LÍNEA 2                     |

Cada tipo define: campos, obligatorios, **longitud máxima por campo**, plantilla de diseño y duración por defecto. Se pueden crear tipos nuevos.

### Creación

1. En el guion, insertar rótulo → elegir tipo → aparecen sus campos.
2. Autocompletado desde la base de datos de personas y cargos (TOT, INF).
3. Contador de caracteres; no permite pasar del máximo.
4. Vista previa idéntica a la salida real (misma plantilla HTML).
5. En líneas VTR: campos **TC entrada** y **TC salida** en formato `mm:ss`.

### Reglas de entrada y salida

| Caso                           | Entrada                  | Salida                                                                             |
| ------------------------------ | ------------------------ | ---------------------------------------------------------------------------------- |
| VTR con TC entrada y TC salida | Automática en TC entrada | Automática en TC salida                                                            |
| VTR solo con TC entrada        | Automática en TC entrada | Automática tras la duración por defecto (6 s)                                      |
| Cámara / directo (sin TC)      | Manual ▶                | Manual ■ **o** automática tras la duración por defecto, según Configuración Master |

- Sincronizado con la **posición real del vídeo** en CasparCG, no con un reloj aparte.
- Si el VTR se para o se salta, sus rótulos salen.
- Validación: TC dentro de la duración del clip; aviso si dos rótulos se solapan en la misma capa.

### Celda de rótulo en la escaleta

- ▶ entra el rótulo → celda roja, botón pasa a ■ → ■ lo saca.
- Varios rótulos por línea: cada uno con su ▶/■.
- Estados: ⚪ preparado · 🔴 en aire · ✔ emitido · ⚠ error.
- Atajo "siguiente rótulo" (teclado / Stream Deck).

---

## 14. Teleprompter y salidas

### Teleprompter

- Muestra solo el **paso (verde)** de las líneas, en orden de escaleta, con separadores de línea y nº.
- Actualización en vivo si el redactor cambia el texto.
- Control: operador (teclado, ratón, rueda), **pedal o mando** (Gamepad/WebHID), tablet como mando remoto.
- Opciones: tamaño, interlineado, márgenes, **espejo**, marcador de lectura, cuenta atrás de línea, colores.
- Sigue al GO opcionalmente (salta a la línea en aire).
- Varias salidas sincronizadas (cámara 1, cámara 2, tablet del presentador).

### Salidas (páginas a pantalla completa por URL)

| Salida            | Contenido                                                   |
| ----------------- | ----------------------------------------------------------- |
| Prompter          | Texto del paso                                              |
| Presentador       | Prompter + relojes + siguiente línea + mensajes del control |
| Relojes           | Relojes de escaleta/bloque/línea, configurables             |
| Agenda            | Lista simplificada de la escaleta con horas                 |
| Rótulos (preview) | Rótulo en aire y siguiente                                  |
| Multivista        | Varias de las anteriores en cuadrícula                      |
| Mensajes          | Mensajes del control al plató (como stagetimer)             |

Cada salida se abre con un **enlace con token** (sin usuario), revocable, para TV, tablets o mini-PC. Se pueden fijar en Station para que arranquen solas.

---

## 15. RunFlow CG (CasparCG)

- Plantillas de rótulos en **HTML/CSS/JS** (CasparCG 2.3+ las ejecuta). Las sirve Station por HTTP.
- La **misma plantilla** se usa en la vista previa del navegador → lo que se ve es lo que sale.
- **Editor de diseño por empresa:** logo, colores, tipografías, posiciones, animación de entrada/salida, longitudes.
- Mapa de capas configurable (ej. canal 1: capa 10 VTR, capa 20 rótulos inferiores, capa 30 banners, capa 40 logo/fecha).
- Control por AMCP (TCP 5250) y lectura de posición de vídeo por OSC.
- Playout de VTR desde CasparCG: cargar, precargar (preroll), play, pausa, bucle, stop; estado reflejado en la columna PLAY (◼ preparado + duración, ► en reproducción con barra y restante, 🔁 bucle).
- Funciones básicas en Fase I (M7); en Fase II se añade la gestión completa de media.
- Comprobación de que los clips de la escaleta existen en el servidor CasparCG (columna VTR OK).

---

## 16. RunFlow Station

- Servicio **sin ventanas** para Windows, macOS y Linux (instalador que incluye Node y Postgres y se registra como servicio) o imagen Docker.
- Se administra desde el navegador: `https://<nombre>.station.runflow.tv` o IP local.
- Funciones: servidor local completo, motor de directo, drivers de equipos, plantillas CG, copia de seguridad local, sincronización con la nube.
- Se anuncia en la red (mDNS) y detecta equipos.
- Conexión a la nube **saliente** (no hay que abrir puertos en el router).
- Actualizaciones desde la consola web (nunca en mitad de un directo).
- **HTTPS en red local** (necesario para PWA): certificado real por Station con dominio propio, al estilo Plex (se renueva cuando hay internet); alternativa sin internet: autoridad de certificación local instalable. _(Riesgo técnico, §33)_

### Requisitos mínimos

| Uso                                           | Equipo                                               |
| --------------------------------------------- | ---------------------------------------------------- |
| Solo servidor local                           | PC i5 / 16 GB RAM / SSD 512 GB / red 1 Gb            |
| Station + CasparCG en el mismo PC (educación) | Además GPU dedicada; salida NDI o pantalla           |
| CasparCG profesional                          | PC aparte con GPU + Blackmagic DeckLink (salida SDI) |

---

## 17. Mezcladores e integraciones

| Integración                                                      | Fase       | Uso                                                   |
| ---------------------------------------------------------------- | ---------- | ----------------------------------------------------- |
| CasparCG                                                         | I (M7)     | Rótulos, VTR                                          |
| OBS                                                              | I (M8, 1º) | Cambio de escena, inicio/fin de grabación y streaming |
| vMix                                                             | I (M8, 2º) | Corte de entrada, títulos, streaming                  |
| ATEM                                                             | I (M8, 3º) | Corte de fuente en GO, estado de PGM/PVW              |
| Bitfocus Companion / Stream Deck                                 | I (M8)     | GO, rótulos, prompter                                 |
| Vista presentador + control de streaming                         | II         | Sobre OBS/vMix (RunFlow no emite vídeo)               |
| TriCaster, Ross, XPression, Chyron, Wirecast, XSplit, Autoscript | IV         | Según demanda                                         |
| Iluminación (OSC, MIDI, sACN/Art-Net)                            | IV         | Cues de luces                                         |
| Protocolo MOS                                                    | IV         | Integración con sistemas broadcast                    |
| API pública + webhooks                                           | II         | Integraciones de terceros                             |

Orden dentro de M8: **OBS → vMix → ATEM**.

---

## 18. Inteligencia artificial

- Capa común en `packages/ai`; proveedores: Anthropic, OpenAI, Google Gemini, Mistral, **Ollama (local)**.
- Cada empresa configura sus proveedores, claves (cifradas) y modelo por defecto; las llamadas se hacen **desde el servidor**, nunca con la clave en el navegador.
- Límites de uso por empresa y registro de consumo.

Funciones:

- Corregir ortografía y estilo.
- Generar un paso a partir del off (y al revés).
- Ajustar un texto a una duración.
- Resumir teletipos de agencia en una noticia.
- Sugerir rótulos (TOT, LOC) a partir del texto, respetando longitudes.
- Traducir.
- Exportar el off a herramientas de voz IA o edición.

---

## 19. Media (Fase II)

- Subir, organizar (por programa y fecha), buscar, previsualizar y reproducir **gráficos, vídeos y audios**.
- Subidas reanudables; worker ffmpeg genera proxy web, miniaturas, forma de onda y duración.
- Asociar media a líneas (columnas RECURSOS, PANTALLAS, VTR).
- Copia automática al servidor CasparCG del estudio a través de Station.
- Marcar TC de rótulos sobre la previsualización del vídeo.
- Retención y archivo configurables.

---

## 20. Fuentes, agencias y redes (Fase II–III)

- **Fuentes (II):** RSS/Atom, webs y agencias con API (Reuters, AP… requieren contrato del cliente). De un teletipo a la nevera o a una línea con un clic.
- **Redes sociales (III):** WhatsApp, YouTube, X/Twitter, tendencias y hashtags (hasta 6), según disponibilidad y coste de cada API.
- **Rotulación de RRSS (III):** publicaciones como rótulos con plantilla.

---

## 21. Producción (Fase III)

Tablero "todo en uno" para productores:

- Planificación y calendario de producciones.
- Personal y equipo: convocatorias y **hojas de llamada** con confirmación.
- Invitados (datos, teléfonos, llegada, maquillaje, set).
- Logística: transporte, catering, escenografía, maquillaje y peluquería, material técnico.
- **Presupuesto:** partidas, previsto vs real, por programa/proyecto, exportable.
- Desgloses y hojas de trabajo actualizados en tiempo real.
- **Gestor de pantallas / videowall:** clientes web a pantalla completa por pantalla y contenidos por escaleta.

---

## 22. Timeline horizontal de directo (Fase IV)

Vista alternativa de un evento para shows de ritmo rápido (música, galas):

- Timeline horizontal con **pistas**: cámaras, VTR, rótulos, letras, FX, luces, audio, notas.
- Lista de planos (shot list) y **cue list** con precisión de fotograma.
- Añadir medios, letras y notas.
- Modificar cortes de cámara durante el directo.
- Conmutador de automatización ejecutado por Station.
- Integración con mesas de iluminación y otro software.

---

## 23. Interfaz de usuario

### Marca

Logo y paleta en `docs/referencias/marca/`. Logo oficial: `runflow-logo.svg` (vectorial, color `#FAFAFA`, se recolorea por CSS). `runflow-logo-flat.svg` es un PNG dentro de un SVG: no usar para escalar.

| Token           | Valor                      | Uso                                              |
| --------------- | -------------------------- | ------------------------------------------------ |
| Naranja RunFlow | `#FF7A1A`                  | Acentos, selección, botones primarios, GO armado |
| Amarillo        | `#FFD24A`                  | Avisos, cuenta atrás próxima a 0, coleo          |
| Verde claro     | `#A3C94A`                  | Correcto / listo, línea SIGUIENTE                |
| Verde oscuro    | `#2F7D32`                  | Confirmaciones, estado "en línea" de equipos     |
| Antracita       | `#1F2A2E`                  | Fondo de la aplicación (tema interior)           |
| Rejilla         | `#434343` / `#999999`      | Fondo y bordes de la escaleta (referencia)       |
| Texto           | blanco / negro según celda |                                                  |

**Tipografías:** Montserrat Bold/Black para logo, títulos y relojes grandes; Helvetica (con Arial de respaldo) para texto y rejilla. Cifras de relojes con ancho fijo (`tabular-nums`). Las fuentes van **incluidas en la app** (no desde CDN) para que funcionen sin internet en Station.

**Tipos de línea** (colores de la referencia, editables):

| Tipo                | Color                    |
| ------------------- | ------------------------ |
| ACTING              | `#FFD966`                |
| TEMA                | `#3C78D8` (texto blanco) |
| VARIOS              | `#95B3D7`                |
| VTR / TOTAL + COLAS | `#76923C`                |
| COLAS               | `#C2D69B`                |
| MOCHILA             | `#953734`                |
| FIBRA               | `#D99594`                |
| GRAFISMO            | `#46BDC6` (texto blanco) |
| CAB + RAF           | `#FF6D01`                |
| CONTI               | `#000000` (texto blanco) |

**Estados de línea:** C = CAE `#CC4125` · E = EMITIDO `#6FA8DC` · X = NO LISTO `#85200C` · A = FINAL `#93C47D` (siempre letra + color, nunca solo color).

**STATUS de fuente:** PLAY `#00FF00` · ONLINE `#00FFFF` · OFFLINE `#FF0000`. Celdas de FUENTE `#B6D7A8`.

### Layout de la escaleta

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ RunFlow.TV │ Escaleta 15:00  -01:41:57  -01:56:57  +32:26 │ BLOQUE +01:28 +00:58 │ ⏱ │ [GO] │
├──────────────────────────────────────────────────────────────────────────────┤
│ Vista: [Realización ▾]  Modo: [Manual ▾]  ⚙  🔍  Armar ●  Ensayo ○   👥 3   💬 │
├──┬───┬────────┬────────┬────────┬─────────────────┬──────┬───────┬─────┬─────┤
│E │Nº │PRESENTA│T. EST. │ TIPO   │NOMBRE/DESCRIP.  │ ...  │GRAFISMO│PLAY │FUENTE│ ...  │HORA│
├──┼───┼────────┼────────┼────────┼─────────────────┼──────┼───────┼─────┼─────┤
│C │ 2 │ EDU    │ 0:00:30│ ACTING │ PRESENTACIÓN    │      │ ▶ EDU │     │ CAM1│ 12:00:30 │  ← EN AIRE (rojo)
│E │ 4 │ EDU    │ 0:00:45│ ACTING │ PASO A VTR      │      │       │     │ CAM1│ 12:01:15 │  ← SIGUIENTE (verde)
│  │12 │        │        │ VTR    │ VTR ANDALUCÍA   │      │ ▶ ... │◼1:10│ VTR1│ ...  │
└──┴───┴────────┴────────┴────────┴─────────────────┴──────┴───────┴─────┴─────┘
│ Leyenda: CAE C · EMITIDO E · NO LISTO X · FINAL A                    │ Panel ▸ Guion / Rótulos / Chat │
```

Mejoras sobre la hoja, manteniendo su aspecto:

- Columnas fijas a la izquierda (Estado, Nº, Tipo, Nombre) al hacer scroll horizontal.
- Columnas **redimensionables y movibles** (arrastrar cabecera y borde).
- **Vistas guardadas con nombre:** la disposición actual (columnas visibles, orden, anchos) se guarda como vista personal o compartida, y se elige después desde el selector. Vistas por defecto por puesto: Redacción, Realización, Producción, CG, Técnica, Presentador.
- Ocultar columnas o líneas según permisos.
- Línea EN AIRE y SIGUIENTE resaltadas.
- Arrastrar para reordenar; numeración configurable (por defecto de 2 en 2, para intercalar).
- Edición tipo hoja: Tab/Enter, copiar/pegar varias celdas, deshacer/rehacer.
- Menú contextual: duplicar, mover a nevera, marcar flotante, hora fija…
- Panel lateral derecho redimensionable con guion, rótulos y chat de la línea.
- **Dos esquemas:** interior (oscuro) y exterior (alto contraste claro).
- Vista compacta para tablet y móvil.
- Atajos de teclado configurables y cheat sheet (`?`).
- Interfaz en español desde el inicio, preparada para otros idiomas.

### Menú principal (de la propuesta)

01 Fuentes · 02 Nevera · 03 Social Media · 04 Escaletas · 05 Media · 06 Archivo & Papelera · 07 Gestión de usuarios · 08 Configuración de usuario · (+ Producción en Fase III, Configuración global para administradores)

---

## 24. Mapa de pantallas

| Pantalla                                                      | Fase/Hito   |
| ------------------------------------------------------------- | ----------- |
| Login, recuperar contraseña, selector de empresa              | M0          |
| Inicio: escaletas de hoy, avisos, mensajes                    | M1          |
| Escaletas: lista por programa y fecha                         | M1          |
| **Escaleta** (rejilla + cabecera de relojes + panel lateral)  | M1–M2       |
| Editor de guion (panel y pantalla completa)                   | M3          |
| Base de datos de personas y cargos                            | M3          |
| Vista Directo / Realización (EN AIRE, SIGUIENTE, GO, rótulos) | M2, M7      |
| Operador CG                                                   | M7          |
| Control de prompter + salidas                                 | M4          |
| Nevera                                                        | M5          |
| Archivo & Papelera, historial de versiones                    | M5          |
| Plantillas de escaleta                                        | M5          |
| Chat                                                          | M5          |
| Importar / Exportar / Imprimir                                | M5          |
| Gestión de usuarios, perfiles y privilegios                   | M0–M5       |
| Configuración de usuario                                      | M0          |
| Configuración global / programa / escaleta                    | M1→         |
| Station: consola web                                          | M6          |
| Equipos y mapa de fuentes                                     | M7–M8       |
| Editor de plantillas de rótulos                               | M7          |
| IA: proveedores y uso                                         | M9          |
| Media                                                         | F2          |
| Fuentes / agencias                                            | F2          |
| Social Media                                                  | F3          |
| Producción, presupuesto, hojas de llamada                     | F3          |
| Pantallas / videowall                                         | F3          |
| Timeline horizontal                                           | F4          |
| Facturación y plan (SaaS)                                     | Lanzamiento |

---

## 25. Configuración

Tres niveles; el inferior hereda y puede sobrescribir: **Empresa → Programa → Escaleta**. Configuración personal aparte.

| Sección             | Opciones                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| General             | Idioma, zona horaria, formato de hora, tema interior/exterior                                                               |
| Escaleta            | Columnas y vistas por puesto, tipos de línea y colores, estados, numeración, modos de tiempo, autonext, media duración      |
| Guion               | Colores paso/off/rótulo, velocidad de lectura (por presentador), estados de aprobación                                      |
| Rótulos             | Tipos, campos, longitudes, plantillas, duración por defecto (6 s), **salida automática o manual en cámara (Master)**, capas |
| Teleprompter        | Fuente, tamaño, espejo, velocidad, control (teclado/pedal/tablet), seguir GO                                                |
| Directo / GO        | Anti doble pulsación, preroll, armar/desarmar, ensayo, atajos, Stream Deck, puesto de GO                                    |
| Equipos (Station)   | CasparCG (dirección, canales, capas), mezclador, mapa de fuentes, pruebas de conexión                                       |
| Salidas             | Enlaces con token, diseños de relojes y presentador                                                                         |
| Usuarios y perfiles | Roles, permisos, vistas por defecto                                                                                         |
| IA                  | Proveedores, claves, modelo, límites                                                                                        |
| Plantillas y nevera | Plantillas de escaleta, líneas preconfiguradas                                                                              |
| Exportar e imprimir | Vistas prefijadas de PDF, cabeceras, logo                                                                                   |
| Archivo             | Retención de histórico (1 mes escaletas activas, 1 año archivo) y papelera                                                  |
| Licencia y modo     | Nube / híbrido / local, Stations asociadas, sincronización                                                                  |
| Personal            | Datos, contraseña, vista por defecto, atajos, notificaciones                                                                |

---

## 26. Permisos

Permisos por capacidad, agrupados en roles editables:

- Ver escaleta · Editar estructura (añadir/mover/borrar líneas) · Editar celdas (por columna) · Editar guion propio / ajeno · Aprobar guion / marcar FINAL · Ejecutar GO · Lanzar rótulos · Controlar prompter · Gestionar media · Gestionar plantillas y nevera · Configurar programa · Configurar empresa · Gestionar usuarios · Ver presupuesto (F3) · Administrar Station.

Visibilidad por columna (ej. TELÉFONOS solo para Producción).

---

## 27. Exportación e impresión

Vistas prefijadas (configurables):

- Escaleta completa · Escaleta de realización · Escaleta de producción.
- Guion de presentador (solo paso, letra grande).
- Guion completo (paso + off + rótulos).
- Hoja de rótulos (para CG o revisión).
- Hoja de invitados / teléfonos.
- Registro de emisión (as-run).

Formatos: PDF, CSV, XLSX, JSON (copia completa). Importación desde CSV/XLSX con asistente de columnas (para migrar las hojas actuales).

---

## 28. Seguridad, privacidad y licencias

- Aislamiento por empresa (RLS), cifrado en tránsito (HTTPS/WSS) y de claves sensibles en reposo.
- Contraseñas con hash moderno; 2FA opcional; SSO (Google/Microsoft) más adelante.
- **RGPD:** datos de invitados y teléfonos son datos personales → alojamiento en la UE, contrato de encargado de tratamiento, exportar y borrar datos.
- Copias de seguridad diarias (nube) y automáticas en Station.
- Registro de auditoría.
- Licencias de Station firmadas, con activación sin conexión y periodo de gracia.
- Enlaces de salida con token revocable y solo lectura.

---

## 29. Modelo de negocio

| Plan        | Para                     | Notas                                                   |
| ----------- | ------------------------ | ------------------------------------------------------- |
| Gratis      | Probar                   | 1 programa, 3 usuarios, sin equipos. **Sin publicidad** |
| Básico      | Producciones pequeñas    | Usuarios limitados, nube                                |
| Profesional | TV local                 | Usuarios, Station, CasparCG, mezcladores, IA            |
| Educación   | Escuelas y universidades | Precio reducido, muchas cuentas, clases/grupos          |
| Local       | Sin nube                 | Licencia por estudio (anual), Station                   |

Cobro con Stripe en el hito de lanzamiento.

---

## 30. Infraestructura

### Nube (inicio, ~20–40 €/mes)

- 1 VPS 4 vCPU / 8 GB en la UE (ej. Hetzner) con Docker: web, API, sync, Postgres, Redis.
- Cloudflare: DNS, SSL, protección, R2 para ficheros.
- Dominio `runflow.tv` (+ `app.`, `api.`, `*.station.`).
- Email transaccional (Resend/Postmark).
- Sentry para errores, monitor de disponibilidad.
- Copias diarias de Postgres a almacenamiento externo.
- Entorno de **staging** (VPS pequeño o mismo servidor separado).

### Crecimiento (Fase II en adelante)

- Worker de transcodificación (segundo VPS con CPU).
- Postgres gestionado o réplica cuando haya clientes de pago.
- Varios nodos de sync con Redis.

### Desarrollo

- GitHub (`Michael-svq/RUNFLOW`) + GitHub Actions.
- Simuladores de CasparCG/ATEM/OBS/vMix para probar sin equipos.

### En el estudio

- Station (§16), red cableada de 1 Gb, CasparCG, mezclador.
- Tablets/TV/mini-PC con navegador para prompter y relojes.
- Monitor de teleprompter; pedal o mando USB; Stream Deck (opcional).

---

## 31. Calidad y pruebas

- **Unitarias:** motor de tiempos y reglas de rótulos (cobertura alta, casos de borde).
- **Integración:** API, permisos, aislamiento entre empresas.
- **Multiusuario (Playwright):** varios navegadores editando a la vez, cortes de red y reconexión.
- **Simuladores de equipos:** CasparCG (AMCP/OSC), ATEM, OBS, vMix falsos para CI.
- **Pruebas de resistencia:** escaleta de 300 líneas, 30 usuarios, directo de 3 h.
- **Pruebas en estudio real** al cerrar cada hito con equipos (las haces tú; checklist en cada entrega).
- Accesibilidad básica (teclado, contraste, letras además de colores).

---

## 32. Hitos y criterios de aceptación

### Fase I — Escaleta funcional (+ Station, CG y mezcladores)

| Hito                            | Contenido                                                                                                                                                                                | Hecho cuando…                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **M0 Fundaciones**              | Monorepo, CI, base de datos, login, empresas, usuarios, roles base, sistema de diseño, PWA instalable, despliegue en staging                                                             | Dos empresas no ven datos entre sí; se puede entrar y crear usuarios                         |
| **M1 Escaleta en tiempo real**  | Programas, escaletas, rejilla tipo hoja con aspecto de la referencia, tipos de línea, estados C/E/X/A, columnas y vistas, reordenar, colaboración y presencia, sin conexión en navegador | 3 navegadores editan la misma escaleta a la vez sin perder datos, también tras cortar la red |
| **M2 Tiempos y directo básico** | Motor de tiempos, relojes de cabecera, 4 modos, horas fijas, flotantes, GO (sin equipos), EN AIRE/SIGUIENTE, autonext, as-run                                                            | Un directo simulado de 1 h cuadra tiempos al segundo y el as-run es correcto                 |
| **M3 Guion y rótulos**          | Editor colaborativo paso/off/rótulo/nota, rótulos estructurados con tipos y longitudes, TC `mm:ss`, base de datos de personas, duración por lectura                                      | El paso sale bien separado del off; no se puede guardar un rótulo inválido                   |
| **M4 Prompter y salidas**       | Teleprompter con control remoto y espejo, salidas por token (presentador, relojes, agenda, mensajes, multivista), temporizadores                                                         | Prompter fluido en TV y tablet, sincronizado con el GO                                       |
| **M5 Colaboración y archivo**   | Chat, plantillas, nevera, historial y papelera, importar/exportar, PDF con vistas, permisos completos, temas interior/exterior, atajos                                                   | Migrar la escaleta de referencia desde XLSX e imprimir sus vistas                            |
| **M6 Station**                  | Servicio local con instalador (Win/Mac/Linux) y Docker, consola web, modo local y modo híbrido con sincronización, HTTPS local, licencias                                                | Cortar internet en pleno directo simulado y que el estudio siga; al volver, todo fusionado   |
| **M7 RunFlow CG**               | Driver CasparCG, plantillas HTML de los 6 tipos, editor de plantillas, rótulos manuales ▶/■ y automáticos por TC, playout de VTR con preroll, columna PLAY, GO con CasparCG             | En CasparCG real: VTR con 2 rótulos por TC y un rótulo manual en cámara salen en su momento  |
| **M8 Mezcladores**              | ATEM, OBS, vMix, mapa de fuentes, corte en GO, armar/ensayo, Companion/Stream Deck                                                                                                       | GO pasa de CAM 1 a VTR (CasparCG + corte) en < 100 ms                                        |
| **M9 IA**                       | Capa multiproveedor, claves por empresa, funciones de redacción, Ollama local                                                                                                            | Las funciones funcionan con al menos 2 proveedores y en local                                |
| **Beta privada**                | 1–2 TV locales o escuelas usando RunFlow en programas reales                                                                                                                             | Feedback recogido y errores críticos corregidos                                              |
| **Lanzamiento**                 | Planes, Stripe, registro autoservicio, web pública, documentación de usuario                                                                                                             | Alta y pago sin intervención manual                                                          |

### Fase II — Escaleta + sistemas

| Hito                     | Contenido                                                                         |
| ------------------------ | --------------------------------------------------------------------------------- |
| F2.1 Media               | Subida, proxies, previsualización, organización, copia a CasparCG, TC sobre vídeo |
| F2.2 Fuentes             | RSS/agencias, a nevera/línea                                                      |
| F2.3 Directo y streaming | Vista presentador avanzada, control de streaming en OBS/vMix                      |
| F2.4 API pública         | API REST + webhooks + módulo Companion propio                                     |

_(Orden de la Fase II revisable según el uso y el feedback de la beta.)_

### Fase III — Escaleta para todo

| Hito             | Contenido                                                             |
| ---------------- | --------------------------------------------------------------------- |
| F3.1 Producción  | Tablero, calendario, personal, hojas de llamada, invitados, logística |
| F3.2 Presupuesto | Partidas, previsto/real, informes                                     |
| F3.3 Pantallas   | Gestor de contenidos de pantallas / videowall                         |
| F3.4 Redes       | Social media y rotulación de RRSS                                     |

### Fase IV — Escaleta integrada

| Hito                         | Contenido                                                          |
| ---------------------------- | ------------------------------------------------------------------ |
| F4.1 Timeline                | Vista horizontal, pistas, shot list, cue list                      |
| F4.2 Automatización avanzada | Conmutador de automatización, cortes editables en directo          |
| F4.3 Iluminación             | OSC, MIDI, sACN/Art-Net                                            |
| F4.4 Otros sistemas          | TriCaster, Ross, XPression, Chyron, Autoscript, MOS… según demanda |

---

## 33. Riesgos

| Riesgo                                  | Mitigación                                                             |
| --------------------------------------- | ---------------------------------------------------------------------- |
| Alcance enorme                          | Hitos cortos, beta temprana, priorizar por uso real                    |
| HTTPS en red local (necesario para PWA) | Certificados tipo Plex + CA local de respaldo; probar pronto (M6)      |
| No puedo probar con equipos reales      | Simuladores + checklist de pruebas en estudio en cada entrega          |
| Diferencias entre versiones de CasparCG | Soportar 2.3+ y probar con la versión del cliente                      |
| Conflictos nube ↔ Station              | CRDT para contenido; directo con autoridad única en Station            |
| Fiabilidad del directo                  | Modo ensayo, armado, avisos, el directo nunca se bloquea por un equipo |
| APIs de agencias y redes de pago        | Las aporta el cliente; empezar por RSS                                 |
| Coste de IA                             | Claves del cliente, límites y registro de consumo                      |
| Datos personales                        | RGPD desde M0                                                          |

---

## 34. Preguntas abiertas

Resueltas (ver D12–D19): logo vectorial, publicidad, mezcladores, autonext, coleo, marca (amarillo `#FFD24A`), velocidad de lectura, numeración, idiomas, vistas.

No hay preguntas pendientes.

---

## 35. Glosario

| Término   | Significado                                               |
| --------- | --------------------------------------------------------- |
| Escaleta  | Lista ordenada de eventos de un programa (rundown)        |
| Paso      | Texto que lee el presentador (verde)                      |
| Off       | Texto locutado dentro de la pieza (negro)                 |
| Rótulo    | Grafismo con texto sobreimpresionado (azul en el guion)   |
| VTR       | Pieza de vídeo                                            |
| Colas     | Imágenes sin locución sobre las que habla el presentador  |
| Mochila   | Unidad de directo móvil                                   |
| Fibra     | Señal externa por fibra                                   |
| Nevera    | Contenido preparado para usar más adelante                |
| GO / TAKE | Pasar a la siguiente línea y ejecutar sus acciones        |
| Back-time | Hora a la que debe empezar cada línea para acabar en hora |
| As-run    | Registro de lo realmente emitido                          |
| Station   | Servicio local de RunFlow en el control                   |
| CasparCG  | Servidor gratuito de grafismo y playout                   |
| PGM / PVW | Salida de programa / previo en el mezclador               |

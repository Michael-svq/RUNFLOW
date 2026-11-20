# RunFlow

Escaletas, guiones, rótulos, teleprompter y producción para TV local, educación y eventos.
Web (PWA) multiempresa en la nube y funcionamiento local con **RunFlow Station**.

- Plan completo: [`docs/PLAN.md`](docs/PLAN.md)
- Decisiones técnicas: [`docs/adr/`](docs/adr)
- Despliegue: [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md)
- RunFlow CG y CasparCG: [`docs/CASPARCG.md`](docs/CASPARCG.md)
- Mezcladores y mando: [`docs/MEZCLADORES.md`](docs/MEZCLADORES.md)
- Inteligencia artificial: [`docs/IA.md`](docs/IA.md)
- API pública y webhooks: [`docs/API.md`](docs/API.md)

## Estado

| Hito                                                                                      | Estado    |
| ----------------------------------------------------------------------------------------- | --------- |
| M0 Fundaciones (monorepo, base de datos, entrar, empresas, usuarios, roles, diseño, PWA)  | ✅        |
| M1 Escaleta en tiempo real (colaboración, sin conexión, vistas)                           | ✅        |
| M2 Tiempos y directo (GO, autonext, eventos a hora fija, as-run)                          | ✅        |
| M3 Guion y rótulos (editor colaborativo, TOT/LOC/INF/DAT/BAN/HIG, TC)                     | ✅        |
| M4 Teleprompter y salidas por enlace                                                      | ✅        |
| M5 Chat, plantillas, nevera, versiones, papelera, importar/exportar, PDF                  | ✅        |
| M6 RunFlow Station (servidor local, modo híbrido con la nube, licencias)                  | ✅        |
| M7 RunFlow CG (CasparCG: rótulos ▶/■ y por TC, VTR, plantillas, configuración)           | ✅        |
| M8 Mezcladores (OBS, vMix, ATEM), mapa de fuentes y mando (Companion, Stream Deck)        | ✅        |
| M9 IA (Anthropic, OpenAI, Gemini, Mistral, Ollama en local) en el guion                   | ✅        |
| Lanzamiento: planes, Stripe, registro autoservicio, portada pública y ayuda               | ✅        |
| F2.2 Fuentes: RSS/Atom de agencias y medios a la nevera o a la escaleta                   | ✅        |
| F2.3 Directo y streaming: emitir y grabar en OBS, vMix y ATEM; reloj de bloque en salidas | ✅        |
| Beta privada (equipos reales) y resto de la Fase II                                       | Siguiente |

## Estructura

```
apps/
  server/     API (Fastify) — mismo código para la nube y para Station
  web/        Aplicación web (React + Vite, PWA)
  station/    Lanzador de RunFlow Station (PostgreSQL integrado, mDNS, HTTPS)
packages/
  ai/         IA multiproveedor (Anthropic, OpenAI, Gemini, Mistral, Ollama) y funciones de redacción
  core/       Permisos, roles, validaciones, catálogo de la escaleta y tipos compartidos
  sync/       Documento colaborativo de la escaleta (Yjs)
  db/         Esquema de base de datos, migraciones y aislamiento por empresa (RLS)
  ui/         Sistema de diseño: colores y tipografías de marca, logo, componentes
docs/         Plan, decisiones técnicas y material de referencia
```

## Desarrollo

Requisitos: Node 22, pnpm 10 y PostgreSQL 16 (local o con Docker).

1. Base de datos (con Docker):

   ```bash
   docker compose -f docker-compose.dev.yml up -d
   ```

   Sin Docker, crea en tu Postgres los roles `runflow` (propietario, con `CREATEDB`) y
   `runflow_app` (aplicación) y la base de datos `runflow`, como en `.env.example`.

2. Configuración y dependencias:

   ```bash
   cp .env.example .env
   ```

   ```bash
   pnpm install
   ```

   ```bash
   pnpm db:migrate
   ```

3. Arrancar (API en :3000 y web en :5173):

   ```bash
   pnpm dev
   ```

   Abre http://localhost:5173: la primera vez aparece la **configuración inicial**
   para crear tu empresa y tu cuenta de administración.

## RunFlow Station

Un ordenador del estudio hace de servidor: el resto de equipos entra con el navegador.
Funciona sin nube (**local**, con licencia) o enlazada con la nube (**híbrido**: si se
cae internet el directo sigue, y al volver todo se fusiona). Ver
[`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md#runflow-station).

```bash
pnpm build && pnpm --filter @runflow/station start
```

## Pruebas

```bash
pnpm typecheck
```

```bash
pnpm test
```

```bash
pnpm build && pnpm test:e2e
```

Las pruebas crean sus propias bases de datos (`runflow_test`, `runflow_e2e`) con el usuario
propietario (`TEST_DATABASE_ADMIN_URL`, por defecto `postgres://runflow:runflow@localhost:5432/runflow`).

## Marca

Paleta `#FF7A1A` `#FFD24A` `#A3C94A` `#2F7D32` `#1F2A2E` · Montserrat (Bold/Black) y Helvetica.
Logo vectorial en `docs/referencias/marca/runflow-logo.svg`.

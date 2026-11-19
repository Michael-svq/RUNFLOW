# RunFlow

Escaletas, guiones, rótulos, teleprompter y producción para TV local, educación y eventos.
Web (PWA) multiempresa en la nube y funcionamiento local con **RunFlow Station**.

- Plan completo: [`docs/PLAN.md`](docs/PLAN.md)
- Decisiones técnicas: [`docs/adr/`](docs/adr)
- Despliegue: [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md)

## Estado

| Hito                                                                                     | Estado    |
| ---------------------------------------------------------------------------------------- | --------- |
| M0 Fundaciones (monorepo, base de datos, entrar, empresas, usuarios, roles, diseño, PWA) | ✅        |
| M1 Escaleta en tiempo real                                                               | Siguiente |

## Estructura

```
apps/
  server/     API (Fastify) — mismo código para la nube y para Station
  web/        Aplicación web (React + Vite, PWA)
packages/
  core/       Permisos, roles por defecto, validaciones y tipos compartidos
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

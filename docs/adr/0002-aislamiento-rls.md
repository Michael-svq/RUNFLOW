# 0002 · Aislamiento por empresa con Row Level Security

Estado: aceptada (M0)

## Contexto

RunFlow es multiempresa (SaaS). Un error en una consulta (un `where org_id = …` olvidado)
no debe poder mostrar datos de otra empresa.

## Decisión

- Toda tabla de negocio lleva `org_id` y tiene **políticas RLS** en Postgres
  (`packages/db/migrations/0001_rls.sql`).
- La aplicación se conecta con un rol **sin privilegios de propietario** (`runflow_app`),
  así que las políticas se le aplican siempre. Las migraciones usan el rol propietario.
- El contexto se fija por transacción (`packages/db/src/client.ts`):
  - `withTenant(db, { orgId, userId }, fn)`: solo filas de esa empresa.
  - `withUser(db, userId, fn)`: el usuario ve sus membresías y empresas.
  - `withSystem(db, fn)`: sin aislamiento, solo para login, configuración inicial y
    administración de plataforma.
- Las cuentas son globales (una persona puede estar en varias empresas). Una empresa solo
  puede cambiar nombre o contraseña de cuentas que pertenecen **únicamente** a ella;
  esto también lo impone la base de datos.
- Funciones `SECURITY DEFINER` mínimas para preguntas puntuales sobre cuentas globales
  (¿existe este email?, ¿en cuántas empresas está?, borrar cuenta huérfana).

## Consecuencias

- Las pruebas (`apps/server/test/isolation.test.ts`) verifican el aislamiento por la API y
  directamente en la base de datos, con consultas sin filtro.
- RLS protege frente a errores de la aplicación, no frente a un servidor comprometido
  (que podría activar el modo sistema).

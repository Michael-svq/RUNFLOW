# Despliegue

## Staging / producción en un VPS (Docker)

Infraestructura mínima (PLAN §30): un VPS de 4 vCPU / 8 GB en la UE, un dominio y
HTTPS delante (Cloudflare o un proxy como Caddy).

1. En el servidor, con Docker instalado, clona el repositorio y prepara las contraseñas:

   ```bash
   cp deploy/.env.compose.example .env.compose
   ```

   Edita `.env.compose` y pon contraseñas largas en `DB_OWNER_PASSWORD` y `DB_APP_PASSWORD`.

2. Arranca:

   ```bash
   docker compose --env-file .env.compose up -d --build
   ```

   Al arrancar, el contenedor aplica las migraciones pendientes.

3. Pon HTTPS delante del puerto 3000 (por ejemplo, Caddy: `reverse_proxy localhost:3000`).
   Con HTTPS, deja `COOKIE_SECURE=true`. Si pruebas por `http://` en local, ponlo a `false`.

4. Abre la web: la primera vez aparece la **configuración inicial** (empresa + administrador,
   que también administra la plataforma).

## Copias de seguridad

```bash
docker compose --env-file .env.compose exec db pg_dump -U runflow runflow > runflow-$(date +%F).sql
```

## Variables

Ver `.env.example`. Las importantes:

| Variable             | Uso                                                           |
| -------------------- | ------------------------------------------------------------- |
| `DATABASE_URL`       | Conexión de la aplicación (rol sin privilegios, sujeto a RLS) |
| `DATABASE_OWNER_URL` | Conexión del propietario, solo para migraciones               |
| `RUNFLOW_MODE`       | `cloud` o `station`                                           |
| `COOKIE_SECURE`      | `true` detrás de HTTPS                                        |
| `TRUST_PROXY`        | `true` si hay un proxy inverso delante                        |
| `AUTH_RATE_LIMIT`    | Intentos por minuto en login (10)                             |

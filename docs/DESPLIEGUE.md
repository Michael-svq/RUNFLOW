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
| `DATA_DIR`           | Carpeta de datos (licencia, clave maestra); `/data` en Docker |
| `SECRET_KEY`         | Clave maestra de cifrado (claves de IA); si no, en `DATA_DIR` |
| `PUBLIC_URL`         | Dirección con la que CasparCG ve este servidor (plantillas)   |
| `CLOUD_URL`          | Station híbrida: dirección de la nube                         |
| `STATION_TOKEN`      | Station híbrida: token creado en la nube                      |
| `TLS_CERT_FILE`      | HTTPS directo (Station): certificado PEM                      |
| `TLS_KEY_FILE`       | HTTPS directo (Station): clave PEM                            |

## RunFlow Station

Un ordenador del estudio (Windows, macOS o Linux, con Node 22) hace de servidor de
RunFlow para la red local. El lanzador (`apps/station`) arranca un PostgreSQL integrado
(solo escucha en el propio equipo), aplica las migraciones, lanza el servidor en modo
Station, lo vuelve a arrancar si se cae y lo anuncia en la red por mDNS
(`http://<equipo>.local:8080`).

### Empaquetar e instalar

En un equipo del mismo sistema operativo que la Station:

```bash
scripts/package-station.sh out/runflow-station
```

Copia la carpeta `out/runflow-station` al ordenador de la Station e instala:

- Linux (servicio systemd, usuario `runflow`, datos en `/var/lib/runflow-station`):

  ```bash
  sudo ./install-linux.sh
  ```

- macOS (arranca al iniciar sesión, datos en `~/Library/Application Support/RunFlow Station`):

  ```bash
  ./install-macos.sh
  ```

- Windows (tarea programada al iniciar sesión y regla del cortafuegos):

  ```bash
  powershell -ExecutionPolicy Bypass -File install-windows.ps1
  ```

También funciona con Docker: `docker-compose.yml` con `RUNFLOW_MODE=station`.

### Órdenes del lanzador

| Orden                              | Para qué                                        |
| ---------------------------------- | ----------------------------------------------- |
| `runflow-station`                  | Arranca la Station                              |
| `runflow-station info`             | Carpeta de datos, modo y direcciones            |
| `runflow-station link URL TOKEN`   | Enlaza con la nube (modo híbrido)               |
| `runflow-station unlink`           | Vuelve a modo local                             |
| `runflow-station https on` / `off` | HTTPS con certificado propio (EC P-256, 5 años) |

La carpeta de datos se puede cambiar con `RUNFLOW_STATION_DATA` y el puerto con `PORT`
(la primera vez; después se guarda en `station.json`).

### Modo local

La primera vez aparece la configuración inicial (empresa y administración), como en la
nube. Sin licencia funciona 30 días de prueba; con la licencia caducada hay 30 días de
gracia y después queda en **modo consulta** (se puede entrar y ver, no modificar). La
licencia se pega en _RunFlow Station_ (menú 09).

### Modo híbrido

1. En la nube, menú **09 RunFlow Station** → _Crear enlace_. El token solo se muestra una vez.
2. En el ordenador de la Station: `runflow-station link https://tu-nube TOKEN` y reiníciala.

La Station recibe de la nube la empresa, las cuentas (con sus contraseñas, para poder
entrar sin internet), roles, programas, escaletas, vistas, plantillas, nevera y salidas;
sube lo que se cree en ella sin conexión, y sincroniza en ambos sentidos los documentos de
las escaletas de dos días atrás a dos semanas vista. El directo lo lleva la Station: la
nube lo refleja y no admite GO mientras dura. Al revocar la Station en la nube deja de
sincronizar. Una Station enlazada no necesita licencia (la cubre la suscripción).

Conviene enlazar una Station **vacía** (sin configuración inicial local).

### Licencias

Las licencias son textos firmados con Ed25519 que la Station comprueba sin conexión.
Quien las emite crea sus claves una vez y guarda la privada fuera del repositorio:

```bash
pnpm --filter @runflow/server license keys ~/claves-runflow
```

La pública se incorpora al compilar el servidor (`RUNFLOW_LICENSE_PUBLIC_KEY` con el PEM,
también como `--build-arg` en Docker). Sin clave incorporada, la Station no comprueba
licencias. Emitir una licencia:

```bash
pnpm --filter @runflow/server license issue ~/claves-runflow/license-private.pem "IES Ejemplo" 2027-09-30 local
```

### HTTPS en la red local

El certificado propio de la Station hace que cada navegador pida confiar en él una vez
(necesario para instalar la PWA desde otros equipos; por `http://` la web funciona igual,
sin instalarse). Con un certificado propio del centro, usa `TLS_CERT_FILE` y `TLS_KEY_FILE`.

# 0001 · Autenticación propia con sesiones en base de datos

Estado: aceptada (M0)

## Contexto

El plan proponía Better Auth. RunFlow debe funcionar igual en la nube y en
**Station** (servidor local, sin internet, instalado en Windows/macOS/Linux), con
cuentas que pueden pertenecer a varias empresas y un aislamiento estricto por empresa.

## Decisión

Autenticación propia, pequeña y probada:

- Contraseñas con **scrypt** (incluido en Node: sin dependencias nativas que compilar en Station).
- **Sesiones en Postgres**: la cookie `rf_session` (httpOnly, SameSite=Lax, Secure en HTTPS)
  lleva un token aleatorio; en la base de datos solo se guarda su SHA-256.
  Caducidad deslizante (14 días por defecto).
- La sesión guarda la **empresa activa**; cada petición comprueba que la membresía siga activa.
- Contraseña provisional obligatoria de cambiar; cambiarla cierra las demás sesiones.
- Protección CSRF: cabecera propia `X-Runflow-Request` en peticiones que modifican datos
  - comprobación de `Origin`.
- Límite de intentos en login, cambio de contraseña y configuración inicial.

## Consecuencias

- Control total del modelo multiempresa y del modo sin conexión.
- SSO (Google/Microsoft) y 2FA se añadirán más adelante sobre esta base.
- Recuperación de contraseña por email: pendiente (necesita servicio de email);
  mientras tanto, un administrador la restablece.

# ADR 0004 — RunFlow Station y sincronización con la nube

Estado: aceptada (M6)

## Contexto

Las televisiones locales y los centros educativos necesitan que el directo siga aunque
se caiga internet, y algunos no quieren nube. El mismo servidor debe funcionar en la nube
y en un ordenador del estudio, sin que nadie tenga que administrar una base de datos.

## Decisión

- **Mismo servidor, dos modos** (`RUNFLOW_MODE=cloud|station`). La Station es el servidor
  de siempre con PostgreSQL integrado (`embedded-postgres`) que lanza `apps/station`.
- **Enlace por token**: la nube crea una Station (`stations`, token aleatorio de 256 bits,
  guardado como hash). La Station se autentica con `Authorization: Bearer`.
- **La nube es la referencia de cuentas y configuración**: cada 15 s la Station trae una
  instantánea de la empresa (incluidos los hash de contraseñas, para entrar sin internet)
  y la aplica con los mismos identificadores. Quien sale de la empresa en la nube
  desaparece de la Station.
- **Documentos CRDT en ambos sentidos**: la Station abre un `WebsocketProvider` contra la
  nube por cada escaleta cercana (−2/+14 días) ligado a su propio documento; Yjs fusiona
  lo editado en cada lado durante un corte.
- **Lo creado sin conexión sube**: programas y escaletas nuevas de la Station se dan de
  alta en la nube con su mismo id.
- **El directo lo lleva la Station**: su motor es la autoridad; cada cambio se envía a la
  nube (con reintento), que lo refleja, no programa avances y rechaza órdenes locales
  mientras dura.
- **Licencias Ed25519** verificables sin conexión (prueba 30 días, gracia 30 días, luego
  solo lectura); una Station enlazada la cubre la nube.

## Consecuencias

- Cambiar la contraseña en una Station enlazada no persiste: se hace en la nube.
- La Station enlazada debe empezar vacía (no se fusionan empresas creadas en local).
- El chat, las versiones y el as-run viven en cada instalación (no se sincronizan aún).
- La clave pública de licencias se incorpora al compilar; quien controla el equipo
  podría saltarse la comprobación (riesgo aceptado: licencia de confianza).

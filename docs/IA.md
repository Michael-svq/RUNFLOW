# Inteligencia artificial en RunFlow

Ayuda en la redacción, con el proveedor que elija cada empresa (PLAN §18, decisión D5).

## Proveedores

En **10 Configuración → Inteligencia artificial**:

| Proveedor          | Modelo                                     | Dirección por defecto                              |
| ------------------ | ------------------------------------------ | -------------------------------------------------- |
| Anthropic (Claude) | `claude-opus-5-5` (propuesto)              | `https://api.anthropic.com` (SDK oficial)          |
| OpenAI             | El que contratéis                          | `https://api.openai.com/v1`                        |
| Google Gemini      | El que contratéis                          | `https://generativelanguage.googleapis.com/v1beta` |
| Mistral            | El que contratéis                          | `https://api.mistral.ai/v1`                        |
| Ollama (local)     | El modelo instalado en el equipo de Ollama | `http://127.0.0.1:11434`                           |

- Las **claves se guardan cifradas** (AES-256-GCM) y nunca vuelven al navegador. La clave
  maestra es `SECRET_KEY` (32 bytes en base64 o hex) o, si no se define, se crea en
  `DATA_DIR/secret.key`. **Guarda una copia**: sin ella, las claves guardadas no se pueden leer
  (habría que volver a escribirlas).
- Con **Anthropic**, si el modelo rechaza una petición, la API la repite sola con el modelo de
  respaldo adecuado (`fallbacks: "default"`); el consumo registra el modelo que respondió.
- Con **Ollama** nada sale de la red del centro: es la opción para una Station sin nube.
- Las llamadas se hacen desde el servidor; se elige un proveedor predeterminado y, si hay
  varios, quien redacta puede escoger otro.

## Funciones (botón «✦ IA» del guion)

Corregir ortografía y estilo · escribir el paso a partir del off · escribir el off a partir del
paso · ajustar a una duración (a 3 palabras por segundo) · resumir un teletipo en paso + off ·
sugerir rótulos TOT y LOC (respetando las longitudes de cada campo) · traducir.

La propuesta se **revisa antes de usarla**: sustituir la selección, añadirla como paso u off,
añadir los rótulos marcados o copiarla. El botón **Exportar off** descarga el texto del off para
herramientas de voz o de edición.

Usan la IA quienes pueden escribir guiones; la configuran quienes configuran la empresa.

## Límites y consumo

Límite mensual de tokens por empresa (0 = sin límite; al alcanzarlo, la IA responde «límite
alcanzado» hasta el mes siguiente) y consumo del mes por función y por proveedor.

## Station

En una Station, los proveedores se configuran en la propia Station (las claves de la nube no se
copian). Para trabajar sin internet, Ollama en el mismo equipo o en la red local.

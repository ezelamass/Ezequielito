# 07 · Cuenta Vento: login, limpieza sin API key y sincronización

## Problema

Para que un dictado saliera limpio (sin muletillas, con puntuación, con el tono de la app) había que activar el post-proceso y cargar a mano la API key de un proveedor de IA. Eso sirve para una persona técnica, no para un producto. Y el diccionario se "sincronizaba" con un archivo JSON en OneDrive.

## Qué cambia

- **Login con la cuenta de Vento** (mail y contraseña) desde la app. La contraseña va directo al login de Vento y no se guarda; la sesión queda en un archivo aparte (`vento_account.json`) y se renueva sola.
- **Con sesión, todo dictado sale limpio.** La tecla principal pasa a limpiar: la app transcribe en la compu y manda el texto a Vento (`voice-clean`), que lo devuelve como la persona lo hubiera escrito. El estilo sale de la tecla usada o, si no tiene uno, de la app donde se escribe. Se apaga con un ajuste ("Limpiar con Vento").
- **Nunca se pierde un dictado.** Si Vento no contesta (sin internet, tope del día, error), el texto se pega tal como se transcribió, o pasa por el proveedor local si hay uno configurado.
- **Modo edición y transforms** también van por Vento, sin API key.
- **Diccionario, snippets y estilo por app** siguen a la persona entre computadoras (`voice_profiles`).
- **Mientras se habla, se prepara la conexión** (y se renueva el token si hace falta), para que la limpieza no pague eso después.

## Cómo

### En Vento (repo `Vento-Enroque-y-Marca-Personal`, [PR 1083](https://github.com/ezelamass/Vento-Enroque-y-Marca-Personal/pull/1083))

Edge `voice-clean`, tabla `voice_profiles` y gate `vento_voice`. Detalle: `docs/app/vento-voice/README.md` de ese repo. Lo importante para la app: **los pedidos al modelo los arma el servidor**. La app manda datos (texto, estilo, app, instrucción), nunca un prompt.

### En la app

- `vento.rs`: `VentoAccount` (login, logout, token con renovación serializada, `voice()`, perfil). Guarda en un `AccountStore`; en la app es un archivo, en los tests es memoria.
- `vento_sync.rs`: `plan_sync` decide qué hacer con la copia local y la de la cuenta. Si cambió un solo lado, ese lado gana (así una palabra borrada queda borrada). Si cambiaron los dos, se unen y no se pierde nada.
- `commands/vento.rs`: arranque, sincronización y los comandos de la pantalla (`vento_status`, `vento_sign_in`, `vento_sign_out`, `vento_refresh`).
- `actions.rs`: `process_transcription_output` prueba primero Vento; `assist.rs` hace lo mismo para modo edición y transforms.
- Ajuste `vento_cleanup` (encendido por defecto).

### Qué sale de la computadora

Con sesión iniciada: el **texto** de cada dictado, el estilo, las palabras del diccionario y, si "Usar la app como contexto" está encendido, el nombre de la app y el título de la ventana. **El audio no sale nunca.** Vento no guarda el texto.

## Validación

- **Prueba en vivo contra producción** (`vento::tests::live_…`, se corre a mano con una cuenta de prueba): contraseña incorrecta, login, gate, limpieza real ("el martes no perdón el miércoles" → queda solo miércoles), subir y leer el perfil, renovación forzada del token y logout. Pasa.
- 24 tests de `vento.rs` y `vento_sync.rs`: lectura de la sesión, cuándo renovar, qué respuestas cierran la sesión y cuáles no, cada rechazo del servidor a su error, el tope diario y los casos de sincronización (palabra borrada, primera sincronización, cambios de los dos lados).
- 17 tests de Playwright de la pantalla de cuenta (`tests/account.spec.ts`).
- 21 tests del lado de Vento (validación del body y armado de cada pedido).
- **Review independiente del backend: 10 hallazgos.** Corregidos:
  - En la primera sincronización, los valores de fábrica de una instalación nueva podían pisar lo que la persona había configurado en otra compu. Ahora, donde no coinciden, gana la cuenta.
  - Dos sincronizaciones a la vez podían perder una palabra recién agregada. Ahora corre una sola, y si algo cambia mientras tanto, empieza de nuevo sin escribir nada viejo encima.
  - Un error pasajero al renovar la sesión (límite de pedidos, un proxy) cerraba la sesión. Ahora solo la cierra un token rechazado.
  - La espera de la limpieza no tenía techo real si había que renovar el token: ahora son 6 segundos en total y después se pega el texto crudo.
  - Con sesión, un prompt propio del usuario (una traducción, por ejemplo) se reemplazaba por la limpieza de Vento. Ahora un prompt propio sigue yendo al proveedor local.
  - Al llegar al tope del día se seguía preguntando en cada dictado. Ahora se pausa hasta el día siguiente y la pantalla de cuenta lo dice.
  - La sincronización del diccionario por archivo no avisaba a la cuenta.
- Sin corregir, anotado: al iniciar sesión con **otra** cuenta en la misma compu, el diccionario local se mezcla en la cuenta nueva. Y la sesión se guarda en un archivo sin cifrar en la carpeta de datos de la app (como hace el navegador con la web de Vento).
- Latencia medida desde la nube con la función caliente: 1,1 a 1,8 s por pedido, con conexión nueva cada vez. Falta medirla desde la app en una máquina real.

## Para probar en Windows

1. Iniciar sesión con la cuenta de Vento: aparece "limpieza activa".
2. Dictar con la tecla principal en WhatsApp y en un mail: sale limpio y con tono distinto.
3. Desconectar internet y dictar: se pega el texto crudo, sin error.
4. Agregar una palabra al diccionario, iniciar sesión en otra compu: la palabra aparece.
5. Medir con un cronómetro (o el log de depuración) el tiempo entre soltar la tecla y ver el texto.

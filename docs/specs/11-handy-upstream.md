# 11 · Handy upstream: qué trae y si conviene traerlo

Análisis de solo lectura, 2026-11-25. Compara nuestra rama (`claude/relaxed-galileo-35qgvt`, commit `cacde98`) contra Handy hoy (`upstream/main`, commit `bdb68c8`, v0.10.2). Nos separamos en `e3206aa` (Handy v0.8.3, 2026-05-13). Desde ahí Handy sumó 301 commits. No se tocó el árbol de trabajo ni se compiló nada.

## Recomendación

**Camino C: pasar nuestras funciones arriba de Handy v0.10.2 en un proyecto aparte, con una PC con Windows a mano, antes de que Vento Voice llegue a su primer usuario de afuera. No mergear ahora.**

- Lo que más nos sirve de Handy no se puede traer suelto: el motor nuevo (que elimina ONNX Runtime y, con eso, el problema de `ort-sys` en el build de Windows), la transcripción en un proceso aparte, el grabador reescrito y los arreglos de la píldora en Windows están hechos sobre archivos que ellos reescribieron y que nosotros también cambiamos.
- Un merge directo choca en 46 archivos, 19 de ellos con trabajo a mano de verdad, y desde la nube no se pueden probar teclas globales, micrófono ni pegado.
- **Costo:** es el trabajo más grande del repo hasta ahora. No lo puedo medir en días desde acá; el tamaño es este: 19 archivos a rehacer a mano (unas 4.200 líneas en conflicto, sin contar traducciones) y repetir completa la prueba manual en Windows de las SPECs 01 a 07. **Riesgo:** romper algo ya validado (píldora, selección, contexto, manos libres) y descubrirlo recién en Windows.
- Hacerlo antes de lanzar importa: el motor nuevo obliga a bajar de nuevo los modelos ONNX (Parakeet V3, nuestro recomendado, pasa de 456 MB a 740 MB). Hoy eso no le cuesta a ningún usuario.
- Mientras tanto hay 7 arreglos chicos que entran limpios hoy ([Paso 0](#paso-0-siete-arreglos-que-entran-limpios-hoy)). No hacer nada tampoco es gratis: Handy avanza unos 50 commits por mes y seguimos con Rust fijado en 1.97.

## Lo que ya se trajo a mano (v0.2.1, 2026-11-25)

Ezequiel probó la v0.2.0 en Windows y la transcripción "a veces no es tan precisa". Tres arreglos de audio de Handy atacan justo eso y no dependen del motor nuevo, así que se portaron a mano (el `cherry-pick` choca porque en el medio está el cambio de motor):

| Arreglo de Handy                                         | Qué se perdía                                                                                                                                           | Dónde quedó                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| #1344 `eb9301e` reiniciar el resampler entre grabaciones | Los primeros ~30 ms de cada dictado traían audio del anterior: primera palabra rota o un pedazo de texto viejo.                                         | `FrameResampler::reset()`, llamado al empezar a grabar. |
| #1958 `df21683` no perder la cola del audio (callback)   | El último bloque del micrófono, capturado antes de soltar la tecla, se tiraba: hasta un período de callback (peor con Bluetooth). Es la última palabra. | `handle_input_block` en `recorder.rs`.                  |
| #1958 `df21683` no perder la cola del audio (resampler)  | Los 10 a 30 ms que quedaban en la línea de retardo del resampler al terminar.                                                                           | `FrameResampler::finish()`.                             |

Con sus tests (11 del resampler, 1 del callback). **No se trajeron:** `cb9654c` (micrófono más rápido, 297 líneas sobre archivos que cambiamos nosotros) y `2203a82` (corrección por diccionario: su arreglo principal apaga la coincidencia aproximada para palabras con tilde, que para español es peor). Los dos quedan para el rebase.

## Temas: qué arregla cada uno y qué hacemos

Veredictos: **Vale la pena** (arregla algo que un usuario nuestro de Windows o macOS se va a encontrar, o saca un problema de build), **Lindo de tener**, **No traer**.

Columna "Base": **código** = leí el diff o el archivo; **mensaje** = leí la descripción del commit o las notas de versión; **título** = solo el título del commit.

| Tema                                                | Qué arregla para el usuario                                                                                                                                                                                                                                                         | Veredicto                                                                                                                 | Base    |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------- |
| Motor de transcripción (`transcribe.cpp`, sin ONNX) | Saca ONNX Runtime: el build de Windows deja de depender de `ort-sys` y de fijar Rust. Si el modelo o la placa de video se cuelgan, la app sigue viva y reintenta en CPU. Modelos con texto en vivo mientras hablás.                                                                 | **Vale la pena.** Solo llega con el camino C.                                                                             | código  |
| Grabador de audio (`handy-recorder`)                | Se pierde la última palabra al cortar. Restos del dictado anterior al inicio del siguiente. Micrófono USB o Bluetooth que se desconecta y deja la app trabada. Aviso cuando el micrófono manda solo silencio.                                                                       | **Vale la pena.** Llega con C.                                                                                            | mensaje |
| Pegado                                              | Dictar con una captura de pantalla copiada la borraba del portapapeles. Pegar en una ventana que corre como administrador falla sin avisar (Windows). El pegado ya no frena el hilo principal.                                                                                      | **Vale la pena.** Lo de la imagen entra hoy (Paso 0).                                                                     | código  |
| Píldora en Windows                                  | Aparece en el monitor equivocado o corrida con monitores a distinta escala. Se corta si Windows tiene "Tamaño del texto" arriba de 100 %. Clic derecho sobre la píldora abría el menú del navegador (Atrás, Imprimir).                                                              | **Vale la pena.** A mano: nuestro `overlay.rs` está reescrito y usa todavía el cálculo viejo de monitor.                  | código  |
| Atajos de teclado                                   | Escape queda capturado en todo el sistema después de una grabación muy corta. Nuestro código tiene el mismo defecto y lo repite con la barra espaciadora de manos libres. Un toque corto se leía como "mantener" la primera vez. Atajos imposibles de registrar quedaban guardados. | **Vale la pena.**                                                                                                         | código  |
| Estabilidad y datos                                 | Si el archivo de ajustes no se puede leer, hoy se resetea todo: diccionario, snippets, comandos, claves. El texto dictado queda escrito en el log. La app aborta al cerrarse si algo falló antes.                                                                                   | **Vale la pena.**                                                                                                         | código  |
| Windows (varios)                                    | La ventana quedaba en blanco al elegir F6 como atajo. Permiso de micrófono trabado con herramientas "debloat". Runtime de Visual C++ dentro del instalador, para que arranque en una PC limpia. Ícono de bandeja invisible con barra oscura y apps claras.                          | **Vale la pena.**                                                                                                         | mensaje |
| Limpieza con IA (post-proceso)                      | Defensa contra instrucciones dictadas, tope de 60 s, un solo cliente HTTP. Detalle en [3(b)](#3b-los-cuatro-cambios-de-post-proceso-y-pegado).                                                                                                                                      | **Lindo de tener.** Se copian las ideas; nuestra limpieza va a la función de Vento.                                       | código  |
| Modelos: catálogo y descargas                       | 76 modelos con nota de precisión por idioma. Descargas desde Hugging Face que se pueden cancelar y retomar. Detección automática de idioma con cualquier modelo.                                                                                                                    | **Lindo de tener.** Viene pegado al motor. Suma dependencia de servidores de Handy.                                       | código  |
| Palabras personalizadas y muletillas                | Una corrección de palabras propias podía hacer perder la transcripción. Frases de varias palabras. Un "." suelto ya no se pega.                                                                                                                                                     | **Vale la pena** lo de palabras propias (nuestro diccionario usa eso). El resto, lindo de tener.                          | título  |
| Modo "Auto" del atajo                               | La misma tecla sirve para mantener o para tocar una vez.                                                                                                                                                                                                                            | **Lindo de tener.** Hace lo que nuestro manos libres sin capturar la barra espaciadora.                                   | mensaje |
| Onboarding nuevo                                    | Primera vez guiada: permisos, elegir modelo según tus idiomas, probar el dictado.                                                                                                                                                                                                   | **Lindo de tener.** Trae la mascota y los textos de Handy: hay que revestirlo y sumarle el login de Vento.                | mensaje |
| Avisos de error                                     | Errores visibles en la píldora y en un panel, en vez de fallar callado.                                                                                                                                                                                                             | **Lindo de tener.** Nuestra píldora ya muestra errores (SPEC 02). Handy sacó `sonner`; nosotros lo usamos en 14 archivos. | mensaje |
| Historial y transcribir archivos                    | Transcribir un audio arrastrándolo a la ventana. Dos audios del historial ya no suenan a la vez.                                                                                                                                                                                    | **Lindo de tener.** Lo del audio entra hoy (Paso 0).                                                                      | mensaje |
| macOS                                               | Aparece bien en "Ítems de inicio". Cmd+V correcto en teclados no QWERTY. Aviso cuando otra app bloquea el teclado (Secure Input). Metal apagado en Mac Intel, donde colgaba la carga del modelo.                                                                                    | **Lindo de tener** hoy. **Vale la pena** cuando salga macOS; llega con C.                                                 | título  |
| Apariencia claro / oscuro                           | Selector Claro / Oscuro / Sistema.                                                                                                                                                                                                                                                  | **No traer.** Vento es negro + lima y pisa nuestro `App.css`.                                                             | mensaje |
| Actualizador                                        | Plugin al día y link correcto al instalador en modo portable.                                                                                                                                                                                                                       | **No traer** ahora. Lo tenemos apagado; hay que armar el nuestro.                                                         | título  |
| Traducciones                                        | 22 commits: idiomas nuevos y correcciones.                                                                                                                                                                                                                                          | **No traer** suelto: chocan los 20 archivos. Llegan con C.                                                                | título  |
| Solo Linux                                          | 42 commits: Wayland, pegado con `wtype`/`ydotool`, AppImage, Nix.                                                                                                                                                                                                                   | **No traer.** No es plataforma nuestra.                                                                                   | título  |
| CI, versiones y docs                                | Builds sin ONNX, Rust estable sin fijar, Windows ARM.                                                                                                                                                                                                                               | **Vale la pena** lo de Windows; va con el motor.                                                                          | código  |

## 3(a) ¿El motor de Handy saca el problema de `ort-sys` en Windows?

**Sí.** Lo verifiqué leyendo `src-tauri/Cargo.toml` y `src-tauri/Cargo.lock` de `upstream/main`:

- En el `Cargo.lock` de Handy hoy no hay ningún paquete `ort`, `ort-sys`, `transcribe-rs` ni `vad-rs`. En el nuestro están `ort 2.0.0-rc.12`, `ort-sys 2.0.0-rc.12`, `transcribe-rs 0.3.8` y `vad-rs 0.1.6`.
- Todos los modelos corren por `transcribe-cpp 0.4.2`. En Windows x64 usa Vulkan y en Mac con Apple Silicon usa Metal. Hasta el detector de voz (Silero VAD) dejó ONNX: el archivo `silero_vad_v4.onnx` se reemplazó por `silero-vad-v6.2-F32.gguf`.
- El CI de Handy usa `dtolnay/rust-toolchain@stable`, sin fijar versión. El nuestro fija `1.97.0` por `ort-sys`.

Tres cosas a saber:

1. **No hay un arreglo chico para copiar.** Handy nunca actualizó `ort`: se quedó en `2.0.0-rc.12` hasta que lo eliminó del todo (`5197faf`, 2026-10-15, publicado en v0.10.0). La migración arranca en `31d8fc2` (2026-07-01) y son decenas de commits encadenados.
2. **Un problema más del build actual.** Nuestro Windows usa la opción `ort-directml`. Según el comentario que Handy dejó al sacarla, ese ONNX Runtime precompilado se cierra al abrir en procesadores anteriores a Haswell (2013 para atrás). Lo leí, no lo reproduje.
3. **Hay un parche intermedio, sin probar.** Entre v0.9.0 y v0.9.8 Handy sacó `ort-directml` y enlazó en Windows el ONNX Runtime oficial de Microsoft (variable `ORT_LIB_LOCATION` en el CI). Puede que eso esquive la falla sin fijar Rust. No lo pude comprobar.

### Qué pasa con los modelos ya bajados

Verificado en `src-tauri/src/managers/model.rs`, `src/App.tsx` y `src-tauri/src/catalog/catalog.json` de Handy.

- **Whisper (Small, Medium, Turbo, Large, Breeze): no hay que volver a bajarlos.** Los archivos `.bin` viejos siguen cargando con el motor nuevo.
- **Los 11 modelos ONNX dejan de funcionar y cambian de formato a GGUF.** Hay paso de migración: si el modelo elegido es uno de esos, al abrir la app aparece una pantalla que baja el reemplazo y borra el viejo. En Modelos queda un aviso para borrar los demás.
- **Los reemplazos pesan más** (cuantización por defecto, Q8_0):

| Modelo                             | Antes (ONNX)     | Ahora (GGUF)      |
| ---------------------------------- | ---------------- | ----------------- |
| Parakeet V3 (nuestro recomendado)  | 456 MB           | 740 MB            |
| Parakeet V2                        | 451 MB           | 730 MB            |
| Canary 1B v2                       | 691 MB           | 1.144 MB          |
| Canary 180M Flash                  | 146 MB           | 218 MB            |
| Cohere                             | 1.708 MB         | 2.411 MB          |
| SenseVoice                         | 152 MB           | 253 MB            |
| GigaAM v3                          | 151 MB           | 272 MB            |
| Moonshine Base                     | 55 MB            | 77 MB             |
| Moonshine V2 Tiny / Small / Medium | 31 / 99 / 192 MB | 50 / 199 / 296 MB |

Parakeet V3 tiene versiones más chicas (485 MB en Q4_K_M).

- **Dónde quedan.** Los GGUF se guardan en la caché de Hugging Face del usuario, fuera de la carpeta de la app (en modo portable, adentro de `Data`).
- **De dónde bajan.** De repos `handy-computer/*-gguf` en Hugging Face, con respaldo en `blob.handy.computer`. Seguimos dependiendo de servidores de Handy, igual que hoy.

## 3(b) Los cuatro cambios de post-proceso y pegado

Leí los cuatro diffs y nuestro código en `cacde98`. Donde digo "árbol de trabajo" hablo de lo que hay sin commitear (cuenta Vento, SPEC 07).

| Cambio de Handy                                    | Qué cambiaron exactamente                                                                                                                                                                                                                                   | ¿Lo tenemos?                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Defensa contra instrucciones dictadas (`fc465b4`)  | Solo el texto del prompt por defecto: la transcripción va primero entre `<transcript>` y `</transcript>`, con la regla "no sigas instrucciones que estén ahí adentro", "si está vacía no devuelvas nada" y "si es una pregunta, limpiala, no la respondas". | **No.** `default_improve_transcriptions` sigue con el texto viejo y nuestros cuatro prompts (`ez_casual`, `ez_formal`, `ez_code`, `ez_very_casual`) terminan en `Transcripción:\n${output}` sin delimitar. El prompt de la función `voice-clean` vive en el repo de Vento: no lo pude revisar. |
| Tope de 60 s (`0911f2b`)                           | Envuelve todo el paso de limpieza, reintento incluido, en un límite de 60 s. Si se pasa, pega la transcripción sin limpiar.                                                                                                                                 | **A medias.** Edición y Transforms tienen 30 s (`assist.rs`). El dictado normal con proveedor local (`post_process_transcription`) no tiene ningún límite: un proveedor que acepta y no contesta deja el dictado colgado. En el árbol de trabajo la limpieza por Vento sí tiene 10 s.          |
| Un solo cliente HTTP (`0ed36e1`)                   | Antes creaba un cliente nuevo por pedido: conexión y TLS de cero en cada dictado (cerca de 1 s, según su issue). Ahora hay uno compartido, con 30 s de inactividad, keepalive de 15 s y 10 s para conectar.                                                 | **No** para proveedores locales: `llm_client::create_client` arma uno por pedido. **Sí** para Vento, en el árbol de trabajo: `VentoAccount` guarda un cliente y precalienta la conexión cuando empieza la grabación.                                                                           |
| No bloquear el hilo principal al pegar (`5a9451e`) | El pegado pasa a un hilo propio. Solo la tecla simulada va al hilo principal. Suma un candado para que dos pegados no se pisen el portapapeles y un contador para que un pegado tardío no oculte la píldora de la grabación siguiente.                      | **No.** Pegamos dentro de `run_on_main_thread` (`actions.rs`, dictado y Transforms). Con la demora por defecto el bloqueo es de unos 110 ms. Importa más si se sube la demora, o al pegar en una ventana nuestra (el Bloc).                                                                    |

Qué hacer con esto:

1. La regla contra instrucciones dictadas va en el prompt de la función de Vento y en nuestros cinco prompts locales. `ensure_post_process_defaults` solo agrega prompts que faltan: para quien ya instaló hace falta una migración por id.
2. El tope al camino local son unas 10 líneas en `process_transcription_output`.
3. El cliente compartido y el pegado en hilo propio llegan con el camino C. No conviene portarlos a mano antes.

## 3(c) Dónde sigue apareciendo Handy en nuestro árbol

El README de Handy dice desde `8f72266` (2026-06-23): el nombre, el logo, el ícono y los recursos de marca de Handy no son de código abierto, y los forks deben usar su propia marca sin sugerir afiliación.

`git grep -il handy` en `cacde98` da 74 archivos (sin contar los lockfiles), más 5 archivos con "handy" en el nombre.

### Lo ve el usuario o viaja en el instalador

| Dónde                             | Qué queda                                                                                                                                                                                                                                                                                                                         | Archivo                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Ícono de la bandeja               | Es la mano de Handy. Lo confirmé abriendo las imágenes. Los 6 `tray_*.png` se muestran siempre en Windows y macOS. `handy.png`, `recording.png` y `transcribing.png` (mano rosa) solo se usan en Linux, pero viajan en todos los instaladores. Nunca se reemplazaron: el commit del ícono Funko cambió `icons/`, no `resources/`. | `src-tauri/resources/`                                                             |
| Texto de la bandeja               | El cartel al pasar el mouse y el primer renglón del menú dicen "Handy v0.1.0".                                                                                                                                                                                                                                                    | `src-tauri/src/tray.rs`                                                            |
| Nombre del ejecutable             | El programa instalado se llama `handy.exe` (en Mac, `Contents/MacOS/handy`). Se ve en el Administrador de tareas y en la carpeta de instalación.                                                                                                                                                                                  | `src-tauri/Cargo.toml`                                                             |
| Archivos en el disco del usuario  | El log se llama `handy.log`. Los audios guardados, `handy-<fecha>.wav`. El archivo que marca el modo portable dice "Handy Portable Mode".                                                                                                                                                                                         | `lib.rs`, `actions.rs`, `managers/history.rs`, `portable.rs`, `nsis/installer.nsi` |
| Ícono en Ajustes                  | La mano de Handy dibujada en SVG, como ícono de una sección.                                                                                                                                                                                                                                                                      | `src/components/icons/HandyHand.tsx`                                               |
| Pantalla "Acerca de"              | El botón de donar abre `handy.computer/donate`. El de código fuente abre `github.com/cjpais/Handy`.                                                                                                                                                                                                                               | `src/components/settings/about/AboutSettings.tsx`                                  |
| Aviso de actualización            | El botón del modo portable abre las descargas de Handy, no las nuestras.                                                                                                                                                                                                                                                          | `src/components/update-checker/UpdateChecker.tsx`                                  |
| Descarga de modelos               | Las 16 direcciones apuntan a `blob.handy.computer`. No es un logo, pero cada modelo que baja un usuario nuestro sale del servidor de Handy y lo paga Handy.                                                                                                                                                                       | `src-tauri/src/managers/model.rs`                                                  |
| Identidad ante el proveedor de IA | Los pedidos salen con `X-Title: Handy`, `User-Agent: Handy/1.0` y referencia a `github.com/cjpais/Handy`. En OpenRouter, por ejemplo, el uso figura como "Handy".                                                                                                                                                                 | `src-tauri/src/llm_client.rs`                                                      |
| 18 idiomas                        | Todos menos español e inglés tienen 10 u 11 textos que dicen "Handy" (permisos, inicio automático, bandeja, Acerca de).                                                                                                                                                                                                           | `src/i18n/locales/*/translation.json`                                              |
| Ayuda por consola                 | `handy --help` muestra "Handy - Speech to Text".                                                                                                                                                                                                                                                                                  | `src-tauri/src/cli.rs`                                                             |
| Pantalla de debug                 | Muestra rutas `%APPDATA%/handy`, que además están mal: nuestra carpeta es `com.lamas.ezequielito`.                                                                                                                                                                                                                                | `src/components/settings/debug/DebugPaths.tsx`                                     |

Ya está bien: nombre del producto y título de ventana ("Ezequielito"), identificador (`com.lamas.ezequielito`), ícono de la app y del instalador (Funko, confirmado abriendo `icons/icon.png`), logotipo de la barra lateral (lee `app.name`), textos en español e inglés. La plantilla del instalador solo nombra a Handy en comentarios y en la marca de modo portable.

### Interno (no lo ve el usuario)

- **Repo en GitHub:** `README.md` es el de Handy entero (84 menciones). `.github/FUNDING.yml` hace que el botón "Sponsor" de nuestro repo apunte a las cuentas de `cjpais`. Las plantillas de issues y PR mandan a las discusiones de Handy. `CONTRIBUTING*.md`, `BUILD.md`, `AGENTS.md`, `CRUSH.md`.
- **Logo completo en el repo:** `src-tauri/icons/logo.png` es el logo de Handy (la mano sobre fondo rosa). No lo referencia ni el instalador ni el código. Conviene borrarlo.
- **Nombres en el código:** la librería `handy_app_lib`, los componentes `HandyTextLogo` y `HandyKeysShortcutInput`, el módulo `shortcut/handy_keys.rs`, las variables `HANDY_NO_GTK_LAYER_SHELL` y `HANDY_FORCE_TRANSCRIPTION_FAILURE`, comentarios.
- **Dependencias:** el paquete `handy-keys` y la rama `handy-2.10.2` del fork de Tauri. Son nombres de dependencias, no marca nuestra. En la pantalla de debug la opción aparece como "Handy Keys".
- **CI y Nix:** nombres de artefactos (`asset-prefix: "handy"`), descargas de ONNX Runtime desde `blob.handy.computer`, archivos `nix/` y `flake.nix`.

Con el camino C esto crece: en Handy hoy son 155 archivos con "Handy", contra 74 nuestros. Llegan la mascota (`HandyMascot.tsx`, `Mascot.tsx`), el onboarding con sus textos, las notas de versión, íconos de aviso de la bandeja y el catálogo `@handy-computer/models`. El cambio de marca hay que hacerlo después de subir, no antes.

## Dificultad del merge, en números

Medido con `git merge-tree --write-tree HEAD upstream/main`, que calcula el merge sin tocar nada.

- **Cambio de Handy desde el fork:** 368 archivos, 74.603 líneas agregadas, 12.987 borradas (301 commits; 4 son merges).
- **Cambio nuestro:** 142 archivos, 13.528 líneas agregadas, 789 borradas (26 commits).
- **Archivos en conflicto: 46.** 45 por contenido y 1 porque Handy borró un archivo que nosotros cambiamos (`tailwind.config.js`).
- **Líneas dentro de bloques en conflicto:** 11.328. De esas, 7.105 son traducciones y 4.223 son el resto.

### Los 19 que cambiamos mucho (trabajo a mano)

| Archivo                                               | Bloques           | Líneas en conflicto |
| ----------------------------------------------------- | ----------------- | ------------------- |
| `src-tauri/src/overlay.rs`                            | 9                 | 744                 |
| `src-tauri/src/actions.rs`                            | 12                | 480                 |
| `src-tauri/src/transcription_coordinator.rs`          | 5                 | 303                 |
| `src-tauri/src/managers/history.rs`                   | 12                | 190                 |
| `src-tauri/src/shortcut/handy_keys.rs`                | 1                 | 100                 |
| `src-tauri/src/settings.rs`                           | 2                 | 60                  |
| `src-tauri/src/commands/history.rs`                   | 1                 | 45                  |
| `src-tauri/src/lib.rs`                                | 5                 | 41                  |
| `src-tauri/src/shortcut/mod.rs`                       | 1                 | 39                  |
| `src-tauri/src/tray.rs`                               | 1                 | 23                  |
| `src/overlay/RecordingOverlay.css`                    | 3                 | 784                 |
| `src/overlay/RecordingOverlay.tsx`                    | 5                 | 628                 |
| `src/App.css`                                         | 5                 | 291                 |
| `src/components/Sidebar.tsx`                          | 5                 | 94                  |
| `src/components/icons/HandyTextLogo.tsx`              | 1                 | 16                  |
| `src/App.tsx`                                         | 1                 | 15                  |
| `src/stores/settingsStore.ts`                         | 1                 | 12                  |
| `src/components/settings/general/GeneralSettings.tsx` | 1                 | 5                   |
| `tailwind.config.js`                                  | borrado por Handy | —                   |

En los archivos Rust más pesados el cambio de Handy es más grande que el nuestro: `transcription_coordinator.rs` 1.697 líneas de ellos contra 149 nuestras, `settings.rs` 1.419 contra 350, `actions.rs` 1.012 contra 537, `overlay.rs` 783 contra 582. Por eso conviene partir de su versión y volver a poner lo nuestro encima, no al revés.

### Los 27 mecánicos

- **20 archivos de traducción** (`src/i18n/locales/*/translation.json`): 7.105 líneas. Se resuelven con un script que une las claves.
- **`src/bindings.ts`** (4 bloques, 202 líneas): es generado, se regenera.
- **`src-tauri/Cargo.lock`:** se regenera.
- **`src-tauri/Cargo.toml`, `package.json`, `src-tauri/tauri.conf.json`, `.github/workflows/build.yml`, `AGENTS.md`:** pocos bloques, pero `build.yml` (3 bloques, 103 líneas) define el build de Windows y hay que revisarlo con cuidado.

### Lo que el número no muestra

- **Roturas sin conflicto.** Archivos nuestros que mergean sin chocar y después no compilan porque Handy cambió lo que usan. Tres ejemplos comprobados: `assist.rs` llama a `send_chat_completion_with_schema` con `ReasoningConfig`, que Handy eliminó. `change_tray_icon` ya no existe. `sonner` salió de `package.json` y lo usamos en 14 archivos.
- **Trabajo sin commitear.** Todo se midió contra `cacde98`. Mientras escribía esto había cambios sin commitear en `actions.rs`, `settings.rs`, `lib.rs`, `shortcut/mod.rs`, `bindings.ts` y las traducciones, más archivos nuevos (`vento.rs`, `vento_sync.rs`, `commands/vento.rs`). Todos caen sobre archivos que ya están en la lista: el número de 46 no baja y los bloques crecen.
- **Cherry-picks.** Probé los 297 commits de Handy de a uno contra nuestro `HEAD`: 59 entran limpios y 238 chocan. De los 59, la mayoría son documentación, Linux y traducciones. Muchos de los 238 chocan no por culpa nuestra sino porque dependen de commits anteriores de Handy.

## Los cuatro caminos

| Camino                                                 | Qué da                                                                                                                | Costo y riesgo                                                                                                                                                       |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A.** Mergear ahora                                   | Todo, de una.                                                                                                         | 46 conflictos sobre un árbol que otras sesiones están editando, sin poder compilar ni probar Windows. Riesgo alto de dejar la rama rota.                             |
| **B.** Solo cherry-picks                               | Arreglos sueltos, riesgo bajo.                                                                                        | No trae el motor: sigue `ort-sys`, sigue Rust fijado, y la distancia con Handy crece.                                                                                |
| **C.** Subir lo nuestro arriba de Handy, como proyecto | Motor sin ONNX, proceso aparte, grabador nuevo, arreglos de Windows, y quedar cerca de Handy para traer lo que venga. | El trabajo más grande del repo. Necesita Windows a mano y repetir la prueba manual de todas las SPECs. Además trae más marca de Handy para limpiar. **Recomendado.** |
| **D.** No hacer nada                                   | Cero trabajo hoy.                                                                                                     | Rust fijado en 1.97, posible cierre al abrir en PCs viejas, y cada mes el salto es más caro.                                                                         |

### Cómo haría C

1. Esperar a que el trabajo en curso (SPEC 07) esté commiteado.
2. Abrir una rama desde `upstream/main` (v0.10.2).
3. Pasar nuestras funciones en el orden de las SPECs, una PR por SPEC, probando cada una en Windows antes de seguir. Los módulos nuevos (`active_window.rs`, `selection.rs`, `assist.rs`, `vento*.rs`, las vistas, `insights.ts`) se copian casi sin tocar. Lo que se reescribe es el enganche en `actions.rs`, `overlay.rs`, `transcription_coordinator.rs`, `settings.rs` y `shortcut/`.
4. Al final, el cambio de marca completo (sección 3(c)) y el build de Windows sin fijar Rust.

### Paso 0: siete arreglos que entran limpios hoy

Probados con `git merge-tree --merge-base=<commit>^ HEAD <commit>`, que hace la misma cuenta que un cherry-pick, contra `cacde98`. Los siete tocan archivos distintos, así que el orden no cambia el resultado; van por fecha. **No compilé nada:** "limpio" quiere decir que el texto entra sin conflicto. Revisé a mano que las funciones que usan existan en nuestro código.

| Orden | Commit    | Qué arregla                                                                                            | Archivo                                  | Resultado                                                                                                                                 |
| ----- | --------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `a6df742` | La app abortaba al cerrarse si antes había fallado algo en la transcripción.                           | `managers/transcription.rs`              | Limpio. No tocamos ese archivo.                                                                                                           |
| 2     | `4be7911` | Dos audios del historial sonando a la vez.                                                             | `HistorySettings.tsx`, `AudioPlayer.tsx` | Limpio. No tocamos esos archivos.                                                                                                         |
| 3     | `3ed2b21` | Dictar borraba la imagen que tenías copiada (una captura, por ejemplo).                                | `clipboard.rs`                           | Limpio. No tocamos ese archivo.                                                                                                           |
| 4     | `8a362e9` | "Silenciar mientras grabo" te devolvía el sonido aunque lo tuvieras silenciado de antes.               | `managers/audio.rs`                      | Limpio. No tocamos ese archivo.                                                                                                           |
| 5     | `3f24f4b` | En Windows con herramientas "debloat", la app se trababa en la pantalla de permiso de micrófono.       | `commands/audio.rs`                      | Limpio. No tocamos ese archivo.                                                                                                           |
| 6     | `8605699` | El instalador de Windows usa nuestro ícono.                                                            | `tauri.conf.json`                        | Limpio. Lo tocamos en otra zona.                                                                                                          |
| 7     | `8020c87` | Si el sistema de teclas no arranca (falta de permiso en Mac), cae al otro en vez de dejarte sin atajo. | `shortcut/handy_keys.rs`                 | Limpio, con una duda: mueve el `HotkeyManager` entre hilos y nosotros usamos `handy-keys 0.2.4`, no 0.3.5. Si no compila, se deja afuera. |

Ninguno de estos archivos tenía cambios sin commitear cuando lo revisé.

### Si C se demora

Estos chocan como cherry-pick pero son cortos de portar a mano. En este orden:

1. **`258899a`: tachar el texto dictado en el log.** Hoy cada dictado queda escrito en `handy.log` (`managers/transcription.rs:727`, nivel de log por defecto: Debug). Son 3 líneas.
2. **`cd040d9`: rescatar los ajustes válidos en vez de resetear.** Hoy un error al leer los ajustes pisa todo con los valores de fábrica (`settings.rs`, cerca de la línea 1214).
3. **`b38987a`: la carrera al registrar Escape.** Hay que extenderlo a nuestra barra espaciadora de manos libres, que usa el mismo patrón.
4. **`0911f2b`: el tope de 60 s** para el camino local.
5. **`e1152d8` y `e29520d`: la posición de la píldora en Windows.** Es el más largo: nuestro `overlay.rs` está reescrito.

## Qué verifiqué y qué no

- **Leí código o diff:** dependencias y CI de Handy (3a), tabla de modelos retirados y catálogo, los cuatro commits de 3(b) y nuestro código equivalente, todo 3(c) incluidas las imágenes, los arreglos de la píldora en Windows, los siete del Paso 0, los cinco de "Si C se demora".
- **Leí el mensaje del commit o las notas de versión:** grabador de audio, onboarding, avisos de error, modo Auto, transcribir archivos, la mayoría de Windows.
- **Solo el título:** macOS, Linux, traducciones, bandeja, las versiones de `handy-keys` (0.2.4 a 0.3.5), palabras personalizadas.
- **No hice:** compilar, correr tests, probar en Windows, mirar el prompt de la función `voice-clean` (está en otro repo), consultar crates.io por versiones más nuevas de `ort`.

## Apéndice: los 297 commits de Handy, por tema

301 commits en total; los 4 que faltan son merges sin cambios propios. "Solo" dice si el commit entra limpio probado de a uno contra `cacde98` (limpio) o choca (choca). Limpio no garantiza que compile.

### A1 · Motor de transcripción (transcribe.cpp, salida de ONNX, proceso aparte, audios largos, detección de idioma)

31 commits · 3 entran limpios solos.

| Commit    | Fecha      | Título                                                                            | Solo   |
| --------- | ---------- | --------------------------------------------------------------------------------- | ------ |
| `bff4db7` | 2026-06-25 | debug + perf transcribe cli (#1541)                                               | limpio |
| `31d8fc2` | 2026-07-01 | introduce transcribe.cpp (#1529)                                                  | choca  |
| `5f54e17` | 2026-07-03 | bump to transcribe-cpp-0.1.1 (#1589)                                              | choca  |
| `afbe763` | 2026-07-05 | move to auto timestamps for all models (#1602)                                    | choca  |
| `f96a7af` | 2026-07-05 | fix: gate whisper run extension on model arch, not Feature::InitialPrompt (#1603) | choca  |
| `c912c6b` | 2026-07-12 | transcribe 0.1.3 (#1664)                                                          | choca  |
| `46d6a2a` | 2026-07-21 | guard vulkan so only available to true x86 host, not emulated (#1731)             | choca  |
| `09aaf4d` | 2026-08-07 | fix moonshine streaming giving the wrong results                                  | choca  |
| `afbf44c` | 2026-08-19 | transcribe.cpp 0.2.0 (#1924)                                                      | choca  |
| `d55ea7e` | 2026-08-19 | drop 'gpu' accelerator selector                                                   | choca  |
| `20ada47` | 2026-08-25 | experimental earshot vad implementation (#1967)                                   | choca  |
| `db1aaac` | 2026-09-14 | bump to transcribe-cpp-0.2.3 (#2005)                                              | choca  |
| `dc5bdc9` | 2026-09-19 | fix: unload model after recordings with no audio (#2106)                          | limpio |
| `2d526b1` | 2026-09-28 | bump to transcribe-cpp-0.2.4 (#2147)                                              | choca  |
| `eea1f5f` | 2026-09-27 | fix: don't start recording when no model can transcribe it (#2161)                | limpio |
| `29bd2c0` | 2026-09-28 | fix: list compute devices off the startup path (#2160)                            | choca  |
| `ffbc950` | 2026-10-03 | transcribe 0.3.0 (#2203)                                                          | choca  |
| `c8262ab` | 2026-10-07 | isolate transcribe.cpp backend in own worker (#2208)                              | choca  |
| `20a6685` | 2026-10-07 | fix: show that the model is loading instead of a stuck "Transcribing..." (#2227)  | choca  |
| `417dc6a` | 2026-10-07 | fix: show model loading in the Live preview when the load is slow                 | choca  |
| `1b011a1` | 2026-10-12 | transcribe 0.4.0 (#2265)                                                          | choca  |
| `3985508` | 2026-10-12 | transcribe.cpp vad (#2267)                                                        | choca  |
| `7b2a28a` | 2026-10-12 | fix: don't re-emit hangover frames in VAD pre-roll                                | choca  |
| `cfcb650` | 2026-10-14 | add ui to migrate onnx model users to gguf (#2277)                                | choca  |
| `5197faf` | 2026-10-15 | actually remove onnx (#2279)                                                      | choca  |
| `4150a4a` | 2026-10-15 | feat: pass custom words via transcribe-cpp vocabulary API (#2284)                 | choca  |
| `9e57a0d` | 2026-10-15 | long form chunking with vad (#2282)                                               | choca  |
| `126bed7` | 2026-10-27 | add language detection (#2331)                                                    | choca  |
| `693aa63` | 2026-11-02 | better pref languages                                                             | choca  |
| `2eab8fc` | 2026-11-11 | fix: replace the transcription worker after a backend error (#2485)               | choca  |
| `0ff1ce1` | 2026-11-12 | bump transcribe.cpp (#2489)                                                       | choca  |

### A2 · Modelos: catálogo y descargas

19 commits · 2 entran limpios solos.

| Commit    | Fecha      | Título                                                                                   | Solo   |
| --------- | ---------- | ---------------------------------------------------------------------------------------- | ------ |
| `cfab1dd` | 2026-06-11 | fix(models): show size for downloaded models (#1484)                                     | choca  |
| `dc01346` | 2026-07-01 | update language selector                                                                 | choca  |
| `9b0d8a1` | 2026-07-01 | edit model recs                                                                          | choca  |
| `dad37ba` | 2026-07-06 | Fix GigaAM v3 description. (#1613)                                                       | choca  |
| `8c46721` | 2026-07-11 | Update descriptions for Moonshine models (#1648)                                         | choca  |
| `b00ae66` | 2026-07-15 | fix(models): handle Hugging Face linked size headers (#1678)                             | choca  |
| `4357c72` | 2026-07-15 | Declutter model cards (only show quantization label on modelcard in debug mode) (#1685)  | choca  |
| `4976530` | 2026-07-15 | fix(model-card): prevent reselection of currently active model (#1662)                   | limpio |
| `68af495` | 2026-07-21 | dont use hf env                                                                          | choca  |
| `e8c73ba` | 2026-07-21 | update catalog                                                                           | choca  |
| `292db64` | 2026-07-28 | Harden Hugging Face downloads and use mirror fallback (#1773)                            | choca  |
| `2f7c2fc` | 2026-07-31 | Update "Manual Model Installation" documentation with Parakeet Unified (#1668)           | limpio |
| `4b3a969` | 2026-08-07 | feat: include streaming and translation filter buttons for easy access of models (#1815) | choca  |
| `9e534a3` | 2026-08-14 | fix(portable): keep Hugging Face models in Data (#1908)                                  | choca  |
| `e4ae0d4` | 2026-09-10 | fix: recover gracefully when model files are deleted outside Handy (#1918)               | choca  |
| `a94b403` | 2026-10-05 | fix(portable): retain access to legacy model cache (#2116)                               | choca  |
| `93c9ee0` | 2026-10-20 | catalog from @handy-computer/models package (#2299)                                      | choca  |
| `d654302` | 2026-11-11 | fix: show a No Model Selected notice instead of a blank model-not-found error (#2418)    | choca  |
| `f248301` | 2026-11-11 | fix: bump hf-hub so downloads survive proxies that strip Range (#2318)                   | choca  |

### A3 · Texto: muletillas, palabras personalizadas, chino

12 commits · 1 entran limpios solos.

| Commit    | Fecha      | Título                                                                   | Solo   |
| --------- | ---------- | ------------------------------------------------------------------------ | ------ |
| `0a59e1f` | 2026-07-07 | fix: preserve ampersands in custom words (#1569)                         | limpio |
| `2203a82` | 2026-07-20 | fix: prevent custom-word correction from losing transcriptions           | choca  |
| `4cd4995` | 2026-08-09 | wip filler fixes (#1738)                                                 | choca  |
| `80995b5` | 2026-08-09 | forgot to commit bindings                                                | choca  |
| `2cf157d` | 2026-08-17 | fix(custom-words): allow multi-word phrases (#1406)                      | choca  |
| `8ef8dd4` | 2026-09-27 | fix: stop removing "Ha" as an English filler word (#2156)                | choca  |
| `eb49dc0` | 2026-09-27 | fix: keep the sentence capital after removing a leading filler (#2157)   | choca  |
| `0bb0428` | 2026-10-03 | add chinese script selector + simplify internals (#2186)                 | choca  |
| `ca4a611` | 2026-11-11 | fix: skip pasting a transcript that is only a period (#2434)             | choca  |
| `c67ec6a` | 2026-11-11 | fix: convert Chinese script based on the text, not the detected language | choca  |
| `b5920f2` | 2026-11-11 | fix: leave Japanese and Korean alone when converting Chinese script      | choca  |
| `1e10e71` | 2026-11-14 | fix: drop a transcript that is only the custom words read back (#2506)   | choca  |

### A4 · Grabador de audio y micrófono

19 commits · 5 entran limpios solos.

| Commit    | Fecha      | Título                                                                                   | Solo   |
| --------- | ---------- | ---------------------------------------------------------------------------------------- | ------ |
| `dd6cc67` | 2026-06-10 | fix(visualizer): scale FFT window to device sample rate (#1491)                          | limpio |
| `cb9654c` | 2026-07-03 | faster mic initialization (#1582)                                                        | choca  |
| `eb9301e` | 2026-07-08 | fix: reset resampler state between recordings to prevent audio crosstalk (#1344)         | choca  |
| `8a362e9` | 2026-07-22 | fix mute bug (#1760)                                                                     | limpio |
| `76b44d8` | 2026-07-31 | fix(audio): recalibrate mic level meter so speech moves the bars (#1813)                 | limpio |
| `a4348be` | 2026-08-03 | fix: recover microphone stream after the capture worker dies (#1838)                     | choca  |
| `b4453a2` | 2026-08-05 | fix(audio): move blocking cpal work off the main thread + lock-free is_recording (#1716) | choca  |
| `12f02e2` | 2026-08-06 | fix: add input channel selection for multi-channel audio interfaces (#1254)              | choca  |
| `db003f3` | 2026-08-08 | fix(audio): skip level meter and resampler while idle in always-on mode (#1873)          | choca  |
| `549cbde` | 2026-08-13 | add a better viz for mic waiting                                                         | choca  |
| `c89b7bf` | 2026-08-17 | fix: fall back to default microphone after disconnect (#1874)                            | choca  |
| `b8ad109` | 2026-08-17 | docs: explain Bluetooth microphone audio tradeoff (#1886)                                | limpio |
| `df21683` | 2026-08-25 | stop losing tail audio when a recording ends (#1958)                                     | choca  |
| `d54c88e` | 2026-09-10 | make microphone callback real-time safe (#1954)                                          | choca  |
| `345caa8` | 2026-10-03 | fix: refresh custom sounds when opening sound selector (#1941)                           | limpio |
| `a42131d` | 2026-10-12 | move to handy-recorder (#2188)                                                           | choca  |
| `d628da4` | 2026-11-11 | bump handy recorder                                                                      | choca  |
| `70f490e` | 2026-11-11 | fix: say so when the microphone sends only silence (#2486)                               | choca  |
| `939c957` | 2026-11-21 | fix: let the output device pick the feedback sound buffer size (#2525)                   | choca  |

### A5 · Pegado

7 commits · 2 entran limpios solos.

| Commit    | Fecha      | Título                                                              | Solo   |
| --------- | ---------- | ------------------------------------------------------------------- | ------ |
| `f0f7e7f` | 2026-07-08 | Apply paste delay after key press and increase slider range (#1465) | choca  |
| `3ed2b21` | 2026-07-21 | fix: restore clipboard images after paste (#1231)                   | limpio |
| `a70ac84` | 2026-07-31 | add more reliable paste (#1812)                                     | choca  |
| `b1b2d9f` | 2026-08-03 | fix reliable paste (#1847)                                          | choca  |
| `bc7face` | 2026-09-05 | 5000ms paste delay                                                  | choca  |
| `42afd1b` | 2026-09-10 | docs: help users troubleshoot stale clipboard pastes (#2058)        | limpio |
| `5a9451e` | 2026-10-21 | fix: stop blocking the main thread during paste (#2302)             | choca  |

### A6 · Píldora / overlay (lo no específico de Windows)

6 commits · 1 entran limpios solos.

| Commit    | Fecha      | Título                                                                          | Solo   |
| --------- | ---------- | ------------------------------------------------------------------------------- | ------ |
| `a92a4d5` | 2026-06-23 | fix: stop overlay mic-level events leaking memory when overlay disabled (#1447) | choca  |
| `cdb4633` | 2026-07-07 | fix: preserve active overlay during post-processing (#1597)                     | choca  |
| `e2c72a2` | 2026-07-08 | fix: throttle mic-level IPC to mitigate WebKitWebProcess memory leak (#1444)    | choca  |
| `8661689` | 2026-07-20 | fix update checker overlay                                                      | limpio |
| `cf49ab3` | 2026-07-31 | run overlay on main thread (#1810)                                              | choca  |
| `16caad7` | 2026-08-05 | fix(overlay): stop rendering animations while hidden (#1445)                    | choca  |

### A7 · Atajos de teclado

19 commits · 2 entran limpios solos.

| Commit    | Fecha      | Título                                                                                | Solo   |
| --------- | ---------- | ------------------------------------------------------------------------------------- | ------ |
| `a201be9` | 2026-07-08 | handy keys 0.3.0 (#1623)                                                              | choca  |
| `468129f` | 2026-07-20 | bump to handy-keys 0.3.1                                                              | choca  |
| `2281b8b` | 2026-07-20 | bump tauri global shortcut                                                            | choca  |
| `59ec695` | 2026-07-20 | bump tauri global shortcut package.json                                               | choca  |
| `390729a` | 2026-07-23 | bump handy keys 0.3.2                                                                 | choca  |
| `16e5d48` | 2026-07-30 | dont fire bindings when recording (#1811)                                             | choca  |
| `7032758` | 2026-08-01 | bump handy-keys to 0.3.3                                                              | choca  |
| `5c77861` | 2026-08-17 | bump handy-keys to 0.3.4                                                              | choca  |
| `286e66c` | 2026-08-23 | fix bindings                                                                          | choca  |
| `c6fa60d` | 2026-08-25 | fix(shortcut): keep toggle parity when presses arrive mid-pipeline (#1910)            | choca  |
| `c62a5fc` | 2026-08-30 | auto push to talk mode (#1971)                                                        | choca  |
| `a6eed75` | 2026-09-19 | fix(shortcut): reject unknown reset binding IDs (#2033)                               | choca  |
| `141f981` | 2026-09-19 | fix: emit parseable names for compound shortcut keys (#1862)                          | choca  |
| `f5c27e6` | 2026-09-27 | fix: reject shortcuts the Tauri backend cannot parse (#2158)                          | choca  |
| `b38987a` | 2026-10-03 | fix: keep the cancel shortcut from staying registered after a short recording (#2190) | choca  |
| `8020c87` | 2026-11-02 | fix: restore shortcut fallback when manager startup fails (#2327)                     | limpio |
| `56c7e21` | 2026-11-11 | fix(shortcut): classify tap vs hold by key event time, not dequeue time (#2097)       | choca  |
| `f01b807` | 2026-11-14 | bump handy-keys to 0.3.5 (#2505)                                                      | choca  |
| `ca2334c` | 2026-11-24 | fix: honor remote-control flags on a cold start (#2557)                               | limpio |

### A8 · Limpieza con IA (post-proceso)

15 commits · 4 entran limpios solos.

| Commit    | Fecha      | Título                                                                                     | Solo   |
| --------- | ---------- | ------------------------------------------------------------------------------------------ | ------ |
| `bc6a41e` | 2026-06-18 | fix: dropdown overflow in post-processing settings (#1402)                                 | limpio |
| `c8eb33b` | 2026-06-24 | fix: skip post-processing when transcription is empty (#1537)                              | choca  |
| `fc465b4` | 2026-07-08 | fix: add prompt injection defense to default post-processing prompt (#1261) (#1310)        | choca  |
| `f79a907` | 2026-07-09 | fix: cancel stalled output processing (#1614)                                              | choca  |
| `148e549` | 2026-07-31 | retry without reasoning (#1809)                                                            | choca  |
| `2211da6` | 2026-08-05 | request stream: false, for post processing                                                 | choca  |
| `4223e7a` | 2026-08-05 | fix: preserve HTTP transport error causes (#1823)                                          | choca  |
| `1bcbfc4` | 2026-08-09 | fix: support compressed API responses (#1548)                                              | limpio |
| `14ae9c6` | 2026-10-13 | feat: support Anthropic Messages API format in the Custom post-processing provider (#2257) | choca  |
| `0ed36e1` | 2026-11-02 | fix: reuse one HTTP client for post-processing requests (#2344)                            | choca  |
| `889fca0` | 2026-11-02 | fix: preserve dictation when post-processing returns blank text (#2290)                    | choca  |
| `033c627` | 2026-11-02 | Add transcription hook (#930)                                                              | choca  |
| `73cc857` | 2026-11-06 | fix(deps): address TLS dependency security advisories (#2432)                              | limpio |
| `0911f2b` | 2026-11-10 | fix: bound post-processing with a 60 s deadline                                            | choca  |
| `27322df` | 2026-11-10 | fix: time out model list requests that never answer                                        | limpio |

### A9 · Estabilidad y datos del usuario

5 commits · 1 entran limpios solos.

| Commit    | Fecha      | Título                                                                        | Solo   |
| --------- | ---------- | ----------------------------------------------------------------------------- | ------ |
| `cd040d9` | 2026-07-08 | salvage valid settings instead of resetting store on parse failure (#1631)    | choca  |
| `a6df742` | 2026-07-08 | fix: prevent abort on quit by handling poisoned mutexes in Drop impls (#1354) | limpio |
| `07637ea` | 2026-07-08 | logging                                                                       | choca  |
| `258899a` | 2026-08-25 | redact transcriptions from log in production build                            | choca  |
| `88185c8` | 2026-11-10 | fix: build the async runtime before streaming logs to the webview (#2478)     | choca  |

### A10 · Específico de Windows

18 commits · 3 entran limpios solos.

| Commit    | Fecha      | Título                                                                             | Solo   |
| --------- | ---------- | ---------------------------------------------------------------------------------- | ------ |
| `f135970` | 2026-07-02 | ship vsredist directly with the app (#1577)                                        | choca  |
| `c06cce7` | 2026-07-03 | fix cyrillic (unicode) path problems (#1187)                                       | choca  |
| `bf258d1` | 2026-07-09 | fix: tray icon invisible on Windows with dark taskbar + light apps (#1423) (#1636) | choca  |
| `1581689` | 2026-07-10 | update windows build instruction                                                   | choca  |
| `0470d9a` | 2026-07-21 | fix windows not shutting down cleanly because of handy (#1732)                     | choca  |
| `b462aa3` | 2026-07-21 | feat: windows single left click on tray icon opens handy window (#369)             | limpio |
| `e1152d8` | 2026-07-22 | fix: place Windows overlay on secondary monitors (#1733)                           | choca  |
| `3f24f4b` | 2026-08-05 | fix: prioritize NonPackaged key in Windows mic permission check (#1284) (#1308)    | limpio |
| `e29520d` | 2026-09-10 | fix overlay with text scaling on windows (#2059)                                   | choca  |
| `2c5c760` | 2026-09-10 | VK_LOADER_LAYERS_DISABLE=~implcit~ default on windows (#2053)                      | choca  |
| `14cfed8` | 2026-09-12 | fix win ci                                                                         | choca  |
| `bf8756c` | 2026-09-14 | fix: disable WebView2 browser accelerator keys in the main window (#2060)          | choca  |
| `8605699` | 2026-10-03 | Add installer icon to NSIS configuration (#2117)                                   | limpio |
| `f81e7e7` | 2026-10-25 | fix: center grade chip labels on Windows (#2326)                                   | choca  |
| `40b8e72` | 2026-11-10 | fix(overlay): disable WebView2 context menu on the recording overlay (#2403)       | choca  |
| `2696c49` | 2026-11-12 | fix: build libopus on windows arm                                                  | choca  |
| `1472087` | 2026-11-12 | fix: build libopus without simd on windows arm                                     | choca  |
| `e529447` | 2026-11-14 | windows: warn if in elevated window (#2502)                                        | choca  |

### A11 · Específico de macOS

17 commits · 6 entran limpios solos.

| Commit    | Fecha      | Título                                                                                    | Solo   |
| --------- | ---------- | ----------------------------------------------------------------------------------------- | ------ |
| `7901ef7` | 2026-06-05 | docs: add Intel Mac (x86_64) build instructions to BUILD.md (#1471)                       | limpio |
| `485f4ad` | 2026-07-08 | fix(build): auto-fall-back to AI stub on Command Line Tools-only macOS (#1510)            | limpio |
| `5a7c0ea` | 2026-07-15 | bump tauri version and Mac dock fixes (#1675)                                             | choca  |
| `3cbbe58` | 2026-07-18 | drop 'direct' paste method from the ui for macOS (#1708)                                  | limpio |
| `d001fcd` | 2026-07-30 | secure input warning and fallback (#1785)                                                 | choca  |
| `0902937` | 2026-08-01 | use SMAppService so Login Items shows Handy (#1825)                                       | choca  |
| `aefc131` | 2026-08-15 | translate key for paste (#1911)                                                           | limpio |
| `98a4d80` | 2026-08-15 | disable metal residency on macos                                                          | choca  |
| `8758dcc` | 2026-08-17 | docs: explain macOS Accessibility after local rebuilds (#1889)                            | limpio |
| `8282c40` | 2026-08-17 | docs: note that fn/Globe shortcuts only work on Apple keyboards (#1926)                   | choca  |
| `00d2554` | 2026-08-31 | preserve held Secure Input shortcuts during reconciliation (#2002)                        | choca  |
| `fbd4e15` | 2026-09-01 | launch as accessory (#2003)                                                               | choca  |
| `330b2dd` | 2026-09-08 | fix: scrollbars styling on macOS when using a non-Apple mouse (#2048)                     | limpio |
| `7bfb2e2` | 2026-10-27 | fix: disable ggml Metal on Intel macOS builds (#2340)                                     | choca  |
| `8c293dd` | 2026-11-02 | fix(macos): prevent silent AirPods recordings when also playing audio from iPhone (#1991) | choca  |
| `dce2976` | 2026-11-11 | fix(macos): clear stale permission grants before asking again (#2057)                     | choca  |
| `b14583a` | 2026-11-24 | revert: stop resetting macOS permissions before asking (#2546) (#2552)                    | choca  |

### A12 · Bandeja del sistema

6 commits · 0 entran limpios solos.

| Commit    | Fecha      | Título                                                                        | Solo  |
| --------- | ---------- | ----------------------------------------------------------------------------- | ----- |
| `5464bfa` | 2026-07-09 | [bugfix] keep track of current tray icon state (#1158)                        | choca |
| `2dd35bb` | 2026-07-09 | fix(tray): log tray icon failures instead of panicking (#1355)                | choca |
| `37a26fd` | 2026-08-11 | fix(tray): stop racing tray rebuilds on recording start/stop                  | choca |
| `5ec2276` | 2026-08-23 | single writer tray icon (#1952)                                               | choca |
| `3d94031` | 2026-11-02 | feat(tray): add language switching submenu (#1319)                            | choca |
| `bdb68c8` | 2026-11-25 | fix: give the tray icon a stable ID so desktops remember its settings (#2563) | choca |

### A13 · Onboarding

4 commits · 0 entran limpios solos.

| Commit    | Fecha      | Título                                                            | Solo  |
| --------- | ---------- | ----------------------------------------------------------------- | ----- |
| `1fd3f91` | 2026-07-10 | fix: surface download errors during onboarding (#1522)            | choca |
| `3882576` | 2026-07-11 | Add cancel download functionality to Onboarding component (#1653) | choca |
| `1cd9266` | 2026-09-09 | fix: horizontal overflow in onboarding views (#2050)              | choca |
| `0e5e9ca` | 2026-10-25 | new onboarding (#2303)                                            | choca |

### A14 · Avisos de error

1 commits · 0 entran limpios solos.

| Commit    | Fecha      | Título                          | Solo  |
| --------- | ---------- | ------------------------------- | ----- |
| `b99b9af` | 2026-11-02 | error notices framework (#2372) | choca |

### A15 · Apariencia, accesibilidad y pantallas de debug

15 commits · 3 entran limpios solos.

| Commit    | Fecha      | Título                                                                           | Solo   |
| --------- | ---------- | -------------------------------------------------------------------------------- | ------ |
| `e526733` | 2026-06-23 | live debug log viewer in app (#1535)                                             | choca  |
| `d929a94` | 2026-07-10 | feat: add Light / Dark / System appearance selector (#1599)                      | choca  |
| `cdf5028` | 2026-07-21 | Refactor Sidebar settings structure (#1720)                                      | choca  |
| `6cad594` | 2026-07-25 | maximize-window: enable maximize and snap support (#1778)                        | limpio |
| `099df58` | 2026-07-31 | slider-reset: add reset icon following existing UI pattern (#1779)               | limpio |
| `6d3239e` | 2026-08-07 | fix: prevent What's New from blanking settings (#1822)                           | choca  |
| `b50b52a` | 2026-08-10 | fix(theme): appearance setting now reaches the overlay + macOS title bar (#1659) | choca  |
| `988521f` | 2026-09-09 | add debug ui (#2052)                                                             | choca  |
| `7c31572` | 2026-09-19 | fix: reset settings scroll position when switching sections (#2082)              | choca  |
| `53db4cb` | 2026-10-14 | fix: expose setting names to screen readers (#2238)                              | limpio |
| `a537ec4` | 2026-11-02 | fix: identify the setting each reset button affects (#2253)                      | choca  |
| `8fd85aa` | 2026-11-02 | fix: let Escape dismiss dropdown menus (#2246)                                   | choca  |
| `090b370` | 2026-11-02 | fix: ignore IME confirmation Enter in text inputs (#2248)                        | choca  |
| `77ad955` | 2026-11-02 | fix: name the audio playback position control (#2254)                            | choca  |
| `3b60fc7` | 2026-11-02 | fix: dismiss focused setting tooltips with Escape (#2251)                        | choca  |

### A16 · Historial y transcribir archivos

9 commits · 5 entran limpios solos.

| Commit    | Fecha      | Título                                                                 | Solo   |
| --------- | ---------- | ---------------------------------------------------------------------- | ------ |
| `4be7911` | 2026-07-15 | fix: prevent history audio players from playing simultaneously (#1665) | limpio |
| `496a80c` | 2026-09-19 | fix(history): show copy success only after clipboard write (#2011)     | choca  |
| `5732406` | 2026-10-14 | fix: avoid duplicate history rows during live updates (#2256)          | limpio |
| `73c0958` | 2026-10-25 | feat: transcribe files into history (#2315)                            | choca  |
| `0685192` | 2026-11-02 | fix: report failed history deletions to users (#2255)                  | limpio |
| `26d2003` | 2026-11-02 | fix: preserve playback position when starting a seek (#2247)           | limpio |
| `a1cb29d` | 2026-11-02 | fix: release late audio sources after leaving history (#2309)          | limpio |
| `815e73f` | 2026-11-02 | state update for decoding a file                                       | choca  |
| `1fe3ae2` | 2026-11-11 | feat: decode Opus audio files (ogg, opus, webm) (#2482)                | choca  |

### A17 · Actualizador

2 commits · 0 entran limpios solos.

| Commit    | Fecha      | Título                                                                    | Solo  |
| --------- | ---------- | ------------------------------------------------------------------------- | ----- |
| `76736d5` | 2026-08-01 | fix: link portable update dialog to the correct installer (#1750) (#1753) | choca |
| `f6fac42` | 2026-08-23 | update to tauri-plugin-updater 2.10.1                                     | choca |

### A18 · Solo Linux (no nos importa)

42 commits · 12 entran limpios solos.

| Commit    | Fecha      | Título                                                                                                 | Solo   |
| --------- | ---------- | ------------------------------------------------------------------------------------------------------ | ------ |
| `933a525` | 2026-05-23 | docs: add overlay/pasting issue workaround for Linux to Known Issues (#1426)                           | limpio |
| `66e57ca` | 2026-07-08 | add openblas to ci and packaging for linux (#1621)                                                     | choca  |
| `438582f` | 2026-07-10 | fix: push-to-talk rapidly toggles recording under X11 auto-repeat (defer synthesized releases) (#1605) | choca  |
| `d1180c4` | 2026-07-20 | fix(linux): install app-private libs to /usr/lib/Handy (#1639) (#1727)                                 | choca  |
| `2266b29` | 2026-08-01 | remove sigusr1 on linux (#1824)                                                                        | choca  |
| `05ca5f4` | 2026-08-01 | docs: add missing Linux build dependencies to BUILD.md (#1561)                                         | choca  |
| `96afb0c` | 2026-08-05 | return freed transcription buffers to the OS on Linux (#1846)                                          | choca  |
| `838f8a2` | 2026-08-05 | feat(nix): add Cachix binary cache to CI (#1237)                                                       | limpio |
| `d7fc6a0` | 2026-08-06 | add appimage version tag to release                                                                    | choca  |
| `eba5d9e` | 2026-08-07 | fix appimage check                                                                                     | choca  |
| `0f32df7` | 2026-08-07 | fix(paste): release the modifier keys after pasting with wtype (#1487)                                 | limpio |
| `b428ae4` | 2026-08-07 | appimage packaging fixes (#1867)                                                                       | choca  |
| `e449f69` | 2026-08-09 | fix: detect ydotool key syntax before paste (#1866)                                                    | limpio |
| `07a54e2` | 2026-08-09 | fix(linux): dispatch paste methods before touching Enigo (#1756)                                       | choca  |
| `30062fa` | 2026-08-09 | Add Ubuntu 26.04 instructions (#1412)                                                                  | limpio |
| `9bcb6d9` | 2026-08-10 | fix(overlay): restore Wayland overlay on Tauri 2.11.5 (Linux) (#1700)                                  | choca  |
| `99052ee` | 2026-08-18 | fix(linux): clear stale modifier latch after xdotool type (#1817) (#1892)                              | limpio |
| `8fd6691` | 2026-08-23 | fix nix build                                                                                          | choca  |
| `c7a68fe` | 2026-08-24 | fix: skip wtype on GNOME Wayland for clipboard paste (#1276)                                           | choca  |
| `fe5b23c` | 2026-08-25 | fix(linux): avoid blocking on external paste scripts (#1957)                                           | choca  |
| `b026660` | 2026-08-29 | Disable update checks for Nix/NixOS packaging (#1576)                                                  | choca  |
| `ba10ce1` | 2026-09-15 | note for fedora/ubuntu install                                                                         | limpio |
| `8f9cf53` | 2026-09-19 | docs: restore the recording indicator on Omarchy with native Wayland (#2040)                           | choca  |
| `73ab851` | 2026-10-04 | Docs/ubuntu 26 04 gnome wayland troubleshooting (#2206)                                                | limpio |
| `586a838` | 2026-10-05 | docs: add overlay, wl-clipboard and non-QWERTY paste notes to the Ubuntu notes (#2212)                 | choca  |
| `afe5a63` | 2026-10-07 | chore: format Ubuntu troubleshooting notes so the prettier check passes                                | choca  |
| `48a3d8e` | 2026-10-10 | fix(linux): allow renderer opt-out without dropping crash protection (#2249)                           | limpio |
| `2b3f7c8` | 2026-10-27 | fix: declare OpenSSL 3 runtime dependency in Debian packages (#2336)                                   | choca  |
| `1607381` | 2026-11-02 | docs: stale user manager can keep sessions without the new input group (#2348)                         | choca  |
| `298653c` | 2026-11-02 | fix(shortcuts): avoid the ibus hotkey on Linux defaults (#2367)                                        | choca  |
| `ef3086e` | 2026-11-02 | fix(linux): add 'None' keyboard implementation for Wayland compositors (#1300)                         | choca  |
| `4ec61f0` | 2026-11-02 | fix(linux): type multi-line text correctly with dotool (#2199)                                         | limpio |
| `f3d8b87` | 2026-11-02 | fix(linux): keep transparent overlay painting on WebKitGTK 2.54 (#2360)                                | choca  |
| `bd87c72` | 2026-11-10 | Let AppImage users opt into native Wayland (#2453)                                                     | choca  |
| `e286103` | 2026-11-11 | fix: turn off the updater on Linux builds that cannot install updates (#2448)                          | choca  |
| `c530a49` | 2026-11-11 | fix: keep X11 overlay resizable so Bottom stays on screen (#2447)                                      | limpio |
| `7102b63` | 2026-11-11 | docs: list OpenBLAS in Linux build dependencies (#2484)                                                | choca  |
| `310749b` | 2026-11-13 | Skip the Gamescope WSI Vulkan layer on Linux (#2454)                                                   | choca  |
| `3c7a538` | 2026-11-13 | fix: find the ydotoold socket when YDOTOOL_SOCKET is not set (#2427)                                   | choca  |
| `bd4b027` | 2026-11-13 | fix: try the next paste tool when one fails on Linux (#2495)                                           | choca  |
| `d2ee871` | 2026-11-14 | fix(overlay): don't steal focus when the overlay falls back to X11 (#2488)                             | limpio |
| `4a096e3` | 2026-11-14 | fix(linux): make Shift+Insert paste in terminals and default to it (#2504)                             | choca  |

### A19 · Traducciones

22 commits · 3 entran limpios solos.

| Commit    | Fecha      | Título                                                                              | Solo   |
| --------- | ---------- | ----------------------------------------------------------------------------------- | ------ |
| `10a4c31` | 2026-05-23 | docs: complete Portuguese translation for portable updates (#1422)                  | limpio |
| `3f49cf1` | 2026-07-04 | Add Dutch (Nederlands) translation (#1590)                                          | limpio |
| `99ac7eb` | 2026-07-04 | Update Japanese translations (#1593)                                                | choca  |
| `6d92e2c` | 2026-07-04 | Improve Dutch (nl) translation accuracy and consistency (#1594)                     | choca  |
| `45e3eed` | 2026-07-07 | Update Italian translations (#1604)                                                 | choca  |
| `58760b2` | 2026-07-08 | Add Nepali translation (#1632)                                                      | choca  |
| `bd8e549` | 2026-07-17 | chore(i18n): update and correct Spanish translation (#1697)                         | choca  |
| `d861e24` | 2026-07-17 | feat: add Hindi (hi) translation (#1701)                                            | choca  |
| `cdbc223` | 2026-07-18 | Add missing translations (#1709)                                                    | choca  |
| `f4e3587` | 2026-07-21 | Add Danish translations (#1747)                                                     | choca  |
| `09a6a71` | 2026-07-28 | fix(i18n): complete zh-TW translations for newer UI strings (#1795)                 | choca  |
| `ea3c20a` | 2026-07-28 | fix(i18n): resolve zh-Hant-\* system locales to Traditional Chinese (zh-TW) (#1798) | limpio |
| `9aae694` | 2026-07-30 | update translations                                                                 | choca  |
| `8abb802` | 2026-08-10 | fix(i18n): make the Turkish translation internally consistent (#1881)               | choca  |
| `5276dd3` | 2026-08-14 | fix(i18n): correct Turkish translation semantics (#1907)                            | choca  |
| `6fa8506` | 2026-08-30 | fix 'no' not showing up + add ci so shouldnt happen again (#2001)                   | choca  |
| `ed1bfb9` | 2026-09-11 | feat: make Handy available in Catalan (#2065)                                       | choca  |
| `2bdf9ac` | 2026-09-12 | feat: add Indonesian translation (#2073)                                            | choca  |
| `f6b3f82` | 2026-10-08 | docs: keep translation contribution guidance aligned with supported locales (#2235) | choca  |
| `4807c21` | 2026-11-19 | feat: add Thai translation (#2529)                                                  | choca  |
| `bebbb96` | 2026-11-24 | feat: add Hungarian translation (#2549)                                             | choca  |
| `a822741` | 2026-11-24 | feat: add Armenian translation (#2550)                                              | choca  |

### A20 · CI, versiones, documentación y repo

28 commits · 6 entran limpios solos.

| Commit    | Fecha      | Título                                                                              | Solo   |
| --------- | ---------- | ----------------------------------------------------------------------------------- | ------ |
| `8f72266` | 2026-06-23 | Clarified branding and redistribution terms for Handy                               | limpio |
| `11c2bb1` | 2026-07-08 | fix build                                                                           | limpio |
| `87c45f8` | 2026-07-08 | bump version (#1634)                                                                | choca  |
| `1c4f21a` | 2026-07-10 | release v0.9.1                                                                      | choca  |
| `ea10f74` | 2026-07-12 | release v0.9.2                                                                      | choca  |
| `b9925d0` | 2026-07-15 | release v0.9.3                                                                      | choca  |
| `17d6c76` | 2026-07-21 | release v0.9.4                                                                      | choca  |
| `347986b` | 2026-07-31 | format                                                                              | choca  |
| `f602ef4` | 2026-08-01 | fix cargo.toml up a bit                                                             | choca  |
| `7a5f397` | 2026-08-05 | pr template: dont submit more than one fix per pr                                   | limpio |
| `d961593` | 2026-08-07 | fix: update js-yaml to address quadratic parsing (#1865)                            | choca  |
| `3388983` | 2026-08-08 | release v0.9.5                                                                      | choca  |
| `079f919` | 2026-08-10 | Fix typos in README.md (#1883)                                                      | choca  |
| `af48dd6` | 2026-08-24 | release v0.9.6                                                                      | choca  |
| `53c55d7` | 2026-09-18 | slim readme                                                                         | choca  |
| `53766a2` | 2026-09-18 | Update README.md                                                                    | limpio |
| `055c7a5` | 2026-09-18 | Update README.md                                                                    | choca  |
| `6917511` | 2026-09-18 | add canty sponsor                                                                   | choca  |
| `05e0aed` | 2026-09-18 | release 0.9.7                                                                       | choca  |
| `340defb` | 2026-10-02 | Update PULL_REQUEST_TEMPLATE.md                                                     | limpio |
| `5ec58f6` | 2026-10-02 | Update PULL_REQUEST_TEMPLATE.md                                                     | choca  |
| `14f6f0d` | 2026-10-03 | release v0.9.8                                                                      | choca  |
| `e4869fc` | 2026-11-01 | chore: cargo fmt                                                                    | choca  |
| `4c811d7` | 2026-11-01 | chore: bump Playwright to 1.64.1 so CI can install Chromium on Ubuntu 26.04 runners | choca  |
| `4fd7ac4` | 2026-11-02 | 0.10.0 release notes                                                                | limpio |
| `69420ed` | 2026-11-02 | release v0.10.0                                                                     | choca  |
| `aca8985` | 2026-11-14 | release v0.10.1                                                                     | choca  |
| `f63ca14` | 2026-11-24 | release v0.10.2 (#2553)                                                             | choca  |

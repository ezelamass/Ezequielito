# 02 · Píldora siempre presente, con clic y con errores

## Problema

La píldora solo aparece mientras se graba. No hay nada en pantalla que recuerde que la app está lista, no se puede empezar a dictar con el mouse y, cuando algo falla (sin micrófono, no se escuchó nada, no se pudo pegar), el aviso sale como toast en la ventana principal, que casi siempre está cerrada.

## Qué cambia

**Estados de la píldora:** `idle` (nuevo) · `recording` · `transcribing` · `processing` · `error` (nuevo).

- **Reposo (`idle`).** Una barrita chica abajo al centro. Al pasar el mouse crece y muestra el micrófono y la tecla configurada. Un clic empieza a dictar en manos libres; el ✓ termina y pega, la ✕ descarta.
- **Error.** La píldora se pone en rojo con un texto corto durante 2,5 s y vuelve a reposo. Códigos: `mic_denied`, `no_mic`, `no_speech`, `transcription_failed`, `paste_failed`, `generic`.
- **Ajuste nuevo** `overlay_idle_pill` (Ajustes → Avanzado → "Píldora siempre visible"). Por defecto: encendido en Windows y macOS, apagado en Linux. Con la posición del overlay en "Ninguna", no se muestra nada.

## Cómo

- `overlay.rs`: dos tamaños de ventana. Reposo 136×28 (para no tapar clics de la app de abajo) y activo 232×38. La ventana le deja 4 px de aire a la píldora de cada lado; sin ese aire el borde de abajo se cortaba.
- **Una sola máquina de estados.** Todas las transiciones de la píldora pasan por un hilo (`overlay_tx`) y las decide `Pill::step`, que es pura: recibe una entrada (`Show`, `Error`, `Settle`, `Refresh`, `TimerFired`) y los ajustes, y devuelve los efectos (redimensionar, mostrar, ocultar, emitir) y el temporizador a armar. Así un paso demorado (achicar después del fade, sacar un error) nunca pisa un estado más nuevo.
- Windows: la ventana se crea con `focusable(false)` (`WS_EX_NOACTIVATE`), para que el clic no le saque el foco a la app donde se va a pegar. macOS ya usa un panel que no activa.
- `transcription_coordinator.rs`: `Command::StartFromOverlay` arranca el binding `transcribe` ya bloqueado en manos libres; `Command::StopActive` (el ✓) frena y transcribe. Comandos `start_dictation_from_overlay`, `confirm_recording` y `overlay_ready` (la píldora avisa que ya escucha eventos y pide su estado de reposo).
- `actions.rs`: los caminos de error llaman a `show_error_overlay` además de emitir los eventos que ya existían.
- Frontend: `RecordingOverlay.tsx` aplica cada estado en el momento en que llega, sin esperar nada antes, para que el evento siguiente lo encuentre puesto.

## Una sola forma que crece (v0.2.1)

Probada en Windows, la primera versión tenía tres defectos: la píldora de grabar era demasiado grande, aparecía de golpe en vez de crecer, y en reposo le faltaba el borde de abajo (lo cortaba la ventana).

- **Un solo elemento para todos los estados.** Antes la barrita de reposo y la píldora de grabar eran dos elementos: una desaparecía y la otra aparecía. Ahora es el mismo `.ez-pill`, que cambia de ancho y alto con una transición de 320 ms (`cubic-bezier(0.22, 1, 0.36, 1)`). El contenido de cada estado entra con un fade corto cuando la forma ya casi llegó.
- **Tamaños:** reposo 40×6 · reposo con el mouse encima, lo justo para la tecla (64 a 128 × 20) · grabando 124×26 · procesando 52×26 · mensaje 216×26. La de grabar pasó de unos 200×40 a 124×26.
- **El borde no se corta:** un test mide que la píldora quede a 3 px o más de cada borde de la ventana, en reposo, grabando y con mensaje.

## Validación

- 11 tests de `Pill::step` (`overlay.rs`): el orden de los efectos, que un dictado nuevo cancele el achique o el error pendiente, error con el overlay apagado, y el ajuste cambiado en reposo.
- 14 tests de Playwright (`tests/overlay.spec.ts`) sobre la píldora real con el runtime de Tauri simulado (`tests/tauriMock.ts`): reposo, hover, clic, ✕, ✓, procesando y error, con captura de cada estado.
- Review independiente del diff: encontró 5 defectos (el estilo de no-activar se perdía en el primer `show()`, el bloqueo de manos libres podía pisarse en el frontend, error con overlay apagado, y dos carreras en los pasos demorados). Corregidos todos; las carreras, reemplazando los atómicos por la máquina de estados.
- `cargo check`, `cargo test`, lint, tsc, formato. Build de Windows por CI.

## Para probar en Windows

1. La barrita aparece al abrir la app y no roba el foco al hacerle clic.
2. Clic → hablar → ✓: el texto se pega en la app que estaba activa.
3. Desenchufar el micrófono y dictar: sale el error en la píldora.
4. Apagar "Píldora siempre visible": desaparece en reposo y vuelve al grabar.

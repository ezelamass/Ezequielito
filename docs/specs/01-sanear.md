# 01 · Sanear el repo

## Problema

- El ✓ de la píldora en manos libres llamaba a `cancel_operation`: descartaba el dictado en vez de pegarlo.
- Los snippets por defecto traían el mail, el Calendly y la firma de Ezequiel: cualquier instalación nueva los recibía.
- El chequeo de calidad estaba en rojo: 64 textos fijos en JSX (regla `i18next/no-literal-string`), 17 archivos sin Prettier, `cargo fmt` sin correr y 18 idiomas sin las claves nuevas.

## Cambios

- **✓ que transcribe.** `Command::StopActive` en `transcription_coordinator.rs` + comando `confirm_recording` (`commands/mod.rs`). Frena la grabación activa, la manda por el flujo normal (transcribir → limpiar → pegar) y suelta el bloqueo de manos libres. La píldora lo llama desde `handleConfirm`.
- **Snippets vacíos por defecto.** `default_snippets()` devuelve una lista vacía. Quien ya tenía los suyos guardados los conserva.
- **Textos a i18n.** Todas las vistas nuevas (Inicio, Insights, Diccionario, Snippets, Estilo, Transforms, Bloc) y la píldora leen de `translation.json` (`en` y `es`). Los otros 18 idiomas reciben el texto en inglés en las claves que les faltaban (`scripts/backfill-translations.ts`), para que el chequeo pase sin inventar traducciones.
- **Formato.** Prettier y `cargo fmt` sobre todo el repo.

## Validación

- `bun run lint`, `bun run check:translations`, `bun run format:check`, `npx tsc --noEmit`: en verde.
- `cargo check` y `cargo test` en Linux.
- Build de Windows por CI.

## Para probar en Windows

1. Dictar con la tecla, tocar la tecla de manos libres, soltar, hablar y tocar el ✓: el texto se tiene que pegar.
2. La ✕ sigue descartando.

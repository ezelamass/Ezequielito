# 05 · Insights con duración y app

## Problema

Insights tenía dos tarjetas de "pendiente" (palabras por minuto y correcciones) porque el historial no guardaba ni cuánto se habló ni en qué app. Y el calendario de racha estaba corrido: las filas decían lunes a domingo, pero la primera fila era el día de la semana que tocara.

## Qué cambia

- **Cada dictado guarda dos datos más:** `duration_ms` (lo que duró la voz, sin los silencios) y `app_name` (la app donde se dictó). Dos columnas nuevas en `transcription_history`, nulas para lo grabado antes.
- **Palabras por minuto** real: palabras totales ÷ minutos hablados. Hasta juntar 30 segundos de voz dice "todavía no hay datos suficientes" en vez de un número sin sentido.
- **Tiempo ahorrado:** lo que habría tardado escribir eso a 40 palabras por minuto, menos lo que se tardó en decirlo. La tarjeta aclara contra qué se compara.
- **Por app:** una barra por app con sus palabras, las 6 principales y el resto en "otras". Si hay dictados sin app registrada, lo dice.
- **Calendario alineado:** la fila de arriba es siempre lunes y la última columna es la semana actual.

## Cómo

- `managers/history.rs`: dos migraciones al final de la lista (`ALTER TABLE … ADD COLUMN`), `DictationMeta { duration_ms, app_name }` como parámetro de `save_entry`.
- `actions.rs`: la duración sale de la cantidad de muestras (16 kHz) y la app de `active_window::active_app()`, leída al soltar la tecla.
- `src/lib/insights.ts`: funciones puras (`computeStats`, `wordsPerMinute`, `timeSavedMinutes`, `appBreakdown`, `calendarWeeks`), todas con `now` como parámetro. `InsightsView.tsx` solo dibuja.

## Validación

- 60 tests con `bun test` (`src/lib/insights.test.ts`): el umbral de 30 segundos, entradas sin duración, el texto limpio antes que el crudo, "otras", la suma de las barras, lunes arriba para cada día de la semana y el cruce de mes y de año. Pasan en seis husos horarios. Corren en CI (`bun run test:unit`).
- `cargo test`: las consultas del historial contra el esquema nuevo.
- La vista se abrió en Chromium con historial simulado (inglés, español, árabe de derecha a izquierda, historial viejo sin datos nuevos, historial vacío).

## Pendiente menor

`HomeView.tsx` tiene su propia copia de la cuenta de palabras y de la racha; debería usar `src/lib/insights.ts`.

## Para probar en Windows

1. Dictar unas frases en dos apps distintas y abrir Insights: aparecen las dos barras y el número de palabras por minuto.
2. Abrir Insights con el historial viejo: no rompe, y dice cuántos dictados no tienen app registrada.

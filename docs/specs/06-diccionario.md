# 06 · Diccionario que aprende

## Problema

El diccionario había que llenarlo a mano, palabra por palabra, y uno recién se acuerda de hacerlo cuando ya vio el nombre mal escrito varias veces.

## Qué cambia

- **La app propone palabras sola.** Cada dictado limpio deja dos textos: lo que el modelo de voz escuchó y lo que quedó después de la limpieza. Si un nombre se corrige de la misma forma en dos dictados o más ("bento" → "Vento", "en roque" → "Enroque", "you tube" → "YouTube"), aparece como sugerencia en la pantalla de Diccionario, con lo que se había escuchado. Un clic lo agrega; otro lo descarta para siempre.
- **Agregar lo seleccionado.** Un atajo nuevo (`add_selection_to_dictionary`, sin tecla por defecto): se selecciona una palabra o un nombre en cualquier app, se toca la tecla y queda en el diccionario. La píldora lo confirma.
- Lo agregado entra en el diccionario de siempre: lo usa el modelo de voz para corregir, se manda a la limpieza de Vento como vocabulario y se sincroniza con la cuenta.

## Qué cuenta como sugerencia

- Tiene que parecer un término: un nombre con mayúscula que no esté al principio de la oración, o una palabra con mayúsculas internas o números (TikTok, GPT-5). Las palabras comunes no entran: eso es ortografía, no vocabulario.
- Tiene que parecerse a algo que se escuchó (una palabra, o dos que debían ser una). Si no se parece a nada, es texto que agregó la limpieza y no se aprende.
- Tiene que repetirse en al menos dos dictados.
- No se propone lo que ya está en el diccionario ni lo descartado (sin distinguir mayúsculas ni tildes).

## Límite conocido

Solo aprende de dictados que pasaron por la limpieza (con sesión de Vento o con un proveedor local): sin limpieza no hay con qué comparar. Y no aprende de lo que uno corrige a mano después de pegado, porque la app no ve el campo de texto; para eso está el atajo de "agregar lo seleccionado".

## Cómo

- `learn.rs` (puro): `suggest_words`, `word_from_selection`, `add_word`. 14 tests.
- `commands/dictionary.rs`: `get_dictionary_suggestions`, `accept_dictionary_suggestion`, `dismiss_dictionary_suggestion`.
- Ajuste `dictionary_dismissed` (lista de descartadas).
- `actions.rs`: `AddToDictionaryAction`, que reutiliza la captura de selección de la brecha 03.

## Para probar en Windows

1. Con sesión de Vento, dictar dos veces una frase con un nombre propio que salga mal transcripto: aparece en Diccionario → Sugerencias.
2. Aceptarla y volver a dictar: ahora sale bien desde la transcripción.
3. Seleccionar un apellido en un mail y tocar el atajo: queda en el diccionario.

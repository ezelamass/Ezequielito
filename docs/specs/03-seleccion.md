# 03 · Tomar la selección sola

## Problema

El modo edición y los transforms trabajaban sobre el portapapeles: había que seleccionar, hacer Ctrl+C a mano y recién ahí apretar la tecla. Si uno se olvidaba, la instrucción se aplicaba a lo último que había copiado, sea lo que sea.

## Qué cambia

- **La app copia por vos.** Al soltar la tecla, simula Ctrl+C (Cmd+C en macOS), lee lo que quedó en el portapapeles y **lo deja como estaba**.
- **Sin selección, escribe.** En modo edición, si no hay nada seleccionado, la instrucción se toma como un pedido ("escribí un mail para…") y el resultado se pega donde está el cursor.
- **Transforms al soltar.** Antes corrían al apretar la tecla, con los modificadores todavía abajo. Ahora corren al soltarla, así el Ctrl+C simulado no se mezcla con Shift o Alt. Sin selección muestran el error en la píldora en vez de fallar en silencio.
- **Mientras trabaja se ve.** Los transforms muestran la píldora "procesando" y, si el modelo falla o no está configurado, el error.

## Cómo

- `selection.rs`: `capture_selection(app, target) -> Selection { Text, Empty, Unsupported }`. Guarda lo que hay en el portapapeles (texto o imagen), lo vacía, espera a que se suelten los modificadores de la tecla, manda copiar en el hilo principal, espera hasta 450 ms a que aparezca texto y restaura el contenido anterior.
- **La copia se simula solo donde es seguro.** En una terminal, Ctrl+C corta el programa que está corriendo. Por eso: en macOS siempre (Cmd+C es copiar en todos lados); en Windows solo si se pudo identificar la app y no es una terminal (Windows Terminal, PowerShell, cmd, etc.); en Linux nunca, porque no se puede saber qué app está al frente. Cuando no se simula, o cuando la tecla no se pudo mandar, devuelve `Unsupported` y se usa lo que el usuario haya copiado a mano, que es como funcionaba antes.
- `win_keys.rs` (Windows): lee el estado físico de Ctrl, Shift, Alt y Win. La copia se manda recién cuando están sueltos; si a los 400 ms siguen apretados, se sueltan Shift y Alt por software antes de copiar.
- `input.rs`: `send_copy` con códigos de tecla que no dependen de la distribución del teclado.
- `assist.rs`: una sola puerta al modelo (`complete`) y el armado del pedido (`build_edit_request`). Reemplaza el código duplicado de modo edición y transforms. Es el punto donde la brecha 07 conecta la limpieza de Vento.
- `actions.rs`: el modo edición lee la selección **después de cerrar el micrófono** y mientras se transcribe, así la espera no se graba ni suma latencia. Si el modelo falla no se pega nada (antes se pegaba la instrucción encima de la selección).
- **Un transform reserva el flujo.** `TransformAction` corre al soltar la tecla y le pide el turno al coordinador (`try_begin_external`): si hay un dictado grabando o transcribiendo, no arranca; mientras corre, las teclas de dictado se ignoran. Así nunca hay dos cosas tocando el portapapeles y la píldora a la vez.
- Errores nuevos en la píldora: `no_selection`, `ai_not_configured`, `ai_failed`.

## Límites conocidos

- Lo que había en el portapapeles se restaura si era texto o una imagen. Archivos copiados u otros formatos se pierden.
- Algunas apps copian la línea entera cuando no hay selección (VS Code, JetBrains): ahí la instrucción se aplica a esa línea.
- La terminal integrada de un editor no se distingue del editor: con el foco ahí y nada seleccionado, el Ctrl+C simulado llega a la terminal.
- Una app muy lenta (Excel con una selección enorme, escritorio remoto) puede contestar la copia después de los 450 ms: se toma como "sin selección".
- En Linux la selección no se toma sola (ver arriba): sigue siendo copiar a mano.
- Después de pegar el resultado, el portapapeles vuelve a lo que tenía solo si era texto: el paso de pegado (anterior a este cambio) no restaura imágenes.

## Validación

- Tests: `selection_from_copied_text`, la lista de terminales (`copy_would_interrupt`) y `build_edit_request`.
- Dos reviews independientes del diff.
  - Primera (9 hallazgos). Corregidos: Ctrl+C en terminales, imagen del portapapeles, transform superpuesto con un dictado, espera grabada por el micrófono, modificadores todavía apretados, error falso al soltar el modificador y copia tardía después de abandonar la espera.
  - Segunda, sobre las correcciones (7 hallazgos). Corregidos: en Linux la guarda de terminales no servía (ahora no se simula nunca); una tecla que no se pudo mandar se tomaba como "sin selección"; el flujo podía quedar reservado para siempre si el pedido de turno llegaba tarde; un transform sin tiempo límite dejaba las teclas muertas (ahora 30 s); y el turno se soltaba antes de que el pegado terminara.
  - Quedan como límite conocido los de la lista de arriba.
- `cargo check`, `cargo test` (87), chequeo de tipos del código de Windows contra el crate `windows`, build de Windows por CI.

## Para probar en Windows

1. Seleccionar un párrafo en Word o en el navegador, mantener la tecla de edición, decir "hacelo más corto", soltar: el párrafo se reemplaza y el portapapeles conserva lo que tenía antes.
2. Sin seleccionar nada, tecla de edición + "escribí un saludo para un cliente": se pega el saludo.
3. Seleccionar texto y apretar la tecla de "Polish": se reemplaza al soltar.
4. Tecla de transform sin selección: la píldora dice que no hay texto seleccionado.
5. Con una imagen copiada, repetir el paso 1: después se puede seguir pegando la imagen.
6. En Windows Terminal con un proceso corriendo, apretar una tecla de transform: el proceso NO se corta.

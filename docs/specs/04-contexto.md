# 04 · Contexto de la app

## Problema

La app solo sabía dónde se estaba escribiendo en Windows, solo miraba el nombre del proceso y solo lo usaba el atajo "auto". Un dictado en WhatsApp y uno en Outlook pasaban por el mismo pedido de limpieza, y el modelo no tenía forma de escribir bien el nombre de la persona con la que se está hablando aunque estuviera en el título de la ventana.

## Qué cambia

- **App y ventana.** `active_window::active_app()` devuelve `ActiveApp { process, title }`.
  - Windows: nombre del ejecutable + título de la ventana. Se lee con `QueryFullProcessImageNameW`: la review encontró que la llamada anterior (`GetModuleBaseName`) pide un permiso que el código no solicitaba, así que lo más probable es que la detección nunca haya funcionado en Windows. **Es lo primero a confirmar en la prueba manual.**
  - macOS (nuevo): nombre de la app que está al frente, con `lsappinfo` (viene con el sistema y no pide permisos). Sin título: eso necesita la API de Accesibilidad. Corre con un límite de 400 ms para que un `lsappinfo` colgado no frene las teclas.
  - Linux: nada.
- **El modelo recibe el contexto.** Todo dictado que pasa por la limpieza lleva una frase adelante del pedido: en qué app y en qué ventana se está escribiendo, con la instrucción de usarlo solo para el tono y los nombres propios. El título se aplana a una línea, sin comillas y cortado a 120 caracteres antes de entrar al pedido, porque lo escribe otro programa.
- **Se puede apagar.** Ajuste `context_awareness` (Ajustes → Avanzado → "Usar la app como contexto"), encendido por defecto. Apagado, ni el nombre de la app ni el título salen de la computadora.
- **El mapa de estilos por app** suma los nombres de macOS (Visual Studio Code, Xcode, Terminal, Mail, Messages).

## Qué NO entra (y por qué)

**El texto alrededor del cursor.** Wispr lo lee con las APIs de accesibilidad (UI Automation en Windows). Esas llamadas se cuelgan con apps que no responden y se comportan distinto en cada programa: hay que ajustarlas probando contra apps reales, y desde la nube no se puede. Queda como pendiente para hacer con una máquina Windows adelante. Lo que sí hay hoy: la app, la ventana y, en modo edición, el texto seleccionado.

## Validación

- 7 tests en `active_window.rs`: la frase de contexto con y sin título, el saneado del título, el nombre del proceso a partir de la ruta del ejecutable y el parseo de `lsappinfo`.
- El código de Windows se chequea contra el crate `windows` con el target `x86_64-pc-windows-msvc`.
- `cargo check`, `cargo test`, build de Windows y macOS por CI.

## Para probar en Windows

0. Dictar con el atajo "auto" en dos apps y mirar Insights → Por app: si aparecen los nombres, la detección funciona.
1. Con la limpieza activa, dictar en WhatsApp con un chat abierto y nombrar a la persona: el nombre sale escrito como en el título del chat.
2. Dictar lo mismo en Outlook y en WhatsApp con el atajo "auto": cambia el tono.
3. Apagar "Usar la app como contexto" y revisar en el log de depuración que el pedido ya no lleva la frase de contexto.

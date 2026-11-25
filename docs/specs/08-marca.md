# 08 · Marca Vento Voice, sistema de diseño y primera vez

## Problema

La app se llamaba Ezequielito, el ícono era un avatar personal, la bandeja mostraba la mano de Handy y en 18 idiomas seguía diciendo "Handy". El nombre, el logo y el ícono de Handy **no son de código abierto**: un fork tiene que usar su propia marca. Además la barra lateral imitaba el aspecto de Wispr Flow y había clases de color (`text-accent`, `bg-accent`) que no existían como token, así que no pintaban nada en 10 archivos.

## Qué cambia

- **Nombre:** Vento Voice en el instalador, la ventana, la bandeja, los pedidos a la IA y los 20 idiomas. El ejecutable es `vento-voice.exe`.
- **Logo e íconos:** el lockup de Vento (la V con el punto lima y el logotipo vectorizado) con el descriptor "VOICE" en la tipografía mono de la marca. El ícono de la app es el de Vento. En la bandeja, el punto marca el estado: lleno al grabar, hueco al transcribir.
- **Colores de Vento** (negro + lima + Pistacho): el lima es la acción y lo seleccionado; el Pistacho acompaña (manos libres bloqueado, avisos amables); los errores usan el color de estado. Se fue el naranja, que en Vento no existe.
- **Arreglos de interfaz que salieron de esto:** los interruptores encendidos casi no se distinguían (ahora son lima); los ítems de la barra lateral eran `div` con clic y no se podían usar con teclado (ahora son botones).
- **Primera vez:** una sola decisión en vez de un catálogo. Se muestra el modelo recomendado y el resto queda a un clic; el texto explica que el modelo corre en la compu y el audio no sale de ahí.
- **Acerca de:** se fue el botón de donar (iba a Handy), el link de código va a este repo y se suma el reconocimiento a Handy, aclarando que Vento Voice es un producto aparte.

## Lo que queda con el nombre viejo, a propósito

- **El identificador interno** (`com.lamas.ezequielito`): decide la carpeta de datos. Cambiarlo dejaría sin ajustes ni historial a quien ya usa la app.
- **Nombres internos que el usuario no ve:** el paquete de Rust (`handy`), el marcador del modo portable y los nombres de los archivos de audio del historial.
- **Las descargas de modelos** salen de `blob.handy.computer`, el servidor de Handy. Funciona, pero es una dependencia de un tercero: conviene mudarlas a un almacenamiento propio antes de repartir la app.

## Pendiente

- La instalación vieja ("Ezequielito") no se desinstala sola: al instalar Vento Voice quedan las dos. Los datos se comparten.
- Un paso guiado de "probá tu primer dictado" después de bajar el modelo.
- Los 18 idiomas que no son español ni inglés tienen en inglés los textos nuevos de estas brechas.

## Validación

- `tests/screens.spec.ts`: abre cada pantalla (Inicio, Insights, Diccionario, Snippets, Estilo, Transforms, Bloc, Ajustes) y la primera vez; verifica que ninguna diga "Ezequielito" ni "Handy" y que no haya errores de JavaScript. Guarda una captura de cada una.
- 60 tests de Playwright en total, lint, tipos, formato y traducciones completas en los 20 idiomas.
- Build de Windows y macOS por CI (confirma que el instalador y el ejecutable salen con el nombre nuevo).

## Para probar en Windows

1. Instalar: el programa aparece como "Vento Voice" con el ícono de Vento.
2. La bandeja muestra la V; al grabar, el punto se pone lima.
3. Recorrer las pantallas: nada dice Ezequielito ni Handy.

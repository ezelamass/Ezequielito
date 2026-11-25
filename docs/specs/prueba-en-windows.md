# Prueba manual en Windows

Lo que no se pudo probar desde la nube: micrófono, teclas globales, pegado en otras apps y cómo se siente. Todo lo demás (compilación, lógica, pantallas, la limpieza contra producción) ya está validado.

Tiempo estimado: 20 a 30 minutos. Si algo falla, anotá el número del paso.

## 0 · Instalar

1. Bajar el instalador de Windows del pre-release (o de los artefactos del workflow "Build Test").
2. Va a salir "Windows protegió su PC": **Más información → Ejecutar de todas formas**. Es esperado: falta la firma.
3. Se instala como **Vento Voice**. La instalación vieja (Ezequielito) queda aparte; se puede desinstalar. Ajustes e historial se conservan.

## 1 · Lo básico (SPEC 01 y 02)

4. La barrita aparece abajo al centro al abrir la app. Pasar el mouse: muestra la tecla.
5. Mantener la tecla, hablar, soltar: el texto se pega.
6. **Clic en la barrita** con el cursor en un campo de texto de otra app, hablar, tocar ✓: el texto se pega **en esa app** (si se pega en otro lado o no se pega, el clic le robó el foco: es el punto más incierto de todo).
7. Tocar ✕ mientras graba: se descarta.
8. Manos libres (activarlo en Ajustes → Avanzado y usar una tecla que no incluya Espacio): mantener, tocar Espacio, soltar, seguir hablando, tocar ✓.
9. Desenchufar el micrófono y dictar: la píldora muestra el error.

## 2 · Cuenta Vento (SPEC 07)

10. Inicio → iniciar sesión con la cuenta de Vento: dice "limpieza activa".
11. Dictar con muletillas y una autocorrección ("nos vemos el martes, no, perdón, el miércoles"): sale limpio y solo con "miércoles".
12. **Medir** el tiempo entre soltar la tecla y ver el texto (objetivo: cerca de 1 segundo).
13. Cortar internet y dictar: se pega el texto crudo a los pocos segundos, sin perderlo.

## 3 · Contexto y app (SPEC 04 y 05)

14. Dictar en dos apps distintas y abrir Insights → "Por app": aparecen las dos con su nombre. **Si no aparece ninguna, la detección de app no funciona en Windows** y hay que avisar (afecta el tono por app y el punto 16).
15. Dictar lo mismo en WhatsApp y en un mail: cambia el tono.

## 4 · Selección (SPEC 03)

16. Seleccionar un párrafo, mantener la tecla de edición, decir "hacelo más corto", soltar: se reemplaza. Pegar después con Ctrl+V: sale lo que había antes en el portapapeles.
17. Sin seleccionar nada, tecla de edición + "escribí un saludo para un cliente": se pega el saludo.
18. Seleccionar texto y tocar la tecla de "Polish": se reemplaza al soltar.
19. En Windows Terminal con algo corriendo, tocar una tecla de transform: el proceso **no** se corta.

## 5 · Diccionario (SPEC 06)

20. Dictar dos veces una frase con un nombre que salga mal: aparece en Diccionario → Sugerencias. Aceptarla.
21. Seleccionar un apellido en cualquier app y tocar la tecla de "agregar al diccionario": queda agregado y la píldora lo confirma.

## 6 · Marca (SPEC 08)

22. Bandeja: la V de Vento; el punto se pone lima al grabar.
23. Ninguna pantalla dice Ezequielito ni Handy.

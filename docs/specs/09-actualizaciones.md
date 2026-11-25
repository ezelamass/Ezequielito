# 09 · Aviso de versión nueva e instalador

## Problema

La pantalla de actualizaciones usaba el actualizador de Tauri, que en este fork no está inicializado: nunca podía funcionar. No había releases publicados, así que no existía un link para bajar la app.

## Qué cambia

- **Aviso de versión nueva.** La app consulta la lista pública de releases del repo, compara versiones y, si hay una más nueva, muestra "hay una versión nueva" con un botón que abre la página de descarga. Se respeta el ajuste "buscar actualizaciones".
- **Releases públicos.** El workflow `Release` publica un pre-release llamado "Vento Voice vX" con los instaladores de Windows (x64 y ARM), macOS y Linux. Antes creaba un borrador, que no tiene link público.
- **Instalador con la marca.** Nombre "Vento Voice", ícono de Vento, ejecutable `vento-voice.exe`.

## Completar un release al que le faltó una plataforma

GitHub cancela los builds de macOS cuando se queda sin runners ("The job was not acquired by Runner"): el 2026-11-25 pasó cuatro veces seguidas y la v0.2.1 salió sin instalador de Mac. Relanzar el workflow no servía, porque fallaba al crear un release que ya existía.

- El workflow `Release` **reusa el release si el tag ya existe** y le suma los instaladores.
- Tiene una opción `platforms` (`all`, `macos`, `windows`, `linux`). Para completar el de Mac: Actions → Release → Run workflow → `macos`.
- El build de Mac Intel corre en un runner Intel (`macos-26-intel`), que es otra cola que la de Apple Silicon, la que se agota. Antes los dos builds de Mac esperaban en la misma.

## Lo que NO es (todavía)

**No se instala sola.** Para que una app se reemplace a sí misma sin que nadie mire, cada actualización tiene que ir firmada con una clave propia, y el instalador de Windows tiene que estar firmado con un certificado para que el sistema no lo frene. Ninguna de las dos cosas existe hoy. Por eso es un aviso con link y no una auto-actualización.

### Para pasar a auto-actualización (cuando haya certificado)

1. Generar la clave de actualizaciones (la hace Ezequiel en su máquina; la clave privada no se comparte ni se commitea):

   ```bash
   bun tauri signer generate -w ~/.tauri/vento-voice.key
   ```

2. Cargar en GitHub → Settings → Secrets del repo: `TAURI_SIGNING_PRIVATE_KEY` (el contenido del archivo) y `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
3. Poner la clave **pública** en `src-tauri/tauri.conf.json` (`plugins.updater.pubkey` y `endpoints` apuntando a `…/releases/latest/download/latest.json`) y `bundle.createUpdaterArtifacts: true`.
4. Volver a inicializar `tauri-plugin-updater` en `lib.rs` y cambiar `UpdateChecker` para que descargue e instale.

## Firma de Windows: las opciones reales

Sin firma, Windows muestra "Windows protegió su PC" y hay que tocar "Más información → Ejecutar de todas formas". Buscado el 2026-11-25:

| Opción                                                                        | Costo                                       | Estado para una persona en Argentina                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Azure Artifact Signing** (antes Trusted Signing)                            | USD 9,99 por mes                            | Según respuestas de Microsoft de marzo de 2026, el alta de personas individuales está pausada y las organizaciones tienen que ser de EE. UU., Canadá, UE o Reino Unido. **Hay que confirmarlo en el portal de Azure antes de contar con esto.** |
| **Microsoft Store** (paquete MSIX)                                            | Gratis para cuentas individuales desde 2025 | La Store firma el paquete. Requiere empaquetar como MSIX (Tauri no lo hace solo) y pasar la revisión de la Store. Para instaladores EXE/MSI la Store **no** firma: pide que ya vengan firmados.                                                 |
| **Certificado de una entidad certificadora** (Sectigo, SSL.com, Certum, etc.) | Variable; se paga por año                   | Funciona desde cualquier país. Pide validar identidad y la clave vive en un token físico o en la nube del proveedor. No verifiqué precios actuales.                                                                                             |

Fuentes: [precios de Artifact Signing](https://azure.microsoft.com/en-us/pricing/details/trusted-signing/), [alta de individuos pausada](https://learn.microsoft.com/en-us/answers/questions/5810735/cant-create-a-new-trusted-signing-individual-ident), [registro gratis en la Store](https://blogs.windows.com/windowsdeveloper/2025/09/10/free-developer-registration-for-individual-developers-on-microsoft-store/), [opciones de firma](https://learn.microsoft.com/windows/apps/package-and-deploy/code-signing-options).

## Cómo

- `update_check.rs`: `check(version)` lee `api.github.com/repos/…/releases`, ignora borradores y tags que no son versiones, y devuelve la más nueva si supera a la que corre. 6 tests (incluido que 0.10 es mayor que 0.9).
- Comando `check_for_update`; `UpdateChecker.tsx` lo usa en vez del plugin.
- `.github/workflows/release.yml`: pre-release público con nombre de marca.

## Para probar en Windows

1. Instalar el pre-release desde la página de releases: aparece el aviso de SmartScreen (esperado, falta la firma) y la app se instala como "Vento Voice".
2. Con una versión más nueva publicada, abrir la app: aparece el aviso con el botón de descarga.

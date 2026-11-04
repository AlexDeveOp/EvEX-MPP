# EvEX-MPP

[English](README.md) | **Español**

Cliente XMPP (Jabber) de escritorio para Windows (y Linux, en pruebas), pensado para comunidades y alianzas de EVE Online que se coordinan por Jabber. Es una alternativa moderna y muy personalizable a Pidgin: salas con autounión, pings de flota en tarjetas, avisos emergentes siempre visibles, hora EVE y temas. La interfaz está en español e inglés.

[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/16208/badge)](https://www.bestpractices.dev/projects/16208) [![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/AlexDeveOp/EvEX-MPP/badge)](https://scorecard.dev/viewer/?uri=github.com/AlexDeveOp/EvEX-MPP) [![CI](https://github.com/AlexDeveOp/EvEX-MPP/actions/workflows/ci.yml/badge.svg)](https://github.com/AlexDeveOp/EvEX-MPP/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-green)](LICENSE) ![Electron](https://img.shields.io/badge/Electron-45-47848f) ![XMPP](https://img.shields.io/badge/XMPP-%40xmpp%2Fclient-blue) ![Windows](https://img.shields.io/badge/Windows-10%2F11-0078d6)

## Descargar e instalar

En [Releases](../../releases) hay dos ejecutables:

| Archivo | Para qué |
|---|---|
| `EvEX-MPP-Setup-<versión>.exe` | **Instalador.** Se instala solo para tu usuario, sin permisos de administrador. Deja elegir carpeta, crea accesos en el escritorio y en el menú Inicio, y se puede anclar a la barra de tareas. Se desinstala desde «Aplicaciones instaladas» y conserva tus datos. |
| `EvEX-MPP-<versión>-portable.exe` | **Portable.** No se instala. Guarda sus datos en `EvEX-MPP-datos`, junto al `.exe`, así que se puede llevar en un USB. |

Los ejecutables aún no están firmados, así que la primera vez avisará Windows SmartScreen. Antes de abrirlos puedes comprobar que son exactamente los que compiló GitHub a partir de este repositorio: lo explica [Cómo verificar la descarga](#cómo-verificar-la-descarga). En [CHANGELOG.md](CHANGELOG.md) están los cambios de cada versión.

### Linux

**En pruebas (beta)**, para x64 (en las versiones posteriores a la 0.6.0). Hay dos paquetes, compilados por GitHub Actions en Ubuntu:

| Archivo | Para qué |
|---|---|
| `EvEX-MPP-<versión>-x86_64.AppImage` | **AppImage.** No se instala: dale permiso de ejecución y ábrelo. Necesita FUSE 2: en Ubuntu 24.04 o posterior, `sudo apt install libfuse2t64`; en la 22.04, `sudo apt install libfuse2`. Sin él, ábrelo con `--appimage-extract-and-run`. |
| `evex-mpp_<versión>_amd64.deb` | **Paquete de Debian/Ubuntu.** Añade EvEX-MPP al menú de aplicaciones y el comando `evex-mpp`. Se desinstala con `sudo apt remove evex-mpp` y conserva tus datos de `~/.config/EvEX-MPP`. |

```bash
chmod +x EvEX-MPP-<versión>-x86_64.AppImage && ./EvEX-MPP-<versión>-x86_64.AppImage
# o bien
sudo apt install ./evex-mpp_<versión>_amd64.deb
```

Verifícalos antes, igual que los archivos de Windows (`sha256sum -c` y `gh attestation verify`; consulta [Cómo verificar la descarga](#cómo-verificar-la-descarga)). Tampoco están firmados: todavía no hay firma GPG ni repositorio de apt.

Qué necesita en Linux:

- **Un llavero** para guardar tus contraseñas cifradas: el de GNOME (`gnome-keyring`) o KWallet. GNOME y KDE ya traen uno; en otros escritorios, instálalo, o la contraseña no se podrá guardar cifrada.
- **Speech Dispatcher y una voz** para leer en voz alta los pings de flota: `sudo apt install speech-dispatcher espeak-ng`.
- **Avisos en Wayland:** un escritorio Wayland no deja que las apps coloquen sus ventanas ni las pongan por encima, así que allí EvEX-MPP muestra los avisos como notificaciones del sistema en vez de sus burbujas (en X11 las burbujas funcionan como en Windows). Si el escritorio no tiene servicio de notificaciones, vuelve a sus burbujas.
- **Icono de la bandeja:** GNOME solo lo muestra con la extensión *AppIndicator and KStatusNotifierItem Support* (Ubuntu ya la trae). KDE, Xfce y Cinnamon lo muestran sin más.

## Cómo verificar la descarga

*English: [How to verify your download](README.md#how-to-verify-your-download).*

Cada versión la compila GitHub Actions a partir de una etiqueta firmada de este repositorio ([release.yml](.github/workflows/release.yml)); nadie sube los ejecutables a mano. Cada versión incluye además `checksums.txt` y la atestación `EvEX-MPP-v<versión>.intoto.jsonl`. Descarga los ejecutables solo desde [Releases](../../releases) y usa cualquiera de estas comprobaciones (o las dos).

**1. Suma SHA-256.** Descarga `checksums.txt` de la misma versión, ponlo junto al `.exe` y ejecuta esto en PowerShell, en esa carpeta:

```powershell
$file = "EvEX-MPP-Setup-<versión>.exe"   # o EvEX-MPP-<versión>-portable.exe
$expected = ((Get-Content checksums.txt) -match [regex]::Escape($file) -split '\s+')[0]
if ((Get-FileHash $file -Algorithm SHA256).Hash -eq $expected) { "OK: la suma coincide" } else { "NO COINCIDE: no lo ejecutes" }
```

Si prefieres compararlo a ojo, `Get-FileHash <archivo> -Algorithm SHA256` muestra la suma, que debe ser igual a la línea de ese archivo en `checksums.txt`. En Linux (para el AppImage y el `.deb`), macOS o Git Bash, en la carpeta de las descargas: `sha256sum -c --ignore-missing checksums.txt`, que escribe `OK` para cada archivo que encuentra.

**2. Origen de la compilación (atestación de GitHub).** Con la [CLI de GitHub](https://cli.github.com/) instalada:

```powershell
gh attestation verify EvEX-MPP-Setup-<versión>.exe --repo AlexDeveOp/EvEX-MPP
```

Solo da el visto bueno si el archivo lo compiló un workflow de GitHub Actions de este repositorio, y además muestra la etiqueta y el commit de los que salió. Para exigir también que sea el workflow de las versiones, añade `--signer-workflow AlexDeveOp/EvEX-MPP/.github/workflows/release.yml`. Sin conexión a Internet, pásale el archivo de atestación de la versión: `--bundle EvEX-MPP-v<versión>.intoto.jsonl`. Un archivo modificado no pasa la comprobación. El mismo comando sirve en Linux y para todos los archivos de la versión, también el AppImage y el `.deb`.

**3. Windows SmartScreen.** La primera vez que abras el instalador o el portable, Windows puede mostrar *«Windows protegió su PC»*. Sale porque los ejecutables **aún no están firmados**: Windows no conoce al editor y los archivos todavía no tienen reputación de descargas. No significa que haya encontrado nada dañino. Si las comprobaciones anteriores salieron bien, pulsa **Más información** → **Ejecutar de todas formas**. Dejará de salir cuando las versiones estén firmadas; consulta la [política de firma de código](#política-de-firma-de-código-code-signing-policy). Linux no muestra ningún aviso parecido, pero sus paquetes tampoco están firmados, así que las comprobaciones anteriores sirven igual allí.

**4. VirusTotal.** Cada versión se analiza en [VirusTotal](https://www.virustotal.com/), y los informes se enlazan aquí y en las notas de la versión. Algunos antivirus a veces marcan por heurística los instaladores sin firmar; una suma y una atestación correctas indican que el archivo es el que compiló GitHub.

| Versión | Instalador | Portable |
|---|---|---|
| 0.6.0 | [0/67](https://www.virustotal.com/gui/file/73c6d029cd613e649813136a0f6f1f5deaadcc8e87250ef349b02fc042556cb4) | [1/65](https://www.virustotal.com/gui/file/1164e5e2f11ee938d31d706c0d848505102279aaf65477cbf4b2eace555c59a0) ¹ |

¹ McAfee marca el portable de la 0.6.0 con una detección genérica por reputación (`Ti!` seguido del principio del hash del archivo), habitual en ejecutables nuevos y sin firmar. Ningún otro antivirus lo marca, y el instalador, que contiene la misma app, sale limpio en los 67.

Para avisar de un fallo de seguridad, consulta [SECURITY.md](SECURITY.md) (en inglés).

## Primer uso

1. **Importar desde Pidgin** (recomendado). Copia la cuenta, el servidor de conexión (p. ej. `chat.ejemplo.com:5222`, con STARTTLS), las salas guardadas con su autounión, la contraseña (opcional) y todo el historial de Pidgin, sin duplicados.
2. O **Añadir cuenta**: dirección (`usuario@ejemplo.com`), contraseña y servidor. Si tu servidor se conecta por un nombre distinto del dominio, indícalo en «Servidor de conexión».

Para **cambiar de cuenta**, usa el menú de estado («Disponible ▾») o el icono de la bandeja → «Cambiar de cuenta…». La contraseña solo se guarda después de conectar con éxito.

Para **cambiar el idioma**, ve a Preferencias → Apariencia → Idioma. Las opciones son Automático (el de Windows), Español o English.

## Funciones

**Salas**
- ★ marca una sala como **favorita** y ⚡ hace que se **abra al conectar**. ⚡ implica ★, y quitar la ★ saca la sala de la lista (con «Deshacer»).
- Al conectar solo se entra en las salas con ⚡. Las salas abiertas que no son favoritas aparecen aparte, en «Abiertas ahora».
- Explorador de salas del servidor, con búsqueda, número de usuarios y detalles.
- Participantes agrupados por rol, apodo por sala, contraseña, invitaciones y moderación.
- La lista se sincroniza con los marcadores del servidor (XEP-0048). Si el servidor no permite guardarlos (algunos no lo permiten), la lista se guarda en tu PC y las salas que quites no vuelven.

**Pings de flota**
- Los mensajes de los remitentes de pings que configures (p. ej. un bot de broadcasts como `pingbot@ejemplo.com`) se muestran como **tarjetas**: FC, formup (con enlace a Dotlan), PAP, comms, doctrina, grupo y quién lo envió.
- Cada tarjeta lleva la hora local y la hora EVE.
- **La sirena de los pings nuevos late** el tiempo que elijas (de 5 minutos a 2 horas, contados desde que llega el ping) o hasta que abras la vista de pings y vuelvas a salir. También late la sirena de «Pings de flota» en la barra lateral, para verla desde cualquier conversación.
- **Lectura de los pings en voz alta** con las voces instaladas en Windows (sin conexión): voz, velocidad, tono, volumen, qué leer (resumen, título, el ping entero o una plantilla propia), solo algunos grupos y solo cuando no estás mirando la ventana.
- **Se recuperan los pings que llegaron con la app cerrada**: de los registros de Pidgin en el mismo PC y, si tu servidor guarda archivo de mensajes (XEP-0313), del servidor.
- Todo lo de los pings tiene su propia página de ajustes, a la que también se llega con el botón ⚙ de la vista «Pings de flota».

**Avisos**
- **Burbuja propia** que sube desde la barra de tareas (por defecto abajo a la izquierda) y queda **siempre encima**, también sobre EVE en ventana sin bordes. Los pings se quedan hasta que los cierras.
- Opcionalmente, la notificación de Windows en lugar de la burbuja, o ambas.
- **«!» ámbar parpadeando en la bandeja** mientras haya pings sin leer, y parpadeo de la barra de tareas.
- **Sonido distinto para cada tipo de aviso**: privado, mención, sala, mensaje enviado, ping, conexión perdida y recuperada, contactos que se conectan o desconectan, solicitudes de contacto e invitaciones a salas. 13 sonidos incluidos o un archivo tuyo, cada uno con su volumen, elección de la salida de audio (p. ej. los auriculares), repetición opcional del ping hasta que mires la ventana e **Importar sonidos de Pidgin** (se copian de tu Pidgin instalado).
- Todo funciona igual con la ventana **minimizada o escondida en la bandeja**.

**Mensajes**
- Hora local (gris) y **hora EVE/UTC** (ámbar) en cada mensaje; cualquiera de las dos se puede ocultar. Reloj EVE en la barra de título.
- Historial local con búsqueda y menciones con palabras clave.
- Corregir el último mensaje con ↑, citas y `/me`.
- Los comandos de Pidgin para XMPP, con sugerencias al escribir `/`: `/me`, `/say`, `/nick`, `/topic`, `/join`, `/part`, `/msg`, `/query`, `/invite`, `/kick`, `/ban`, `/unban`, `/role`, `/affiliate`, `/config`, `/ping`, `/buzz`, `/status`, `/away`, `/back`, `/clear` y `/help`. Autocompletado de apodos (Tab) y de `:emoji:`.
- **Editar el tema de la sala** desde la cabecera: sale una etiqueta *editar* cuando el servidor te deja cambiarlo (los moderadores siempre; los participantes, si la sala lo permite). Abre un cuadro con el tema actual para editarlo o pegar uno nuevo, con ✓ y ✕. Los propietarios abren la configuración de la sala desde el menú ⋮ o con `/config`.
- Recibos de entrega, «escribiendo…» y vistas previas de imágenes y YouTube.

**Personalización**
- Interfaz en **español e inglés**, con selector de idioma.
- 13 temas (Caldari, Amarr, Gallente, Minmatar, AMOLED, Nord, Dracula…), editor de cada color, y exportar/importar temas.
- Cualquier fuente de Windows, escala y densidad.
- 4 estilos de mensaje: moderno, burbujas, IRC y Pidgin.
- **GIFs**: botón *GIF* junto al de emojis. *Mis GIFs* guarda los GIFs que quieras (clic derecho → *Guardar en Mis GIFs*) y funciona sin ningún servicio; búsqueda opcional en GIPHY o KLIPY con tu propia clave gratuita.
- **Fondos** para la ventana, la barra lateral y cada sala o chat: una imagen de tu PC, pegada (Ctrl+V), arrastrada desde el Explorador o el navegador, o descargada de una dirección de Internet, con encaje (llenar, entera, estirar, mosaico, original), zoom, posición (arrastrándola en la vista previa), brillo, saturación, intensidad y desenfoque; o un degradado o un color.
- Emojis animados de Google (Noto), Twemoji o los nativos, y emojis propios. Los animados más usados y todas las banderas vienen con la app y funcionan sin conexión (Windows no sabe dibujar las banderas).

**Escritorio**
- Bandeja del sistema (cerrar o minimizar a la bandeja).
- Ausente automático, inicio con Windows y corrector ortográfico (es/en).

**Atajos de teclado**

| Atajo | Acción |
|---|---|
| `Ctrl+K` | Ir a sala o contacto |
| `Ctrl+Tab` | Siguiente pestaña |
| `Ctrl+W` | Cerrar pestaña |
| `Ctrl+J` | Unirse a sala |
| `Ctrl+B` | Explorar salas |
| `Ctrl+F` | Buscar en el historial |
| `Ctrl+,` | Preferencias |
| `Alt+1…9` | Ir a la pestaña N |
| `↑` | Corregir el último mensaje |

## Datos y seguridad

- Todo se guarda en `%APPDATA%\EvEX-MPP` (en la versión portable, junto al `.exe`): configuración, historial en JSONL, avatares y archivos propios.
- Las contraseñas se cifran con DPAPI de Windows (`safeStorage`), así que en otro PC se vuelven a pedir.
- La interfaz corre aislada (`contextIsolation`, `sandbox`, CSP estricta) y solo habla con el proceso principal por canales concretos.
- El ejecutable lleva desactivados los *fuses* `RunAsNode`, `NODE_OPTIONS` y los argumentos de inspección.
- Sin telemetría ni analíticas; solo busca actualizaciones si lo activas. A qué se conecta la app, y cómo desactivar cada conexión, está en la [política de privacidad](PRIVACY.md#política-de-privacidad).

**Commits firmados.** Todos los commits y etiquetas de versión de este repositorio están firmados con la clave SSH de firma del autor, y GitHub los muestra como **Verified** (verificados). La cuenta tiene activado el *modo vigilante* de GitHub: cualquier commit atribuido al autor que **no** esté firmado aparecería como **Unverified** (no verificado). Así una suplantación se detecta a simple vista: cualquiera puede poner el nombre y el correo de otra persona en un commit, pero nadie más puede firmar con su clave. Si alguna vez ves aquí un commit del autor marcado como Unverified, desconfía y avisa (consulta [SECURITY.md](SECURITY.md)).

Pidgin guarda las contraseñas **en texto plano** en `%APPDATA%\.purple\accounts.xml`. Si dejas de usarlo, conviene borrarlas de ahí.

Si usas Pidgin a la vez, los pings se entregan al cliente con **mayor prioridad**. Súbela en Cuentas → Conexión avanzada.

## Política de firma de código (Code signing policy)

**Los ejecutables aún no están firmados.** Solicitamos la firma de código gratuita que [SignPath Foundation](https://signpath.org) ofrece a proyectos de código abierto. La solicitud se denegó porque el proyecto todavía es nuevo y aún no tiene suficiente tracción pública (estrellas, forks, contribuidores y menciones externas); no fue un juicio sobre el código. La volveremos a solicitar cuando la app tenga más tracción y, mientras tanto, estamos explorando otras opciones, como la Microsoft Store. Hasta entonces, verifica la descarga como se explica en [Cómo verificar la descarga](#cómo-verificar-la-descarga).

Lo que ya se cumple en todas las versiones:

- Los ejecutables solo los compila GitHub Actions en sus propios servidores, a partir de una etiqueta de versión firmada de este repositorio ([release.yml](.github/workflows/release.yml)), y se publican con sumas SHA-256 y una atestación del origen de la compilación.
- Todo cambio llega a `main` mediante un pull request que tiene que pasar la CI (tests, ESLint, traducciones y auditoría de dependencias, en Windows y Linux). Los commits de `main` tienen que ir firmados, y `main` no se puede sobrescribir ni borrar. Los cambios de personas que no mantienen el proyecto se revisan antes de aceptarlos.
- Quienes mantienen el proyecto usan verificación en dos pasos en GitHub.

Cuando las versiones vayan firmadas (y para una futura solicitud), se aplicarán además estas reglas:

- **Autores, revisores y aprobadores (committers, reviewers and approvers):** [AlexDeveOp](https://github.com/AlexDeveOp).
- Solo se envían a firmar los ejecutables compilados como se explica arriba, y cada firma se aprueba a mano.
- También se usa verificación en dos pasos en el servicio de firma.
- Esta sección indicará qué versiones van firmadas y por quién.

**Privacidad:** el programa no envía ningún dato al desarrollador. Solo se conecta a los servidores XMPP que configures y a las fuentes de emojis, vistas previas y diccionarios del corrector que se indican en la [política de privacidad](PRIVACY.md#política-de-privacidad). Todas se pueden desactivar.

## Desarrollo

```
npm install
npm start          # lanza la app (scripts/start.mjs quita ELECTRON_RUN_AS_NODE, que VS Code define)
npm run dev        # con DevTools
npm run dist       # instalador + portable en dist/
npm run assets     # regenera iconos (Lucide) y datos de emojis (emojibase)
npm run assets:emoji  # regenera los emojis animados incluidos (los descarga de Google, ~15 min)
npm run assets:flags  # regenera las banderas incluidas (las descarga de Google, ~1 min)
npm test           # tests unitarios, de propiedades (fast-check) y de integración XMPP (contra el servidor simulado)
npm run lint       # ESLint
npm run check      # comprueba la sintaxis de todos los ficheros JavaScript
npm run i18n       # comprueba que todos los textos tienen traducción
npm run probe      # comprueba TLS y SASL de un servidor sin autenticarse
npm run mock       # servidor XMPP simulado en 127.0.0.1:5299 para pruebas
```

Estructura:

```
src/main/        Electron: ventanas, bandeja, burbujas (popups.js), IPC, XMPP (xmpp-account.js),
                 historial (logs.js), importador de Pidgin, almacenamiento y contraseñas (store.js)
src/preload.cjs  Puente IPC con lista de canales permitidos
src/renderer/    Interfaz en JS y CSS sin compilación (módulos ES)
src/renderer/locales/  Traducciones (el texto original del código está en español)
scripts/         Arranque, generación de iconos y recursos, comprobación de traducciones, prueba de conexión
test/            Servidor XMPP simulado, driver de DevTools y captura de escritorio
test/unit/       Tests automáticos (node:test); la CI los ejecuta en Windows y Linux
```

Las contribuciones son bienvenidas: consulta [CONTRIBUTING.md](CONTRIBUTING.md) (en inglés; también se aceptan issues y PR en español).

### Traducciones

Los textos se escriben en español dentro del código con `t("…")`. Cada idioma tiene un fichero en `src/renderer/locales/` (por ejemplo `en.js`) que asocia cada texto español con su traducción. Para añadir un idioma, copia `en.js` con el código del idioma (`fr.js`, `de.js`…), traduce los valores y regístralo en `src/renderer/js/i18n.js`. `npm run i18n` lista los textos que faltan.

### Probar sin una cuenta real

1. Ejecuta `npm run mock`.
2. Lanza la app con un perfil aislado: `set EVEX_USERDATA=C:\temp\perfil-pruebas` y luego `npm start`.
3. Añade la cuenta `tester@test.local`, contraseña `test`, servidor `127.0.0.1`, puerto `5299`, seguridad «TLS si está disponible».
4. Añade `pingbot` a los remitentes de pings para que el ping simulado salga como tal.

Variables de diagnóstico:
- `EVEX_DEBUG=1` muestra por consola la consola de la interfaz, los sonidos y el estado de la bandeja.
- `EVEX_SHOT=ruta.png` guarda una captura al arrancar.
- Con `--remote-debugging-port=9333`, `node test/cdp.mjs 9333 pasos.json` automatiza la interfaz.

## Licencia

MIT. Iconos: Lucide (ISC). Datos de emojis: emojibase (MIT). Fuentes: Fontsource (OFL). Emojis animados: [Animated Noto Emoji](https://googlefonts.github.io/noto-emoji-animation/) © Google, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), redimensionados. Banderas: [Noto Emoji](https://github.com/googlefonts/noto-emoji) © Google (Apache 2.0), redimensionadas. Detalles en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

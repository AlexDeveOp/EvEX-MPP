# Privacy policy

**English** | [Español](#política-de-privacidad)

EvEX-MPP has **no telemetry, analytics, advertising or crash reporting**, and it does not check for updates unless you turn that on. The developer receives no data from the app.

## What is stored, and where

Everything is stored only on your PC, in `%APPDATA%\EvEX-MPP` (portable version: in the `EvEX-MPP-datos` folder next to the `.exe`):

- **Accounts and settings**: `config.json`.
- **Passwords**: `secrets.json`, encrypted with Windows (DPAPI through Electron `safeStorage`), so only your Windows user can decrypt them.
- **Message history**: `logs\`, plain JSONL files.
- **Images and sounds you add** (backgrounds, custom emoji, sounds) and contacts' avatars: copies in `media\` (avatars in `media\avatars\`). *My GIFs* keeps only the links (earlier versions also kept a thumbnail in `media\gifs\`).

Uninstalling the app does not delete this folder, so your history is kept. Delete it by hand to remove all data.

## Network connections

The app connects to the following, and to nothing else:

| Connection | When | What the other side can see | How to turn it off |
|---|---|---|---|
| **Your XMPP server** (the one you configure in each account) | While the account is connected | What any XMPP client sends: your messages, presence, rooms, contacts and avatar. Contacts can ask your client name, version and operating system (XEP-0092), and see typing notifications and read receipts in private chats. | Disconnect the account. Turn off *Preferences → Behavior → Typing → Let others know when I am typing*. |
| **Google Fonts** (`fonts.gstatic.com`) | Only if you choose it: with the emoji style *Static Noto (Google)*, or with *Animated Noto* for emoji that don't come with the app when *Preferences → Emoji → Download animated emoji that don't come with the app* is on (off by default). The most used animated emoji are included in the app and never downloaded. | Your IP address and which emoji images are loaded | Turn that option off, or use *Native Windows (works offline)* |
| **jsDelivr** (`cdn.jsdelivr.net`) | Only with the emoji style *Twemoji* | Your IP address and which emoji images are loaded | Use another emoji style |
| **Websites linked in messages** and **YouTube thumbnails** (`i.ytimg.com`) | When a message contains a link to an image or a YouTube video and link previews are on (default) | Your IP address. No referrer is sent, so the site does not learn which conversation the link came from. | *Preferences → Messages → Content → Preview images and YouTube videos* |
| **Google** (Chromium spell-check dictionaries) | Once per language, the first time the spell checker is used | Your IP address and the dictionary language | *Preferences → Behavior → Typing → Spell checker* |
| **GitHub** (`api.github.com`) | Once a day, only if you turn on *Preferences → Accounts and data → Updates → Notify me when a new version is available* (off by default), or when you press *Check now* | Your IP address and that you use EvEX-MPP (it only reads the latest published version; nothing is downloaded or installed) | Leave that option off |
| **GIPHY** (`api.giphy.com`, `media*.giphy.com`) or **KLIPY** (`api.klipy.com`, `static.klipy.com`) | Only if you choose that GIF search service and enter your own key (*Preferences → Emoji → GIFs*; off by default), when you search in the GIF panel | Your IP address and what you search for; thumbnails load directly from their servers | Set *GIF search* to *None (My GIFs only)* |
| **The website of an image you save** | When you save a GIF to *My GIFs* (right-click → *Save to My GIFs*, or pasting its link: it is downloaded once to check that it is an image), **each time you open *My GIFs*** (the saved GIFs are shown from their websites; no copy is kept), or when you download a background from an Internet address (also when you drag an image from a browser: downloaded once, redrawn and saved as a new image) | Your IP address | Use images from your PC instead; don't keep GIFs in *My GIFs* |
| **Your web browser** | Only when you click a link (including the Dotlan map links on fleet pings) | Whatever any website sees | Don't click |

Images that other people send are loaded only through link previews (above) or your XMPP server.

## Importing from Pidgin

The Pidgin importer reads your local Pidgin profile (`%APPDATA%\.purple`). Nothing is uploaded: accounts, rooms and logs are copied into EvEX-MPP's own folder. Passwords are imported only if you tick that option, and are then encrypted as described above.

To recover fleet pings that arrived while EvEX-MPP was closed, the app also reads, at startup and every 2 minutes, **only the conversations with your ping senders** in those same local logs (*Preferences → Fleet pings → Recover them from Pidgin on this PC*, on by default). Nothing is sent anywhere. If your XMPP server keeps a message archive (XEP-0313), the app asks it for the messages of your ping senders from the last 7 days at most when connecting (*Ask the server for them when connecting*); that request goes only to your own server.

## Changes

Any change to this policy is listed in [CHANGELOG.md](CHANGELOG.md). Questions: [GitHub Issues](https://github.com/AlexDeveOp/EvEX-MPP/issues).

---

# Política de privacidad

[English](#privacy-policy) | **Español**

EvEX-MPP **no tiene telemetría, analíticas, publicidad ni informes de errores**, y no busca actualizaciones salvo que lo actives. El desarrollador no recibe ningún dato de la app.

## Qué se guarda y dónde

Todo se guarda solo en tu PC, en `%APPDATA%\EvEX-MPP` (versión portable: en la carpeta `EvEX-MPP-datos`, junto al `.exe`):

- **Cuentas y ajustes**: `config.json`.
- **Contraseñas**: `secrets.json`, cifradas con Windows (DPAPI mediante `safeStorage` de Electron); solo tu usuario de Windows puede descifrarlas.
- **Historial de mensajes**: `logs\`, ficheros JSONL de texto.
- **Imágenes y sonidos que añades** (fondos, emojis personalizados, sonidos) y avatares de los contactos: copias en `media\` (los avatares en `media\avatars\`). *Mis GIFs* guarda solo los enlaces (las versiones anteriores también guardaban una miniatura en `media\gifs\`).

Al desinstalar la app, esta carpeta no se borra, así que conservas el historial. Bórrala a mano para eliminar todos los datos.

## Conexiones de red

La app se conecta a lo siguiente, y a nada más:

| Conexión | Cuándo | Qué ve el otro lado | Cómo desactivarla |
|---|---|---|---|
| **Tu servidor XMPP** (el que configuras en cada cuenta) | Mientras la cuenta está conectada | Lo mismo que con cualquier cliente XMPP: tus mensajes, presencia, salas, contactos y avatar. Tus contactos pueden preguntar el nombre, la versión y el sistema operativo del cliente (XEP-0092) y ven los avisos de «escribiendo» y de lectura en los chats privados. | Desconecta la cuenta. Desactiva *Preferencias → Comportamiento → Escritura → Avisar de que estoy escribiendo*. |
| **Google Fonts** (`fonts.gstatic.com`) | Solo si lo eliges: con el estilo de emoji *Noto estáticos (Google)*, o con *Noto animados* para los emojis que no vienen con la app si activas *Preferencias → Emojis → Descargar de Internet los emojis animados que no vienen con la app* (desactivado por defecto). Los emojis animados más usados vienen con la app y nunca se descargan. | Tu IP y qué imágenes de emoji se cargan | Desactiva esa opción o usa *Nativos de Windows (sin conexión)* |
| **jsDelivr** (`cdn.jsdelivr.net`) | Solo con el estilo de emoji *Twemoji* | Tu IP y qué imágenes de emoji se cargan | Usa otro estilo de emoji |
| **Webs enlazadas en los mensajes** y **miniaturas de YouTube** (`i.ytimg.com`) | Cuando un mensaje enlaza una imagen o un vídeo de YouTube y la vista previa está activada (por defecto) | Tu IP. No se envía el *referer*, así que la web no sabe de qué conversación viene el enlace. | *Preferencias → Mensajes → Contenido → Vista previa de imágenes y vídeos de YouTube* |
| **Google** (diccionarios del corrector de Chromium) | Una vez por idioma, la primera vez que se usa el corrector | Tu IP y el idioma del diccionario | *Preferencias → Comportamiento → Escritura → Corrector ortográfico* |
| **GitHub** (`api.github.com`) | Una vez al día, solo si activas *Preferencias → Cuentas y datos → Actualizaciones → Avisar cuando haya una versión nueva* (desactivado por defecto), o al pulsar *Comprobar ahora* | Tu IP y que usas EvEX-MPP (solo lee la última versión publicada; no se descarga ni se instala nada) | Deja esa opción desactivada |
| **GIPHY** (`api.giphy.com`, `media*.giphy.com`) o **KLIPY** (`api.klipy.com`, `static.klipy.com`) | Solo si eliges ese buscador de GIFs y pones tu propia clave (*Preferencias → Emojis → GIFs*; desactivado por defecto), al buscar en el panel de GIFs | Tu IP y lo que buscas; las miniaturas se cargan directamente de sus servidores | Pon *Buscador de GIFs* en *Ninguno (solo Mis GIFs)* |
| **La web de una imagen que guardas** | Al guardar un GIF en *Mis GIFs* (clic derecho → *Guardar en Mis GIFs*, o pegando su enlace: se descarga una vez para comprobar que es una imagen), **cada vez que abres *Mis GIFs*** (los GIFs guardados se muestran desde su web; no se guarda copia) o al descargar un fondo desde una dirección de Internet (también al arrastrar una imagen desde el navegador: se descarga una vez, se vuelve a dibujar y se guarda como una imagen nueva) | Tu IP | Usar imágenes de tu PC; no guardar GIFs en *Mis GIFs* |
| **Tu navegador** | Solo cuando pulsas un enlace (incluidos los mapas de Dotlan de los pings) | Lo que ve cualquier web | No pulsarlo |

Las imágenes que envían otras personas solo se cargan mediante la vista previa (arriba) o tu servidor XMPP.

## Importar desde Pidgin

El importador lee tu perfil local de Pidgin (`%APPDATA%\.purple`). No se sube nada: las cuentas, salas y registros se copian a la carpeta de EvEX-MPP. Las contraseñas solo se importan si marcas esa opción, y se cifran como se explica arriba.

Para recuperar los pings de flota que llegaron con EvEX-MPP cerrado, la app también lee, al iniciar y cada 2 minutos, **solo las conversaciones con tus remitentes de pings** en esos mismos registros locales (*Preferencias → Pings de flota → Recuperarlos de Pidgin en este PC*, activado por defecto). No se envía nada a ningún sitio. Si tu servidor XMPP guarda archivo de mensajes (XEP-0313), al conectar la app le pide los mensajes de tus remitentes de pings de los últimos 7 días como mucho (*Pedirlos al servidor al conectar*); esa petición solo va a tu propio servidor.

## Cambios

Cualquier cambio de esta política se indica en [CHANGELOG.md](CHANGELOG.md). Preguntas: [GitHub Issues](https://github.com/AlexDeveOp/EvEX-MPP/issues).

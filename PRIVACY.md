# Privacy policy

**English** | [Español](#política-de-privacidad)

EvEX-MPP has **no telemetry, analytics, advertising, crash reporting or automatic update checks**. The developer receives no data from the app.

## What is stored, and where

Everything is stored only on your PC, in `%APPDATA%\EvEX-MPP` (portable version: in the `EvEX-MPP-datos` folder next to the `.exe`):

- **Accounts and settings**: `config.json`.
- **Passwords**: `secrets.json`, encrypted with Windows (DPAPI through Electron `safeStorage`), so only your Windows user can decrypt them.
- **Message history**: `logs\`, plain JSONL files.
- **Images and sounds you add** (backgrounds, custom emoji, sounds) and contacts' avatars: copies in `media\` (avatars in `media\avatars\`).

Uninstalling the app does not delete this folder, so your history is kept. Delete it by hand to remove all data.

## Network connections

The app connects to the following, and to nothing else:

| Connection | When | What the other side can see | How to turn it off |
|---|---|---|---|
| **Your XMPP server** (the one you configure in each account) | While the account is connected | What any XMPP client sends: your messages, presence, rooms, contacts and avatar. Contacts can ask your client name, version and operating system (XEP-0092), and see typing notifications and read receipts in private chats. | Disconnect the account. Turn off *Preferences → Behavior → Typing → Let others know when I am typing*. |
| **Google Fonts** (`fonts.gstatic.com`) | When an emoji is displayed with the default style *Animated Noto (Google)* or *Static Noto (Google)* | Your IP address and which emoji images are loaded | *Preferences → Emoji → Emoji artwork → Native Windows (works offline)* |
| **jsDelivr** (`cdn.jsdelivr.net`) | Only with the emoji style *Twemoji* | Your IP address and which emoji images are loaded | Use another emoji style |
| **Websites linked in messages** and **YouTube thumbnails** (`i.ytimg.com`) | When a message contains a link to an image or a YouTube video and link previews are on (default) | Your IP address. No referrer is sent, so the site does not learn which conversation the link came from. | *Preferences → Messages → Content → Preview images and YouTube videos* |
| **Google** (Chromium spell-check dictionaries) | Once per language, the first time the spell checker is used | Your IP address and the dictionary language | *Preferences → Behavior → Typing → Spell checker* |
| **Your web browser** | Only when you click a link (including the Dotlan map links on fleet pings) | Whatever any website sees | Don't click |

Images that other people send are loaded only through link previews (above) or your XMPP server.

## Importing from Pidgin

The Pidgin importer reads your local Pidgin profile (`%APPDATA%\.purple`). Nothing is uploaded: accounts, rooms and logs are copied into EvEX-MPP's own folder. Passwords are imported only if you tick that option, and are then encrypted as described above.

## Changes

Any change to this policy is listed in [CHANGELOG.md](CHANGELOG.md). Questions: [GitHub Issues](https://github.com/AlexDeveOp/EvEX-MPP/issues).

---

# Política de privacidad

[English](#privacy-policy) | **Español**

EvEX-MPP **no tiene telemetría, analíticas, publicidad, informes de errores ni comprobación automática de actualizaciones**. El desarrollador no recibe ningún dato de la app.

## Qué se guarda y dónde

Todo se guarda solo en tu PC, en `%APPDATA%\EvEX-MPP` (versión portable: en la carpeta `EvEX-MPP-datos`, junto al `.exe`):

- **Cuentas y ajustes**: `config.json`.
- **Contraseñas**: `secrets.json`, cifradas con Windows (DPAPI mediante `safeStorage` de Electron); solo tu usuario de Windows puede descifrarlas.
- **Historial de mensajes**: `logs\`, ficheros JSONL de texto.
- **Imágenes y sonidos que añades** (fondos, emojis personalizados, sonidos) y avatares de los contactos: copias en `media\` (los avatares en `media\avatars\`).

Al desinstalar la app, esta carpeta no se borra, así que conservas el historial. Bórrala a mano para eliminar todos los datos.

## Conexiones de red

La app se conecta a lo siguiente, y a nada más:

| Conexión | Cuándo | Qué ve el otro lado | Cómo desactivarla |
|---|---|---|---|
| **Tu servidor XMPP** (el que configuras en cada cuenta) | Mientras la cuenta está conectada | Lo mismo que con cualquier cliente XMPP: tus mensajes, presencia, salas, contactos y avatar. Tus contactos pueden preguntar el nombre, la versión y el sistema operativo del cliente (XEP-0092) y ven los avisos de «escribiendo» y de lectura en los chats privados. | Desconecta la cuenta. Desactiva *Preferencias → Comportamiento → Escritura → Avisar de que estoy escribiendo*. |
| **Google Fonts** (`fonts.gstatic.com`) | Al mostrar un emoji con el estilo por defecto *Noto animados (Google)* o con *Noto estáticos (Google)* | Tu IP y qué imágenes de emoji se cargan | *Preferencias → Emojis → Dibujo de los emojis → Nativos de Windows (sin conexión)* |
| **jsDelivr** (`cdn.jsdelivr.net`) | Solo con el estilo de emoji *Twemoji* | Tu IP y qué imágenes de emoji se cargan | Usa otro estilo de emoji |
| **Webs enlazadas en los mensajes** y **miniaturas de YouTube** (`i.ytimg.com`) | Cuando un mensaje enlaza una imagen o un vídeo de YouTube y la vista previa está activada (por defecto) | Tu IP. No se envía el *referer*, así que la web no sabe de qué conversación viene el enlace. | *Preferencias → Mensajes → Contenido → Vista previa de imágenes y vídeos de YouTube* |
| **Google** (diccionarios del corrector de Chromium) | Una vez por idioma, la primera vez que se usa el corrector | Tu IP y el idioma del diccionario | *Preferencias → Comportamiento → Escritura → Corrector ortográfico* |
| **Tu navegador** | Solo cuando pulsas un enlace (incluidos los mapas de Dotlan de los pings) | Lo que ve cualquier web | No pulsarlo |

Las imágenes que envían otras personas solo se cargan mediante la vista previa (arriba) o tu servidor XMPP.

## Importar desde Pidgin

El importador lee tu perfil local de Pidgin (`%APPDATA%\.purple`). No se sube nada: las cuentas, salas y registros se copian a la carpeta de EvEX-MPP. Las contraseñas solo se importan si marcas esa opción, y se cifran como se explica arriba.

## Cambios

Cualquier cambio de esta política se indica en [CHANGELOG.md](CHANGELOG.md). Preguntas: [GitHub Issues](https://github.com/AlexDeveOp/EvEX-MPP/issues).

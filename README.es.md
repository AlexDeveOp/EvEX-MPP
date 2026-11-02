# EvEX-MPP

[English](README.md) | **Español**

Cliente XMPP (Jabber) de escritorio para Windows, pensado para comunidades y alianzas de EVE Online que se coordinan por Jabber. Es una alternativa moderna y muy personalizable a Pidgin: salas con autounión, pings de flota en tarjetas, avisos emergentes siempre visibles, hora EVE y temas. La interfaz está en español e inglés.

[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/16208/badge)](https://www.bestpractices.dev/projects/16208) [![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/AlexDeveOp/EvEX-MPP/badge)](https://scorecard.dev/viewer/?uri=github.com/AlexDeveOp/EvEX-MPP) [![CI](https://github.com/AlexDeveOp/EvEX-MPP/actions/workflows/ci.yml/badge.svg)](https://github.com/AlexDeveOp/EvEX-MPP/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-green)](LICENSE) ![Electron](https://img.shields.io/badge/Electron-45-47848f) ![XMPP](https://img.shields.io/badge/XMPP-%40xmpp%2Fclient-blue) ![Windows](https://img.shields.io/badge/Windows-10%2F11-0078d6)

## Descargar e instalar

En [Releases](../../releases) hay dos ejecutables:

| Archivo | Para qué |
|---|---|
| `EvEX-MPP-Setup-<versión>.exe` | **Instalador.** Se instala solo para tu usuario, sin permisos de administrador. Deja elegir carpeta, crea accesos en el escritorio y en el menú Inicio, y se puede anclar a la barra de tareas. Se desinstala desde «Aplicaciones instaladas» y conserva tus datos. |
| `EvEX-MPP-<versión>-portable.exe` | **Portable.** No se instala. Guarda sus datos en `EvEX-MPP-datos`, junto al `.exe`, así que se puede llevar en un USB. |

Los ejecutables aún no están firmados, así que la primera vez Windows SmartScreen avisará: «Más información» → «Ejecutar de todas formas». Consulta la [política de firma de código](#política-de-firma-de-código-code-signing-policy).

**Verifica la descarga.** Las versiones las compila GitHub Actions a partir del código de la etiqueta e incluyen un archivo `checksums.txt` con el SHA-256 de cada ejecutable. Compáralo con `Get-FileHash <archivo> -Algorithm SHA256` en PowerShell. En [SECURITY.md](SECURITY.md) (en inglés) está el detalle y cómo avisar de un fallo de seguridad, y en [CHANGELOG.md](CHANGELOG.md) los cambios de cada versión.

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

**Avisos**
- **Burbuja propia** que sube desde la barra de tareas (por defecto abajo a la izquierda) y queda **siempre encima**, también sobre EVE en ventana sin bordes. Los pings se quedan hasta que los cierras.
- Opcionalmente, la notificación de Windows en lugar de la burbuja, o ambas.
- **«!» ámbar parpadeando en la bandeja** mientras haya pings sin leer, y parpadeo de la barra de tareas.
- **Sonido distinto para cada tipo** (privado, mención, sala, ping): 9 sonidos incluidos o un archivo tuyo, con volumen.
- Todo funciona igual con la ventana **minimizada o escondida en la bandeja**.

**Mensajes**
- Hora local (gris) y **hora EVE/UTC** (ámbar) en cada mensaje; cualquiera de las dos se puede ocultar. Reloj EVE en la barra de título.
- Historial local con búsqueda y menciones con palabras clave.
- Corregir el último mensaje con ↑, citas y `/me`.
- Comandos tipo IRC (`/help`) y autocompletado de apodos (Tab) y de `:emoji:`.
- Recibos de entrega, «escribiendo…» y vistas previas de imágenes y YouTube.

**Personalización**
- Interfaz en **español e inglés**, con selector de idioma.
- 13 temas (Caldari, Amarr, Gallente, Minmatar, AMOLED, Nord, Dracula…), editor de cada color, y exportar/importar temas.
- Cualquier fuente de Windows, escala y densidad.
- 4 estilos de mensaje: moderno, burbujas, IRC y Pidgin.
- Fondos (imagen, GIF o degradado) para la ventana, la barra lateral o cada conversación.
- Emojis animados de Google (Noto), Twemoji o los nativos, y emojis propios. Los animados más usados vienen con la app y funcionan sin conexión.

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

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org). (Firma de código gratuita de SignPath.io, con certificado de SignPath Foundation.) *La solicitud está enviada; las versiones todavía no van firmadas. Esta sección lo indicará cuando lo estén.*

- **Autores y revisores (committers and reviewers):** [AlexDeveOp](https://github.com/AlexDeveOp)
- **Aprobadores (approvers):** [AlexDeveOp](https://github.com/AlexDeveOp)
- Solo se envían a firmar los ejecutables que compila GitHub Actions en sus propios servidores a partir de una etiqueta de versión firmada de este repositorio ([release.yml](.github/workflows/release.yml)). Cada firma se aprueba a mano.
- Los cambios de personas que no son autores (pull requests) se revisan antes de aceptarlos. Los commits de `main` tienen que ir firmados, y `main` no se puede sobrescribir ni borrar.
- Todo el equipo usa verificación en dos pasos en GitHub y en SignPath.
- **Privacidad:** el programa no envía ningún dato al desarrollador. Solo se conecta a los servidores XMPP que configures y a las fuentes de emojis, vistas previas y diccionarios del corrector que se indican en la [política de privacidad](PRIVACY.md#política-de-privacidad). Todas se pueden desactivar.

## Desarrollo

```
npm install
npm start          # lanza la app (scripts/start.mjs quita ELECTRON_RUN_AS_NODE, que VS Code define)
npm run dev        # con DevTools
npm run dist       # instalador + portable en dist/
npm run assets     # regenera iconos (Lucide) y datos de emojis (emojibase)
npm run assets:emoji  # regenera los emojis animados incluidos (los descarga de Google, ~15 min)
npm test           # tests unitarios y de integración XMPP (contra el servidor simulado)
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

MIT. Iconos: Lucide (ISC). Datos de emojis: emojibase (MIT). Fuentes: Fontsource (OFL). Emojis animados: [Animated Noto Emoji](https://googlefonts.github.io/noto-emoji-animation/) © Google, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), redimensionados. Detalles en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

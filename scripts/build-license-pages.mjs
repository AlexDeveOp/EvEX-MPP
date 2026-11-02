// Genera build/license_es.txt y build/license_en.txt: la página que muestra el instalador antes de instalar
// (resumen de privacidad + licencia MIT). Mantener al día con PRIVACY.md. Uso: npm run license-pages
// Importante: UTF-8 SIN BOM. electron-builder añade el BOM al compilar; si ya lo llevan, NSIS muestra un carácter raro.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const license = fs.readFileSync(path.join(root, "LICENSE"), "utf8").replace(/^\uFEFF/, "").trim();

// Texto de cada idioma, hasta el título de la licencia (incluido).
const PAGES = {
  "en": "EvEX-MPP - privacy and license\n\nPRIVACY\nEvEX-MPP has no telemetry, analytics, advertising or crash reporting, and it does not check for updates unless you turn that on. The developer receives no data from the app. Your accounts, encrypted passwords and message history are stored only on this PC.\n\nThe app connects only to:\n- the XMPP servers you configure;\n- Google Fonts (fonts.gstatic.com), only if you choose the \"Static Noto\" emoji style or turn on \"Download animated emoji that don't come with the app\" (off by default). The most used animated emoji come with the app;\n- websites linked in messages and YouTube (i.ytimg.com) for image and video previews. Turn off: Preferences > Messages > Content > Preview images and YouTube videos;\n- Google, once per language, to download spell-check dictionaries. Turn off: Preferences > Behavior > Typing > Spell checker;\n- GitHub (api.github.com), once a day, only if you turn on \"Notify me when a new version is available\" (off by default);\n- GIPHY or KLIPY, only if you choose a GIF search service and enter your own key (off by default).\n\nFull policy: https://github.com/AlexDeveOp/EvEX-MPP/blob/main/PRIVACY.md\n\nTo uninstall, use Windows Settings > Apps > Installed apps > EvEX-MPP. Your data in %APPDATA%\\EvEX-MPP is kept; delete that folder to remove it.\n\nLICENSE\n",
  "es": "EvEX-MPP - privacidad y licencia\n\nPRIVACIDAD\nEvEX-MPP no tiene telemetría, analíticas, publicidad ni informes de errores, y no busca actualizaciones salvo que lo actives. El desarrollador no recibe ningún dato de la app. Tus cuentas, contraseñas cifradas e historial se guardan solo en este PC.\n\nLa app solo se conecta a:\n- los servidores XMPP que configures;\n- Google Fonts (fonts.gstatic.com), solo si eliges el estilo de emoji «Noto estáticos» o activas «Descargar de Internet los emojis animados que no vienen con la app» (desactivado por defecto). Los emojis animados más usados vienen con la app;\n- las webs enlazadas en los mensajes y YouTube (i.ytimg.com) para las vistas previas de imágenes y vídeos. Desactivar: Preferencias > Mensajes > Contenido > Vista previa de imágenes y vídeos de YouTube;\n- Google, una vez por idioma, para descargar los diccionarios del corrector. Desactivar: Preferencias > Comportamiento > Escritura > Corrector ortográfico;\n- GitHub (api.github.com), una vez al día, solo si activas «Avisar cuando haya una versión nueva» (desactivado por defecto);\n- GIPHY o KLIPY, solo si eliges un buscador de GIFs y pones tu propia clave (desactivado por defecto).\n\nPolítica completa: https://github.com/AlexDeveOp/EvEX-MPP/blob/main/PRIVACY.md#política-de-privacidad\n\nPara desinstalar: Configuración de Windows > Aplicaciones > Aplicaciones instaladas > EvEX-MPP. Tus datos de %APPDATA%\\EvEX-MPP se conservan; borra esa carpeta para eliminarlos.\n\nLICENCIA (MIT, en inglés)\n"
};

for (const [lang, text] of Object.entries(PAGES)) {
  const file = path.join(root, "build", `license_${lang}.txt`);
  fs.writeFileSync(file, (text + license + "\n").replace(/\n/g, "\r\n"));
  console.log(path.relative(root, file));
}

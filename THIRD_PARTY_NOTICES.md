# Third-party notices

EvEX-MPP itself is licensed under the [MIT License](LICENSE). It includes the following third-party components, under their own licenses.

## Included in the application

| Component | Use | License |
|---|---|---|
| [Electron](https://www.electronjs.org/) (includes Chromium and Node.js) | Application runtime | MIT; Chromium's and Node.js' notices are shipped as `LICENSES.chromium.html` and `LICENSE.electron.txt` next to the executable |
| [@xmpp/client](https://github.com/xmppjs/xmpp.js) | XMPP connection | ISC |
| [ltx](https://github.com/xmppjs/ltx) | XML parsing (Pidgin import) | MIT |
| [Inter](https://rsms.me/inter/), [JetBrains Mono](https://www.jetbrains.com/lp/mono/), [Nunito](https://github.com/googlefonts/nunito), [Orbitron](https://github.com/theleagueof/orbitron), [Rajdhani](https://github.com/itfoundry/rajdhani) via [Fontsource](https://fontsource.org/) | Interface fonts | SIL Open Font License 1.1 |
| [Lucide](https://lucide.dev/) icons (`src/renderer/js/data/icons.js`, generated from `lucide-static`) | Interface icons | ISC |
| [Emojibase](https://emojibase.dev/) data (`src/renderer/js/data/emoji.js`, generated from `emojibase-data`) | Emoji names and shortcodes | MIT |
| "Powered by GIPHY" attribution mark (`src/renderer/assets/gifs/`) | Shown in the GIF search panel when GIPHY is the chosen service, as GIPHY requires | GIPHY's official attribution mark, used as GIPHY instructs |
| **Animated Noto Emoji** by Google (`src/renderer/assets/emoji-anim/`) | The most used animated emoji, shown without an Internet connection | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode) |
| **Noto Emoji** flags by Google (`src/renderer/assets/emoji-flags/`) | Flag emoji, which have no animated version and which Windows shows as letters | [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0) (flag designs from [region-flags](https://github.com/behdad/region-flags), public domain) |

### Animated Noto Emoji attribution

The animated emoji in `src/renderer/assets/emoji-anim/` are from [Animated Noto Emoji](https://googlefonts.github.io/noto-emoji-animation/) © Google, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). **Changes:** resized from 512 px to 72 px and re-encoded as animated WebP by `scripts/build-anim-emoji.mjs`. Google does not endorse this project.

### Noto Emoji flags attribution

The flag emoji in `src/renderer/assets/emoji-flags/` are from [Noto Emoji](https://github.com/googlefonts/noto-emoji) © Google, licensed under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0); the flag designs come from [region-flags](https://github.com/behdad/region-flags) and are in the public domain. **Changes:** resized from 512 px to 72 px and re-encoded as WebP by `scripts/build-flag-emoji.mjs`.

## Loaded only when you choose them (not included)

These are loaded from the Internet only with the matching setting; see [PRIVACY.md](PRIVACY.md).

| Component | When | License |
|---|---|---|
| Animated Noto Emoji not included in the app | *Download animated emoji that don't come with the app* is on | CC BY 4.0 |
| [Noto Emoji](https://github.com/googlefonts/noto-emoji) (static) | Emoji style *Static Noto (Google)* | Apache 2.0 (images), OFL 1.1 (font) |
| [Twemoji](https://github.com/jdecked/twemoji) | Emoji style *Twemoji* | Graphics CC BY 4.0, code MIT |
| GIFs from [GIPHY](https://giphy.com/) or [KLIPY](https://klipy.com/) | GIF search with your own key; shown and sent as links, never stored by EvEX-MPP | Each service's terms |
| [Pidgin](https://pidgin.im/) sounds | Copied from **your own** Pidgin installation when you press *Import Pidgin sounds* (never distributed with EvEX-MPP) | GPL-2.0-or-later |

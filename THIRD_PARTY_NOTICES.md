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
| **Animated Noto Emoji** by Google (`src/renderer/assets/emoji-anim/`) | The most used animated emoji, shown without an Internet connection | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode) |

### Animated Noto Emoji attribution

The animated emoji in `src/renderer/assets/emoji-anim/` are from [Animated Noto Emoji](https://googlefonts.github.io/noto-emoji-animation/) © Google, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). **Changes:** resized from 512 px to 72 px and re-encoded as animated WebP by `scripts/build-anim-emoji.mjs`. Google does not endorse this project.

## Loaded only when you choose them (not included)

These are loaded from the Internet only with the matching setting; see [PRIVACY.md](PRIVACY.md).

| Component | When | License |
|---|---|---|
| Animated Noto Emoji not included in the app | *Download animated emoji that don't come with the app* is on | CC BY 4.0 |
| [Noto Emoji](https://github.com/googlefonts/noto-emoji) (static) | Emoji style *Static Noto (Google)* | Apache 2.0 (images), OFL 1.1 (font) |
| [Twemoji](https://github.com/jdecked/twemoji) | Emoji style *Twemoji* | Graphics CC BY 4.0, code MIT |
| [Pidgin](https://pidgin.im/) sounds | Copied from **your own** Pidgin installation when you press *Import Pidgin sounds* (never distributed with EvEX-MPP) | GPL-2.0-or-later |

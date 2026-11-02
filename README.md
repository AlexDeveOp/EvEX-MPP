# EvEX-MPP

**English** | [Español](README.es.md)

A Windows desktop XMPP (Jabber) client built for EVE Online communities and alliances that coordinate over Jabber. It is a modern, highly customizable alternative to Pidgin: rooms with auto-join, fleet pings shown as cards, always-on-top pop-up alerts, EVE time and themes. The interface is available in English and Spanish.

[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/AlexDeveOp/EvEX-MPP/badge)](https://scorecard.dev/viewer/?uri=github.com/AlexDeveOp/EvEX-MPP) [![CI](https://github.com/AlexDeveOp/EvEX-MPP/actions/workflows/ci.yml/badge.svg)](https://github.com/AlexDeveOp/EvEX-MPP/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-green)](LICENSE) ![Electron](https://img.shields.io/badge/Electron-45-47848f) ![XMPP](https://img.shields.io/badge/XMPP-%40xmpp%2Fclient-blue) ![Windows](https://img.shields.io/badge/Windows-10%2F11-0078d6)

## Download and install

[Releases](../../releases) contains two executables:

| File | What it is |
|---|---|
| `EvEX-MPP-Setup-<version>.exe` | **Installer.** Installs for your user only, no administrator rights needed. You can choose the folder; it creates desktop and Start menu shortcuts and can be pinned to the taskbar. Uninstall it from "Installed apps"; your data is kept. |
| `EvEX-MPP-<version>-portable.exe` | **Portable.** Nothing to install. It keeps its data in an `EvEX-MPP-datos` folder next to the `.exe`, so you can carry it on a USB stick. |

The executables are not code-signed yet, so the first time Windows SmartScreen will warn you: "More info" → "Run anyway".

**Verify your download.** Releases are built by GitHub Actions from the tagged source code and include a `checksums.txt` file with the SHA-256 of each executable. Compare it with `Get-FileHash <file> -Algorithm SHA256` in PowerShell. See [SECURITY.md](SECURITY.md) for details and for how to report a vulnerability, and [CHANGELOG.md](CHANGELOG.md) for what changed in each version.

## First steps

1. **Import from Pidgin** (recommended). Copies the account, the connection server (e.g. `chat.example.com:5222`, with STARTTLS), saved rooms with their auto-join setting, the password (optional) and your whole Pidgin history, without duplicates.
2. Or **Add account**: address (`user@example.com`), password and server. If your server is reached through a different host name than the domain, enter it in "Connection server".

To **switch accounts**, use the status menu ("Available ▾") or the tray icon → "Switch account…". The password is only saved after a successful connection.

To **change the language**, go to Preferences → Appearance → Language. The options are Automatic (follows Windows), Español or English.

## Features

**Rooms**
- ★ marks a room as a **favorite** and ⚡ makes it **open on connect**. ⚡ implies ★, and removing the ★ takes the room off the list (with "Undo").
- On connect, only ⚡ rooms are joined. Open rooms that are not favorites are listed separately under "Open now".
- Server room browser with search, user counts and details.
- Occupants grouped by role, per-room nickname, room passwords, invitations and moderation.
- The list is synced with server bookmarks (XEP-0048). If the server does not allow saving them (some don't), the list is kept on your PC and rooms you remove do not come back.

**Fleet pings**
- Messages from the ping senders you configure (e.g. a broadcast bot such as `pingbot@example.com`) are shown as **cards**: FC, formup (with a Dotlan link), PAP, comms, doctrine, target group and who sent it.
- Every card shows local time and EVE time.

**Alerts**
- **Custom pop-up bubble** that slides up from the taskbar (bottom-left by default) and stays **always on top**, including over EVE in borderless window mode. Pings stay until you close them.
- Optionally Windows notifications instead of the bubble, or both.
- **Blinking amber "!" in the tray** while there are unread pings, plus taskbar flashing.
- **A different sound for each kind of alert** (private message, mention, room, ping): 9 built-in sounds or your own file, with volume control.
- Everything works the same with the window **minimized or hidden in the tray**.

**Messages**
- Local time (grey) and **EVE/UTC time** (amber) on every message; either can be hidden. EVE clock in the title bar.
- Local history with search, and mentions with custom keywords.
- Correct your last message with ↑, quotes and `/me`.
- IRC-style commands (`/help`), and nickname (Tab) and `:emoji:` completion.
- Delivery receipts, "typing…" indicator, and image and YouTube previews.

**Customization**
- Interface in **English and Spanish**, with a language selector.
- 13 themes (Caldari, Amarr, Gallente, Minmatar, AMOLED, Nord, Dracula…), a per-color editor, and theme import/export.
- Any Windows font, UI scale and density.
- 4 message styles: modern, bubbles, IRC and Pidgin.
- Backgrounds (image, GIF or gradient) for the window, the sidebar or each conversation.
- Animated Google emoji (Noto), Twemoji or native emoji, plus custom emoji.

**Desktop**
- System tray (close or minimize to tray).
- Automatic away status, start with Windows, and spell checking (en/es).

**Keyboard shortcuts**

| Shortcut | Action |
|---|---|
| `Ctrl+K` | Go to room or contact |
| `Ctrl+Tab` | Next tab |
| `Ctrl+W` | Close tab |
| `Ctrl+J` | Join a room |
| `Ctrl+B` | Browse rooms |
| `Ctrl+F` | Search history |
| `Ctrl+,` | Preferences |
| `Alt+1…9` | Go to tab N |
| `↑` | Correct your last message |

## Data and security

- Everything is stored in `%APPDATA%\EvEX-MPP` (in the portable version, next to the `.exe`): settings, JSONL history, avatars and your own files.
- Passwords are encrypted with Windows DPAPI (`safeStorage`), so on another PC you will be asked for them again.
- The interface runs isolated (`contextIsolation`, `sandbox`, strict CSP) and only talks to the main process through a fixed set of channels.
- The executable ships with the `RunAsNode`, `NODE_OPTIONS` and inspector *fuses* disabled.

**Signed commits.** Every commit and release tag in this repository is signed with the maintainer’s SSH signing key, so GitHub shows them as **Verified**. The account has GitHub’s *vigilant mode* turned on: any commit attributed to the maintainer that is **not** signed would be marked **Unverified**, which makes impersonation easy to spot (anyone can put someone else’s name and email in a git commit, but nobody else can sign with their key). If you ever see an Unverified commit from the maintainer here, treat it as suspicious and report it (see [SECURITY.md](SECURITY.md)).

Pidgin stores passwords **in plain text** in `%APPDATA%\.purple\accounts.xml`. If you stop using it, it is a good idea to remove them from there.

If you run Pidgin at the same time, pings are delivered to the client with the **highest priority**. Raise it in Accounts → Advanced connection.

## Development

```
npm install
npm start          # runs the app (scripts/start.mjs clears ELECTRON_RUN_AS_NODE, which VS Code sets)
npm run dev        # with DevTools
npm run dist       # installer + portable in dist/
npm run assets     # regenerates icons (Lucide) and emoji data (emojibase)
npm run check      # syntax check of every JavaScript file
npm run i18n       # checks that every UI string has a translation
npm run probe      # checks a server's TLS and SASL without logging in
npm run mock       # fake XMPP server on 127.0.0.1:5299 for testing
```

Layout:

```
src/main/        Electron: windows, tray, pop-ups (popups.js), IPC, XMPP (xmpp-account.js),
                 history (logs.js), Pidgin importer, storage and passwords (store.js)
src/preload.cjs  IPC bridge with an allow-list of channels
src/renderer/    Interface in plain JS and CSS, no build step (ES modules)
src/renderer/locales/  Translations (the source strings in the code are Spanish)
scripts/         Launcher, icon and asset generation, translation check, connection probe
test/            Fake XMPP server, DevTools driver and desktop screenshot
```

### Translations

UI strings are written in Spanish in the code, wrapped in `t("…")`. Each language has a file in `src/renderer/locales/` (for example `en.js`) that maps every Spanish string to its translation. To add a language, copy `en.js` under the new language code (`fr.js`, `de.js`…), translate the values and register it in `src/renderer/js/i18n.js`. `npm run i18n` lists any missing strings.

### Testing without a real account

1. Run `npm run mock`.
2. Start the app with an isolated profile: `set EVEX_USERDATA=C:\temp\test-profile`, then `npm start`.
3. Add the account `tester@test.local`, password `test`, server `127.0.0.1`, port `5299`, security "TLS if available".
4. Add `pingbot` to the ping senders so the simulated ping is shown as one.

Diagnostic variables:
- `EVEX_DEBUG=1` prints the interface console, sounds and tray state to stdout.
- `EVEX_SHOT=path.png` saves a screenshot on startup.
- With `--remote-debugging-port=9333`, `node test/cdp.mjs 9333 steps.json` automates the interface.

## License

MIT. Icons: Lucide (ISC). Emoji data: emojibase (MIT). Fonts: Fontsource (OFL).

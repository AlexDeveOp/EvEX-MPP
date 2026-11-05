# EvEX-MPP

**English** | [Español](README.es.md)

A desktop XMPP (Jabber) client for Windows and Linux built for EVE Online communities and alliances that coordinate over Jabber. It is a modern, highly customizable alternative to Pidgin: rooms with auto-join, fleet pings shown as cards, always-on-top pop-up alerts, EVE time and themes. The interface is available in English and Spanish.

[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/16208/badge)](https://www.bestpractices.dev/projects/16208) [![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/AlexDeveOp/EvEX-MPP/badge)](https://scorecard.dev/viewer/?uri=github.com/AlexDeveOp/EvEX-MPP) [![CI](https://github.com/AlexDeveOp/EvEX-MPP/actions/workflows/ci.yml/badge.svg)](https://github.com/AlexDeveOp/EvEX-MPP/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-green)](LICENSE) ![Electron](https://img.shields.io/badge/Electron-45-47848f) ![XMPP](https://img.shields.io/badge/XMPP-%40xmpp%2Fclient-blue) ![Windows](https://img.shields.io/badge/Windows-10%2F11-0078d6) ![Linux](https://img.shields.io/badge/Linux-AppImage%20%7C%20.deb-fcc624)

## Download and install

[Releases](../../releases) contains two executables:

| File | What it is |
|---|---|
| `EvEX-MPP-Setup-<version>.exe` | **Installer.** Installs for your user only, no administrator rights needed. You can choose the folder; it creates desktop and Start menu shortcuts and can be pinned to the taskbar. Uninstall it from "Installed apps"; your data is kept. |
| `EvEX-MPP-<version>-portable.exe` | **Portable.** Nothing to install. It keeps its data in an `EvEX-MPP-datos` folder next to the `.exe`, so you can carry it on a USB stick. |

The executables are not code-signed yet, so Windows SmartScreen will warn you the first time. Before running them, you can check that they are exactly what GitHub built from this repository: see [How to verify your download](#how-to-verify-your-download). [CHANGELOG.md](CHANGELOG.md) lists what changed in each version.

### Linux

For x64, since 0.7.0. Two packages, built by GitHub Actions on Ubuntu:

| File | What it is |
|---|---|
| `EvEX-MPP-<version>-x86_64.AppImage` | **AppImage.** Nothing to install: make it executable and run it. It needs FUSE 2: on Ubuntu 24.04 or later `sudo apt install libfuse2t64`, on 22.04 `sudo apt install libfuse2`. Without it, run it with `--appimage-extract-and-run`. |
| `evex-mpp_<version>_amd64.deb` | **Debian/Ubuntu package.** Adds EvEX-MPP to the applications menu and the `evex-mpp` command. Uninstall it with `sudo apt remove evex-mpp`; your data in `~/.config/EvEX-MPP` is kept. |

```bash
chmod +x EvEX-MPP-<version>-x86_64.AppImage && ./EvEX-MPP-<version>-x86_64.AppImage
# or
sudo apt install ./evex-mpp_<version>_amd64.deb
```

Verify them first like the Windows files (`sha256sum -c` and `gh attestation verify`, see [How to verify your download](#how-to-verify-your-download)). They are not signed either: there is no GPG signature or apt repository yet.

What it needs on Linux:

- **A keyring** to store your passwords encrypted: GNOME Keyring (`gnome-keyring`) or KWallet. GNOME and KDE include one; on other desktops install it, or the password cannot be saved encrypted. With **automatic login**, the keyring stays locked because you never typed your password, so the first time EvEX-MPP needs it (right at startup if it starts with the system) the desktop asks you to unlock it: type your login password. It is how the desktop protects the keyring, not an EvEX-MPP error, and it does not happen if you log in with your password.
- **Speech Dispatcher and a voice** to read fleet pings aloud: `sudo apt install speech-dispatcher espeak-ng`.
- **Alerts on Wayland:** a Wayland desktop does not let apps place their own windows or keep them on top, so EvEX-MPP shows alerts as system notifications there instead of its own pop-ups (on X11 the pop-ups work as on Windows). If the desktop has no notification service, it falls back to its own pop-ups.
- **Tray icon:** GNOME shows it only with the *AppIndicator and KStatusNotifierItem Support* extension (included in Ubuntu). KDE, Xfce and Cinnamon show it out of the box.

## How to verify your download

*Español: [Cómo verificar la descarga](README.es.md#cómo-verificar-la-descarga).*

Every release is built by GitHub Actions from a signed tag of this repository ([release.yml](.github/workflows/release.yml)); nobody uploads executables by hand. Each release also includes `checksums.txt` and an `EvEX-MPP-v<version>.intoto.jsonl` attestation. Download the executables only from [Releases](../../releases), then use either check below (or both).

**1. SHA-256 checksum.** Download `checksums.txt` from the same release, put it next to the `.exe` and run this in PowerShell, in that folder:

```powershell
$file = "EvEX-MPP-Setup-<version>.exe"   # or EvEX-MPP-<version>-portable.exe
$expected = ((Get-Content checksums.txt) -match [regex]::Escape($file) -split '\s+')[0]
if ((Get-FileHash $file -Algorithm SHA256).Hash -eq $expected) { "OK: the checksum matches" } else { "DOES NOT MATCH: do not run it" }
```

To compare by eye instead, `Get-FileHash <file> -Algorithm SHA256` prints the hash, which must equal the line for that file in `checksums.txt`. On Linux (for the AppImage and the `.deb`), macOS or Git Bash, in the folder with the downloads: `sha256sum -c --ignore-missing checksums.txt`, which prints `OK` for each file it finds.

**2. Build provenance (GitHub attestation).** With the [GitHub CLI](https://cli.github.com/) installed:

```powershell
gh attestation verify EvEX-MPP-Setup-<version>.exe --repo AlexDeveOp/EvEX-MPP
```

It succeeds only if the file was built by a GitHub Actions workflow of this repository; it also shows the tag and commit it was built from. To also require the release workflow, add `--signer-workflow AlexDeveOp/EvEX-MPP/.github/workflows/release.yml`. Without an Internet connection, pass the attestation file from the release: `--bundle EvEX-MPP-v<version>.intoto.jsonl`. A modified file fails the check. The same command works on Linux and for every file of the release, including the AppImage and the `.deb`.

**3. Windows SmartScreen.** The first time you run the installer or the portable, Windows may show *"Windows protected your PC"*. It appears because the executables are **not code-signed yet**, so Windows does not know the publisher and the files have not built up download reputation. It does not mean that anything harmful was found. If the checks above passed, click **More info** → **Run anyway**. This will go away once releases are signed; see the [code signing policy](#code-signing-policy). Linux shows no such warning, but its packages are not signed either, so the checks above are just as useful there.

**4. VirusTotal.** Each release is scanned on [VirusTotal](https://www.virustotal.com/), and the reports are linked here and in the release notes. A few engines sometimes flag unsigned installers by heuristics; a clean checksum and attestation tell you the file is the one GitHub built.

| Version | Installer | Portable |
|---|---|---|
| 0.6.0 | [0/67](https://www.virustotal.com/gui/file/73c6d029cd613e649813136a0f6f1f5deaadcc8e87250ef349b02fc042556cb4) | [0/60](https://www.virustotal.com/gui/file/1164e5e2f11ee938d31d706c0d848505102279aaf65477cbf4b2eace555c59a0) ¹ |

¹ At first McAfee flagged the 0.6.0 portable (1/65) with a generic reputation detection (`Ti!` followed by the start of the file's hash), which is common for new, unsigned executables. It was reported to McAfee as a false positive and whitelisted on 2026-11-04; a new scan gives 0/60. If an engine flags a release, report it to that vendor as a false positive.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## First steps

1. **Import from Pidgin** (recommended). Copies the account, the connection server (e.g. `chat.example.com:5222`, with STARTTLS), saved rooms with their auto-join setting, the password (optional) and your whole Pidgin history, without duplicates.
2. Or **Add account**: address (`user@example.com`), password and server. If your server is reached through a different host name than the domain, enter it in "Connection server".

To **switch accounts**, use the status menu ("Available ▾") or the tray icon → "Switch account…". The password is only saved after a successful connection.

To **change the language**, go to Preferences → Appearance → Language. The options are Automatic (follows Windows), Español or English.

## Features

**Rooms**
- ★ marks a room as a **favorite** and ⚡ makes it **open on connect**. ⚡ implies ★, and removing the ★ takes the room off the list (with "Undo").
- On connect, only ⚡ rooms are joined. Open rooms that are not favorites are listed separately under "Open now".
- Server room browser with search, user counts and details, and room suggestions as you type a name in *Join a room*. Optionally it also finds the domain's other room servers (`muc.`, `chat.`…).
- Occupants grouped by role, per-room nickname, room passwords, invitations and moderation.
- The list is synced with server bookmarks (XEP-0048). If the server does not allow saving them (some don't), the list is kept on your PC and rooms you remove do not come back.

**Fleet pings**
- Messages from the ping senders you configure (e.g. a broadcast bot such as `pingbot@example.com`) are shown as **cards**: FC, formup (with a Dotlan link), PAP, comms, doctrine, target group and who sent it.
- Every card shows local time and EVE time.
- **The siren of new pings pulses** for the time you choose (5 minutes to 2 hours, counted from when the ping arrives) or until you open the pings view and leave it again. The *Fleet pings* siren in the sidebar pulses too, so you see it from any conversation.
- **Read pings aloud** with the voices installed in Windows (offline): voice, speed, pitch, volume, what to read (summary, title, whole ping or your own template), only some target groups, and only when you are not looking at the window.
- **SRP (ship replacement), optional:** flag the pings of the fleets where you lost a ship and see them together with the *Flagged* filter. For each one you can keep the killmail link, a note and the status (not requested yet, requested, paid, rejected; shown on the card as a yellow, purple, green or red bubble), see how long is left if your alliance has a deadline, and **copy everything ready to paste into the SRP form**. Turn it on in *Preferences → Fleet pings → SRP*; flags are stored only on your computer.
- **Pings that arrived while the app was closed are recovered** from Pidgin's logs on the same PC and, if your server keeps a message archive (XEP-0313), from the server.
- Everything about pings has its own settings page, also reachable from the ⚙ button in the *Fleet pings* view.

**Alerts**
- **Custom pop-up bubble** that slides up from the taskbar (bottom-left by default) and stays **always on top**, including over EVE in borderless window mode. Pings stay until you close them. With several monitors, choose where they appear: the main screen (default), where the mouse is, the screen with the EvEX-MPP window, or a specific monitor.
- Optionally Windows notifications instead of the bubble, or both.
- **Blinking amber "!" in the tray** while there are unread pings, plus taskbar flashing.
- **A different sound for each kind of alert**: private message, mention, room, message sent, ping, connection lost and restored, contacts coming online or going offline, contact requests and room invitations. 13 built-in sounds or your own file, each with its own volume, a choice of audio output (e.g. your headset), optional ping repeat until you look at the window, and **Import Pidgin sounds** (copied from your Pidgin installation).
- **Alerts per room and per chat**: *Everything*, *Only mentions and keywords* or *Nothing* (or the general setting), from the bell in the header, the ⋮ menu or a right-click in the sidebar. Rooms set to *Nothing* show a crossed-out bell and don't add to the unread counts.
- **Do not disturb**, by hand or **on a schedule** (e.g. 01:00–08:00 on chosen days), optionally letting mentions through. Toggle it from your status menu, the tray or the notice in the title bar. Fleet pings always get through.
- Everything works the same with the window **minimized or hidden in the tray**.

**Messages**
- Local time (grey) and **EVE/UTC time** (amber) on every message; either can be hidden. EVE clock in the title bar.
- Local history with search, and mentions with custom keywords.
- **Mentions inbox**: one view with the room messages that mention you or match your keywords, also from before you opened the app, with a filter by room and text. Click one to jump to that message in its room. It appears in the sidebar when there are unseen mentions (or always, if you prefer), and Ctrl+K opens it.
- Correct your last message with ↑, quotes and `/me`.
- Pidgin's XMPP commands, with suggestions as you type `/`: `/me`, `/say`, `/nick`, `/topic`, `/join`, `/part`, `/msg`, `/query`, `/invite`, `/kick`, `/ban`, `/unban`, `/role`, `/affiliate`, `/config`, `/ping`, `/buzz`, `/status`, `/away`, `/back`, `/clear` and `/help`. Nickname (Tab) and `:emoji:` completion.
- **Edit the room topic** from the header: an *edit* tag appears when the server lets you change it (moderators always, participants only when the room says it allows it; otherwise `/topic` still lets you try). It opens a box with the current topic to edit it or paste a new one, with ✓ and ✕. Room owners can open the room's settings from the ⋮ menu or with `/config`, including the lists of owners, admins, members and banned users. Right-click a participant to make them a moderator, member, admin or owner, as far as your own permissions allow.
- Delivery receipts, "typing…" indicator, and image and YouTube previews.

**Customization**
- **Your avatar**: click your circle (or *Preferences → Avatar*) to choose an image, frame it in a circle with drag and zoom, and publish it. Like Pidgin, it is scaled to 96×96 and compressed (under 8 KB, PNG or JPEG) because XMPP sends it inside your profile; animated images can stay animated as a GIF of up to 64 KB. It is published in your vCard (Pidgin and most clients) and with XEP-0084 (modern clients), and *Remove avatar* brings your initials back. Your contacts' avatars are read from both places too; the XEP-0084 one wins, and changes show up at once.
- Interface in **English and Spanish**, with a language selector.
- 13 themes (Caldari, Amarr, Gallente, Minmatar, AMOLED, Nord, Dracula…), a per-color editor, and theme import/export.
- Any Windows font, UI scale and density.
- 4 message styles: modern, bubbles, IRC and Pidgin.
- **GIFs**: a *GIF* button next to the emoji one. *My GIFs* keeps the GIFs you save (right-click → *Save to My GIFs*) and works without any service; optional search in GIPHY or KLIPY with your own free key.
- **Backgrounds** for the window, the sidebar and each room or chat: an image from your PC, pasted (Ctrl+V), dragged from File Explorer or a browser, or downloaded from an Internet address, with fit (fill, whole image, stretch, tile, original), zoom, position (drag it in the preview), brightness, saturation, intensity and blur; or a gradient or color.
- Animated Google emoji (Noto), Twemoji or native emoji, plus custom emoji. The most used animated emoji and all flags come with the app and work offline (Windows cannot draw flags).

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
- No telemetry or analytics; update checks only if you turn them on. What the app connects to, and how to turn each connection off, is listed in the [privacy policy](PRIVACY.md).

**Signed commits.** Every commit and release tag in this repository is signed with the maintainer’s SSH signing key, so GitHub shows them as **Verified**. The account has GitHub’s *vigilant mode* turned on: any commit attributed to the maintainer that is **not** signed would be marked **Unverified**, which makes impersonation easy to spot (anyone can put someone else’s name and email in a git commit, but nobody else can sign with their key). If you ever see an Unverified commit from the maintainer here, treat it as suspicious and report it (see [SECURITY.md](SECURITY.md)).

Pidgin stores passwords **in plain text** in `%APPDATA%\.purple\accounts.xml`. If you stop using it, it is a good idea to remove them from there.

If you run Pidgin at the same time, pings are delivered to the client with the **highest priority**. Raise it in Accounts → Advanced connection.

## Code signing policy

**Executables are not code-signed yet.** We applied to the [SignPath Foundation](https://signpath.org) program for free code signing for open-source projects. The application was declined because the project is still new and does not yet have enough public traction (stars, forks, contributors, external mentions); it was not a judgement on the code. We will reapply once the app has more traction, and meanwhile we are exploring other options, such as the Microsoft Store. Until then, please verify your download as described in [How to verify your download](#how-to-verify-your-download).

What already applies to every release:

- Executables are built only by GitHub Actions on GitHub-hosted runners, from a signed release tag of this repository ([release.yml](.github/workflows/release.yml)), and published with SHA-256 checksums and a build provenance attestation.
- Every change reaches `main` through a pull request that must pass the CI (tests, ESLint, translations and a dependency audit, on Windows and Linux). Commits on `main` must be signed, and `main` cannot be force-pushed or deleted. Changes from people who are not maintainers are reviewed before they are merged.
- Maintainers use multi-factor authentication on GitHub.

When releases are signed (and for a future application), these rules will also apply:

- **Committers, reviewers and approvers:** [AlexDeveOp](https://github.com/AlexDeveOp).
- Only the executables built as described above are submitted for signing, and every signing request is approved manually.
- Multi-factor authentication is also used on the signing service.
- This section will say which releases are signed and by whom.

**Privacy:** this program does not send any information to the developer. It connects only to the XMPP servers you configure, and to the emoji, link-preview and spell-check sources listed in the [privacy policy](PRIVACY.md). Each of them can be turned off.

## Development

```
npm install
npm start          # runs the app (scripts/start.mjs clears ELECTRON_RUN_AS_NODE, which VS Code sets)
npm run dev        # with DevTools
npm run dist       # installer + portable in dist/
npm run assets     # regenerates icons (Lucide) and emoji data (emojibase)
npm run assets:emoji  # regenerates the bundled animated emoji (downloads from Google, ~15 min)
npm run assets:flags  # regenerates the bundled flag emoji (downloads from Google, ~1 min)
npm test           # unit, property-based (fast-check) and XMPP integration tests (against the fake server)
npm run lint       # ESLint
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
test/unit/       Automated tests (node:test), run by CI on Windows and Linux
```

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).

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

MIT. Icons: Lucide (ISC). Emoji data: emojibase (MIT). Fonts: Fontsource (OFL). Animated emoji: [Animated Noto Emoji](https://googlefonts.github.io/noto-emoji-animation/) © Google, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), resized. Flag emoji: [Noto Emoji](https://github.com/googlefonts/noto-emoji) © Google (Apache 2.0), resized. Details in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

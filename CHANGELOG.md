# Changelog

All notable changes to EvEX-MPP are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Spanish summary / resumen en español: [README.es.md](README.es.md).

## [Unreleased]

## [0.7.0] - 2026-11-04

### Added
- **SRP (ship replacement) for fleet pings**, optional and off by default (*Preferences → Fleet pings → SRP*). Many alliances replace ships lost in their fleets if you paste the fleet ping and the killmail.
  - Flag any ping and see the flagged ones together with the *Flagged* filter in the *Fleet pings* view.
  - For each flagged ping, keep the killmail link, a note and the status (not requested yet, requested, paid, rejected). The status is shown on the card, next to the target group, as a colored bubble: yellow not requested, purple requested, green paid, red rejected.
  - An optional deadline in days shows how long is left to request it (also on the card), and marks it as expired.
  - *Copy for SRP* copies the ping, its EVE date and time, the killmail and the note, ready to paste; *Copy all* does it for every flagged ping.
  - Flags are stored only on this computer, never on the server.
- **Proxy support (SOCKS5, HTTP and HTTPS),** with optional username and password:
  - *Preferences → Network and proxy* sets a general proxy, used by accounts set to *Use the general proxy* (the default) and by all of the app's web traffic: update checks, GIF search, downloaded emoji, link previews and spell-check dictionaries.
  - Each account can use the general proxy, no proxy, or its own one (in the account's *Proxy* section).
  - The server name is resolved by the proxy, not on your computer, and the connection to the XMPP server is still encrypted end to end with TLS (STARTTLS or direct TLS).
  - An HTTPS proxy's certificate is checked against the public authorities and the ones installed on the system, so a company proxy with its own authority works; self-signed certificates are still rejected.
  - If the proxy fails or is incomplete, the app shows the error and never connects directly. A dropped proxy is retried until it comes back; a rejected proxy username stops retrying, like a wrong password.
  - *Test proxy* checks the proxy and, optionally, that the account's XMPP server can be reached through it.
  - Proxy passwords are encrypted like account passwords. Changing the proxy reconnects only the affected accounts.
  - On Linux without a keyring, proxy passwords are never written to disk: they are kept in memory until you close the app, and asked for when connecting (or at startup for the general proxy) if they are missing.
  - The app's web traffic goes through a local helper that only listens on this computer and requires a random password known only to the app, so other programs cannot use your proxy.
- **Linux packages (beta):** an AppImage and a `.deb` for x64, built by GitHub Actions on Ubuntu and published with the Windows files, in the same `checksums.txt` and build provenance attestation. The `.deb` adds a menu entry (Network / Instant Messaging) and the `evex-mpp` command, recommends a keyring and Speech Dispatcher, and sets `chrome-sandbox` permissions on install. The README explains how to install and verify them and what Linux needs (FUSE 2 for the AppImage, a keyring, Speech Dispatcher for read-aloud).
- **Alerts on Wayland:** Wayland does not let apps place their windows or keep them on top, so there EvEX-MPP shows alerts as system notifications instead of its own pop-ups (fleet pings stay until dismissed and close when you read the pings). With no notification service it falls back to its own pop-ups. Windows and X11 are unchanged.
- The CI also builds the Linux packages on every change, so a packaging problem shows up before a release.
- **Linux support in the app** (system integration):
  - *Read aloud* uses the system voices (speech-dispatcher, e.g. espeak-ng).
  - The font list shows the fonts installed on the system (fontconfig).
  - Pidgin import and Pidgin sounds look in `~/.purple` and `/usr/share/sounds/purple`.
  - *Start with the system* adds the app to `~/.config/autostart`.
- **Passwords are only saved when the system can really encrypt them.** On Linux they go to the desktop keyring (GNOME Keyring or KWallet). Without a keyring the account is saved without the password, which is asked for when connecting, instead of keeping it with Chromium's fixed, publicly known key.
- On desktops without a system tray, *close/minimize to tray* and *start minimized* minimize the window instead of hiding it, so it can always be opened again.
- **The *Fleet pings* siren in the sidebar pulses too** while there are new pings, with the same setting as the cards (*Preferences → Fleet pings → Visual alert*), so you notice them while you are in another conversation.
- **Finding rooms on the server is easier:**
  - The **+** next to *Favorite rooms* opens a menu with *Join by name…* (Ctrl+J) and *Browse server rooms…* (Ctrl+B), and the compass that opens the room browser stands out more.
  - While you type a room name in *Join a room*, the app suggests matching rooms from the server's room list (name or address). Use the arrow keys and Enter, or click, to pick one.
  - New option *Look for other room servers* (*Preferences → Behavior → Rooms*, also in the room browser): some servers keep rooms on `muc.`, `chat.` or other addresses besides `conference.`. With it on, the browser finds them, lists each server's rooms (or all of them together) and the suggestions include them too. IRC gateways and other services are left out. It is off by default.
- **Edit the room topic from the header.** An *edit* tag (or *add topic*) appears next to the topic when the server lets you change it: moderators always, participants when the room allows it. It opens a box under the header with the current topic, to edit it or paste a new one: Enter or ✓ accepts, Shift+Enter adds a line, Esc or ✕ cancels, and an empty topic removes it. The room's ⋮ menu also has *Change topic…*, *Copy topic* and *Room settings…*, greyed out with the reason when you can't use them. A rejected change now says you're not allowed, instead of "Couldn't deliver a message".
- **The rest of Pidgin's XMPP commands:** `/say`, `/topic -` (remove the topic), `/role`, `/affiliate`, `/unban`, `/ping` (who answers and how fast), `/buzz` (get someone's attention; incoming ones are shown and notified too) and `/config`, which opens the room's settings as the server provides them (owners only). Typing `/` suggests the commands that fit the conversation, and server errors from these commands are explained in plain words, in English and Spanish.
- **Room permissions without commands.** Right-clicking a participant offers *Make moderator*, *Make member*, *Make admin* and *Make owner* (and their opposites), only those your own permissions allow. *Room settings…* starts with a *Permissions* section listing the room's owners, admins, members and banned users, even those who aren't in the room, to add someone by address or remove them with ✕. You're told when your own permissions change ("You're now a moderator in this room").

### Changed
- **Direct TLS checks the account's domain:** with *Direct TLS*, the server certificate is now checked against the domain of your address, as STARTTLS already did, instead of the connection server name. This is what XEP-0368 expects, and it lets you connect through a different host name or a Tor `.onion` address.
- **Linux in the interface:**
  - Before saving a password, the app explains that Linux will ask you to create or unlock your keyring.
  - Without a keyring, the *Remember password* boxes are disabled with the reason, and the app explains why the password was not saved.
  - Windows-only options are hidden (taskbar flash), and texts that named Windows say "system".
  - Without a system tray, the tray options are disabled and say why.
  - *Read aloud* explains how to install speech-dispatcher and a voice when there are none. The voice list shows one espeak-ng voice per language instead of more than 13,000 variants.

### Fixed
- **Quitting could leave the app running without a window** when the accounts were already disconnected: the second quit request came too early and was ignored. This could also happen on Windows.
- **Linux: the tray icon could stay as "…".** On Ubuntu's GNOME (AppIndicator extension), the icon sometimes never loaded, mostly when the AppImage was still busy starting: the desktop asked for the icon a few milliseconds before the app had published it and never asked again. On Linux the app now recreates its tray icon a few seconds after starting, so the desktop reads it again.
- **Linux: the AppImage took about 35 s to open** on a virtual machine, because it was packed with the slowest compression (xz) and is unpacked on every start. It now uses faster compression: it opens in about 2 s and is 25 MB larger. The `.deb` and the Windows installer are unchanged.
- **Linux: the window did not open at startup.** On GNOME with Wayland the app often started with only its tray icon and no window, because Chromium does not always draw a hidden window and so never reported it ready to show. The window now opens as soon as the page has loaded. Starting hidden (start with the system, *Start minimized*) works as before.
- **Linux: clean exit on shutdown or reboot.** The app now takes the logind shutdown delay lock and quits before the desktop closes. Before, Ubuntu showed "EvEX-MPP has closed unexpectedly" after rebooting with the app open.
- **Reconnecting after losing the internet connection.** When the network dropped, the socket often stayed "open", so the app could keep showing an account as connected without receiving anything, or stay stuck on "connecting" after the network was back. It also tried only once at startup, so an account set to *Connect on startup* stayed disconnected if the PC started or woke up before the Wi-Fi.
  - Every 30 s the app pings the server. With no answer in 20 s, it treats the connection as dead and connects again.
  - A retry that stops making progress for 30 s is cut short and replaced by a new one.
  - Network errors when connecting are no longer final: the account keeps retrying in the background, waiting 1 s, then 2, 4… up to 30 s. A wrong password or a TLS problem still stops it.
  - When the network comes back, or the PC wakes from sleep, accounts retry right away.
- The siren on recent fleet ping cards pulses for the whole time chosen in *Preferences → Fleet pings* (5 minutes, 1 hour…) and stops right when it ends. Since 0.6.0 it stopped after about 11 seconds.
- The room browser button in the title bar opened the first account's rooms even when you were in another account's conversation. It now opens the current account's, like Ctrl+B.
- With *Until you open the pings again*, the sirens switch off as soon as you leave the pings view (before, they kept pulsing until the view was redrawn), and choosing that mode no longer makes every stored ping pulse at once.

## [0.6.0] - 2026-11-03

A big feature release (sounds, backgrounds, GIFs, keyword rules, recovered and spoken fleet pings, formup countdown) that is also much lighter. Measured on the same PC with the same test profile and mock server, before and after the performance work:

| | Before | 0.6.0 |
|---|---|---|
| CPU at idle | 47–70 % of a core | under 1 % |
| 600-person room with traffic: CPU | 113 % | 30 % |
| 600-person room with traffic: memory | 581 MB | 480 MB |
| 200 older messages arriving with 1,200 on screen | almost 2 minutes | about 50 ms |
| Page updates in 5 s with a busy room open | 15,389 | 694 |
| Startup | 642 ms | about 600 ms |
| Installer download | 142 MB | 125 MB |

### Added
- More alerts with sound: message sent, connection lost, connection restored, contact comes online or goes offline, contact request and room invitation. The new ones are off or discreet by default; contacts stay silent for the first seconds after connecting so the initial burst does not ring.
- Each sound has its own volume on top of the master volume, and you can choose the audio output device (e.g. your headset).
- Optional ping repeat: the ping sound repeats every N seconds (up to a maximum) until you look at the window.
- *Import Pidgin sounds*: copies the sounds of your installed Pidgin (your custom ones from `prefs.xml` if you set any) and lets you choose which alerts use them. Pidgin's files are never distributed with EvEX-MPP.
- Five new built-in sounds: Bubble, Radar, Warp jump, Signal lost and Signal restored.
- **Background images you can adjust**, for the window, the sidebar and each room or chat. Fit (fill, whole image, stretch, tile, original size), zoom up to 400 %, horizontal and vertical position, brightness and saturation, besides intensity and blur. The editor has an interactive preview: drag to move, wheel to zoom, double-click to center.
- **Import background images from outside the app**: choose a file, drag one from File Explorer or a browser, paste an image (Ctrl+V or *Paste image*), or download it from an Internet address. Images are always copied into the app's folder, and pasted data is checked to be a real image. The *Import an image* section is always visible in every background editor (Preferences → Backgrounds and the room's *Custom background…*), whatever the type.
- The background editor shows the types as buttons (*None*, *Gradient*, *Color*, *Image*), has an *Undo* button for the last 30 changes, and a *Your images* gallery to switch between imported images or remove them.
- *Preferences → Fleet pings → Visual cue*: choose how long the siren of recent pings pulses: never, 5/15/30 minutes, 1 hour (default, as before), 2 hours, or until you open the pings again (only pings that arrived since you last left the pings view).
- **GIFs**: a *GIF* button in the message box. *My GIFs* keeps the GIFs you save (right-click on an image → *Save to My GIFs*, or paste a link) with a local thumbnail, and works without any external service. Optional search in GIPHY or KLIPY with your own free key (off by default), shown as their terms require ("Powered by GIPHY", results unchanged and never stored). GIFs are sent as their link and as an XEP-0066 attachment, so other clients show the image.
- **Recover fleet pings that arrived while the app was closed.** Pings are private messages, and the server only delivers them to the clients connected at that moment: with EvEX-MPP closed and Pidgin open, only Pidgin got them. Now EvEX-MPP reads the conversations with your ping senders in Pidgin's logs on this PC (at startup and every 2 minutes) and, if your server keeps a message archive (XEP-0313), asks it for the missed pings when connecting. Recovered pings are added without duplicates, do not ring, and count as unread. Both can be turned off in *Preferences → Fleet pings*. The account page (*Advanced connection*) now shows whether the server keeps a message archive and sends copies between clients (XEP-0280).
- **Read fleet pings aloud** (*Preferences → Fleet pings → Read aloud*, off by default) with the voices installed in Windows, offline: choose the voice, speed, pitch and volume, what to read (a summary with title, FC, formup and doctrine, only the title, the whole ping or your own template with `{fc}`, `{formup}`, `{doctrine}`…), when (always or only when you are not looking at the window), whether also with *Do not disturb*, only some target groups, a delay after the ping sound and how many times. Links and the watermark characters are not read. A sample shows what would be read, *Try with a sample ping* plays it, and a stop button appears in the *Fleet pings* header while a ping is being read.
- **Keyword rules** (*Preferences → Notifications*): each rule has its words or phrases (whole word, anywhere inside a word, or regular expressions), where it applies (rooms, private messages, fleet pings) and what it does: *Always alert* (even in muted rooms), *Alert like a mention* or *Only highlight*. Messages and ping cards that match are highlighted in the rule's color, and its alert can have its own sound, keep the popup on screen until closed, and get through *Do not disturb*. The popup shows the rule's name and color. Rules can be reordered (the highest matching one wins), switched off, and tested with sample text. The existing *Keywords that count as a mention* list keeps working as before.
- **Formup countdown** (*Preferences → Fleet pings → Formup countdown*): when a ping gives a formup time in EVE time (fields like `Formup Time: 19:00`, or text like "formup at 19:30 EVE" or "undock in 20 min"), its card shows a live countdown ("Formup in 12:34", then "Formup now!"). An optional alert with its own sound comes 5, 10, 15 or 30 minutes before and/or at formup time, also in *Do not disturb*, and can stay on screen until closed. It also works for pings received before the app was opened, and alerts never come late after a restart. The footer time of the ping (when it was sent) is not taken as the formup. Each option can be switched off, and a test box shows which time is read from a pasted ping.

### Changed
- *Preferences → Fleet pings* is now the settings page for everything about pings, in sections: senders, alert and sound (ping sound, repeat, popup that stays), visual cue, read aloud, formup countdown, pings that arrived while the app was closed, and using Pidgin at the same time. The ⚙ button in the *Fleet pings* view opens it. The ping repeat settings moved there from *Notifications*.
- The refresh button in the *Fleet pings* header only redrew the pings already saved, which looked like it searched for new ones. It is now *Look for new pings*: it checks Pidgin's logs and the server archive right away and says what it found.
- The minimize, maximize and close buttons are now drawn by the app instead of Windows: they follow the theme, are translated, and the maximize button turns into *Restore* while the window is maximized. *Close* still sends the app to the tray when *Close to tray* is on.
- **Smaller download**: the installer goes from 142 to 125 MB and the portable version from 131 to 115 MB, and the portable version starts about half a second sooner. Only the Spanish and English language files of the built-in browser engine are included, the same two languages as the app.
- *Do not disturb* now also lets connection lost/restored sounds through, like fleet pings.
- Several alerts of the same kind arriving at once ring only once.
- Fleet ping alerts show the same siren as the pings inside the app instead of an exclamation mark, in white: in the popup, in the tray and taskbar icons (a filled siren that stays readable at 16 px) and in the Windows notification. In the popup, a light warning color (Nord, Dracula...) is darkened just enough for the white siren to be readable.
- The README (English and Spanish) has a *How to verify your download* section: a PowerShell command that checks the SHA-256 against `checksums.txt`, `gh attestation verify` (online or with the release's `.intoto.jsonl`), what the SmartScreen warning means and why it appears, and a place for each release's VirusTotal reports.
- The *Code signing policy* in the README (and SECURITY.md) now says plainly where code signing stands: the application to SignPath Foundation was declined because the project is still new and lacks public traction, not because of the code; we will reapply later and are exploring other options such as the Microsoft Store. Until then the executables are not signed. It separates what already applies to every release from the rules that will apply once releases are signed.

### Fixed
- **Busy rooms are much lighter on the interface.** A batch of older messages (room history after reconnecting, the server archive, recovered pings) redrew the whole room once per message and could freeze the window for minutes; 200 such messages with 1,200 on screen now take about 50 ms instead of almost two minutes. Times are formatted with cached formatters. Hidden tabs are only drawn when opened. The occupant list and the sidebar update only the rows that change (one status change in a 600-person room: 16 DOM changes instead of 824). At most 1,500 messages per conversation are kept on screen, and older ones come back when scrolling up. Pulsing indicators stop after a few beats instead of keeping the GPU busy at idle.
- Room messages "joined", "left", "has been kicked/banned" and the "new messages" button were not translated.
- Flag emoji were shown as two loose letters (ES, US…) on Windows, which cannot draw them, and they have no animated version. The app now includes the static Noto flags (262, about 460 KB) and uses them with every emoji style except Twemoji, which has its own, also with the *Native* style and without any Internet connection. England, Scotland and Wales flags are now recognized too.
- In the new background editor (not released before), a pasted image went to every open editor at once and could not be undone, and the import buttons only appeared with the *Image* type. Ctrl+V now goes only to the editor you clicked last, or the only one open ([#11](https://github.com/AlexDeveOp/EvEX-MPP/issues/11)).
- In the same editor, the × of an image in *Your images* did not remove it (images in use were put back in the list), and *Panel transparency* barely changed anything: it reached 60 % at most and could not be seen with Preferences open. The × now removes the image for good (and clears it from that background, which Undo brings back). The slider goes from opaque panels to fully transparent ones, and the preview shows example panels. Existing settings keep their look ([#12](https://github.com/AlexDeveOp/EvEX-MPP/issues/12)).
- Pidgin import read ambiguous dates the wrong way round: with a day/month Pidgin, 12/08 (12 August) became 8 December, so old messages appeared in the future and out of order. The date format is now detected from all the account's logs and dates in the future are never chosen ([#9](https://github.com/AlexDeveOp/EvEX-MPP/issues/9)).
- Pidgin import brought in Pidgin's own notices as messages (account disconnected, joined/left the room, nickname changes), hundreds of thousands in busy rooms. They are no longer imported; topic changes are kept and `/me` actions are imported as actions ([#10](https://github.com/AlexDeveOp/EvEX-MPP/issues/10)).
- *Preferences → Accounts and data → Repair history imported from Pidgin* fixes both problems in history imported with earlier versions, without importing again, after making a full backup of the history. If the app finds history imported with an earlier version that has not been repaired, it offers the repair once at startup (*Repair now* / *Not now*). When it finishes it lists what it did: messages with their date fixed, Pidgin notices removed, conversations changed and the backup folder, with a button to open the data folder.
- The siren of recent fleet pings kept pulsing after its hour had passed if the pings view stayed open: it was only checked when the view was drawn. Cards are now re-checked every 30 seconds while any siren is pulsing ([#8](https://github.com/AlexDeveOp/EvEX-MPP/issues/8)).
- The hover color of rows in the room/contact list and the occupant list sometimes flickered while moving the mouse. These lists are redrawn whenever someone joins, leaves or changes presence (several times per second in big rooms), and the new rows had no hover state until the mouse moved again. The row under the mouse now stays highlighted across redraws ([#7](https://github.com/AlexDeveOp/EvEX-MPP/issues/7)).
- The tab bar showed scroll bars. It now has a fixed height that fits the tabs exactly; when there are more tabs than fit, the mouse wheel scrolls them sideways and the active tab is always brought into view ([#5](https://github.com/AlexDeveOp/EvEX-MPP/issues/5)).
- Room rows in the sidebar jittered when hovered or clicked, and the member count flashed for an instant: the count was swapped for the star and bolt buttons, which have different widths. Now nothing changes size or intensity: the count always stays, the star of favorite rooms and the bolt of auto-join rooms are always visible, and the other buttons have reserved space and only appear while hovering the row ([#6](https://github.com/AlexDeveOp/EvEX-MPP/issues/6)).
- Room topics with several lines were shown in full, and hovering them shrank the header under the mouse so it flickered between both sizes. The topic is now collapsed to one line by default, with a button next to the star, bolt and bell to expand it (with its own scroll bar if long); the choice is remembered per room ([#4](https://github.com/AlexDeveOp/EvEX-MPP/issues/4)).
- The room header buttons stay at the top, level with the room name, instead of moving down when the topic is long.
- The whole window could shift up by about 30 px, hiding the title bar: the window could no longer be moved and Preferences could not be opened. The blurred background layers were slightly taller than the window, which made the page scrollable ([#3](https://github.com/AlexDeveOp/EvEX-MPP/issues/3)).
- The room invitation notice was not translated.
- Joining a room that never answers left it in *Joining…* forever. After 30 seconds it now says the room is not responding, with a *Retry* button, and it is tried again after a reconnection.
- Busy rooms are lighter: presence changes reach the window in small batches instead of one by one, and entering a room no longer sends every participant separately.
- Loading older messages, and the history kept for rooms, no longer reads the whole log file: it reads from the end only what is needed, so large histories (like those imported from Pidgin) open quickly. Searching the history no longer freezes the app while it reads.
- The blinking tray icon and the unread counter use less CPU, and the siren on a ping popup pulses a few times and then stays still instead of pulsing (and using the GPU) until the popup is closed.

## [0.5.0] - 2026-11-02

Privacy and offline release: the most used animated emoji come with the app, an optional new-version notice, and a privacy policy that lists every network connection.

### Added
- The 160 most used animated emoji (Animated Noto Emoji by Google, CC BY 4.0) come with the app: they work offline and are no longer requested from Google. Other emoji use the Windows style unless you turn on *Preferences → Emoji → Download animated emoji that don't come with the app* (off by default). The emoji picker no longer loads images from the Internet with the default style.
- Optional new-version notice: *Preferences → Accounts and data → Updates* (off by default) checks the latest GitHub release once a day and only notifies, with a link to the release page. *Check now* checks on demand.
- `THIRD_PARTY_NOTICES.md` with the licenses of the bundled components and the Animated Noto Emoji attribution.
- `npm run assets:emoji` (regenerates the bundled animated emoji) and `npm run license-pages` (regenerates the installer's privacy and license page).
- Privacy policy (`PRIVACY.md`, English and Spanish): what is stored, every network connection the app makes and how to turn each one off. A summary is shown by the installer before installing.
- "Code signing policy" section in the README, in preparation for code signing through SignPath Foundation.

### Changed
- Security fixes are now provided for 0.5.x only (`SECURITY.md`).
- `sharp` 0.35.5 (development only) for the emoji generator.

### Security
- The emoji generator only accepts hexadecimal codepoints as file names, and the update check strictly validates the repository name before querying GitHub (CodeQL).

## [0.4.2] - 2026-11-02

Maintenance release: bug fixes found by the new automated tests, plus fixes for CodeQL findings.

### Added
- Each release includes its provenance attestation as `EvEX-MPP-vX.Y.Z.intoto.jsonl` (also added to 0.4.1).
- Automated tests (`npm test`, Node's built-in test runner): ping parsing, message formatting and HTML escaping, translations, local history, Pidgin log import, and XMPP integration tests against the fake server (login, wrong password, required TLS, rooms, password-protected rooms).
- ESLint (`npm run lint`).
- CI runs syntax check, ESLint, tests, translation check and `npm audit` on Windows and Linux; releases run them too before building.
- `CONTRIBUTING.md`.
- OpenSSF Best Practices badge (passing level) in the README.
- `main` and release tags are protected: no deletion or force-push, and commits on `main` must be signed.

### Changed
- CodeQL runs from its own workflow (`codeql.yml`, security-extended queries for JavaScript and GitHub Actions) instead of GitHub's default setup.
- `SECURITY.md` links directly to the private report form and describes the disclosure timeline.

### Fixed
- Auto-join rooms were joined twice right after connecting; the second join could empty the occupant list (only you were shown). Found by the new integration tests ([#1](https://github.com/AlexDeveOp/EvEX-MPP/issues/1)).
- Pidgin HTML logs: the last message of each file no longer gets an extra empty line ([#2](https://github.com/AlexDeveOp/EvEX-MPP/issues/2)).
- Fleet pings: a field on the same line as a footer with invisible characters is no longer lost ([#2](https://github.com/AlexDeveOp/EvEX-MPP/issues/2)).
- Software version requests from other clients (XEP-0092) were answered with `0.1.0`; they now return the real app version.
- The fake XMPP server (`test/mock-xmpp.mjs`) closes the stream like a real server, and its port can be set with `MOCK_PORT`.

### Security
- Fixed the issues reported by CodeQL: history files are read through a single file handle, media files are copied without a check-then-write race, and the Pidgin log importer strips HTML tags until none are left (imported text was already escaped when shown).

## [0.4.1] - 2026-11-02

First release published from the public repository; the application itself is unchanged from 0.4.0.

### Added
- README (English and Spanish) explains commit signing and GitHub vigilant mode.
- Release files carry a signed build provenance attestation (`gh attestation verify`).
- OpenSSF Scorecard analysis (weekly and on every push to `main`) with its badge in the README.
- CodeQL code scanning, secret scanning with push protection and private vulnerability reporting.

### Changed
- The whole history is signed: every commit and release tag shows as Verified.
- GitHub Actions are pinned to full commit SHAs (Dependabot keeps them up to date).

### Fixed
- `checksums.txt` is written with LF line endings, so `sha256sum -c checksums.txt` works on Linux, macOS and Git Bash.

## [0.4.0] - 2026-11-02

### Added
- Interface available in **English and Spanish**, with a language selector in Preferences → Appearance (Automatic follows the Windows language).
- Translated tray menu, context menus, dialogs, connection errors, pop-up alerts, `/help` and date formats.
- Emoji names in both languages; the emoji search accepts either.
- `npm run i18n` checks for missing or unused translations.
- English README (`README.md`) with a Spanish version (`README.es.md`).
- `CHANGELOG.md` and `SECURITY.md`.
- Releases are built by GitHub Actions from the tagged source, with a `checksums.txt` (SHA-256) file and, on public repositories, a signed build provenance attestation.
- Dependabot configuration for npm packages and GitHub Actions.

### Changed
- Fatal connection errors (wrong password, missing TLS) are detected with an error flag instead of matching the message text.
- Interface files are served without the Chromium cache, so updates are always picked up.

## [0.3.0] - 2026-11-02

### Changed
- Fully generic code and documentation: no defaults tied to a specific server or community.
- The default list of fleet ping senders is now empty; configure your own in Preferences → Fleet pings.
- The gold theme is now called "Gold"; older theme ids are mapped automatically.

## [0.2.0] - 2026-11-02

### Added
- Account switching with saved accounts, and a form for a new account (address, password, server).
- Custom always-on-top pop-up alerts that slide up from the taskbar, configurable corner and duration; pings stay until closed.
- Amber "!" in the system tray (optionally blinking) while there are unread fleet pings.
- A different sound for each kind of alert, with built-in sounds or your own file.
- Local time and EVE (UTC) time on messages, ping cards and pop-ups, each one optional; EVE clock in the title bar.
- Minimize to tray option.
- NSIS installer and portable executable.

### Fixed
- Removing a room from favorites or auto-join now sticks and is pushed to server bookmarks; rooms removed locally no longer come back from old server bookmarks.
- Room header icons update immediately.
- Alerts and sounds keep working while the window is minimized or hidden in the tray.

## [0.1.0] - 2026-11-02

### Added
- First version: XMPP client built with Electron and `@xmpp/client`.
- Import of accounts, saved rooms, passwords and history from Pidgin.
- Favorite and auto-join rooms, server room browser, occupants by role, moderation.
- Fleet pings shown as cards with FC, formup (Dotlan link), PAP, comms and doctrine.
- Themes, color editor, fonts, backgrounds, message styles, animated emoji and custom emoji.
- Local history with search, mentions and keywords, message correction, IRC-style commands.

[Unreleased]: https://github.com/AlexDeveOp/EvEX-MPP/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/AlexDeveOp/EvEX-MPP/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/AlexDeveOp/EvEX-MPP/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/AlexDeveOp/EvEX-MPP/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/AlexDeveOp/EvEX-MPP/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/AlexDeveOp/EvEX-MPP/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/AlexDeveOp/EvEX-MPP/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/AlexDeveOp/EvEX-MPP/tree/v0.3.0
[0.2.0]: https://github.com/AlexDeveOp/EvEX-MPP/blob/main/CHANGELOG.md#020---2026-11-02
[0.1.0]: https://github.com/AlexDeveOp/EvEX-MPP/blob/main/CHANGELOG.md#010---2026-11-02

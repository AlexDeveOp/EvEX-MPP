# Changelog

All notable changes to EvEX-MPP are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Spanish summary / resumen en español: [README.es.md](README.es.md).

## [Unreleased]

### Added
- More alerts with sound: message sent, connection lost, connection restored, contact comes online or goes offline, contact request and room invitation. The new ones are off or discreet by default; contacts stay silent for the first seconds after connecting so the initial burst does not ring.
- Each sound has its own volume on top of the master volume, and you can choose the audio output device (e.g. your headset).
- Optional ping repeat: the ping sound repeats every N seconds (up to a maximum) until you look at the window.
- *Import Pidgin sounds*: copies the sounds of your installed Pidgin (your custom ones from `prefs.xml` if you set any) and lets you choose which alerts use them. Pidgin's files are never distributed with EvEX-MPP.
- Five new built-in sounds: Bubble, Radar, Warp jump, Signal lost and Signal restored.
- *Preferences → Fleet pings → Visual cue*: choose how long the siren of recent pings pulses: never, 5/15/30 minutes, 1 hour (default, as before), 2 hours, or until you open the pings again (only pings that arrived since you last left the pings view).
- **GIFs**: a *GIF* button in the message box. *My GIFs* keeps the GIFs you save (right-click on an image → *Save to My GIFs*, or paste a link) with a local thumbnail, and works without any external service. Optional search in GIPHY or KLIPY with your own free key (off by default), shown as their terms require ("Powered by GIPHY", results unchanged and never stored). GIFs are sent as their link and as an XEP-0066 attachment, so other clients show the image.

### Changed
- *Do not disturb* now also lets connection lost/restored sounds through, like fleet pings.
- Several alerts of the same kind arriving at once ring only once.

### Fixed
- The siren of recent fleet pings kept pulsing after its hour had passed if the pings view stayed open: it was only checked when the view was drawn. Cards are now re-checked every 30 seconds while any siren is pulsing ([#8](https://github.com/AlexDeveOp/EvEX-MPP/issues/8)).
- The hover color of rows in the room/contact list and the occupant list sometimes flickered while moving the mouse. These lists are redrawn whenever someone joins, leaves or changes presence (several times per second in big rooms), and the new rows had no hover state until the mouse moved again. The row under the mouse now stays highlighted across redraws ([#7](https://github.com/AlexDeveOp/EvEX-MPP/issues/7)).
- The tab bar showed scroll bars. It now has a fixed height that fits the tabs exactly; when there are more tabs than fit, the mouse wheel scrolls them sideways and the active tab is always brought into view ([#5](https://github.com/AlexDeveOp/EvEX-MPP/issues/5)).
- Room rows in the sidebar jittered when hovered or clicked, and the member count flashed for an instant: the count was swapped for the star and bolt buttons, which have different widths. Now nothing changes size or intensity: the count always stays, the star of favorite rooms and the bolt of auto-join rooms are always visible, and the other buttons have reserved space and only appear while hovering the row ([#6](https://github.com/AlexDeveOp/EvEX-MPP/issues/6)).
- Room topics with several lines were shown in full, and hovering them shrank the header under the mouse so it flickered between both sizes. The topic is now collapsed to one line by default, with a button next to the star, bolt and bell to expand it (with its own scroll bar if long); the choice is remembered per room ([#4](https://github.com/AlexDeveOp/EvEX-MPP/issues/4)).
- The room header buttons stay at the top, level with the room name, instead of moving down when the topic is long.
- The whole window could shift up by about 30 px, hiding the title bar: the window could no longer be moved and Preferences could not be opened. The blurred background layers were slightly taller than the window, which made the page scrollable ([#3](https://github.com/AlexDeveOp/EvEX-MPP/issues/3)).
- The room invitation notice was not translated.

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

[Unreleased]: https://github.com/AlexDeveOp/EvEX-MPP/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/AlexDeveOp/EvEX-MPP/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/AlexDeveOp/EvEX-MPP/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/AlexDeveOp/EvEX-MPP/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/AlexDeveOp/EvEX-MPP/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/AlexDeveOp/EvEX-MPP/tree/v0.3.0
[0.2.0]: https://github.com/AlexDeveOp/EvEX-MPP/blob/main/CHANGELOG.md#020---2026-11-02
[0.1.0]: https://github.com/AlexDeveOp/EvEX-MPP/blob/main/CHANGELOG.md#010---2026-11-02

# Changelog

All notable changes to EvEX-MPP are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Spanish summary / resumen en español: [README.es.md](README.es.md).

## [Unreleased]

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

[Unreleased]: https://github.com/AlexDeveOp/EvEX-MPP/compare/v0.4.2...HEAD
[0.4.2]: https://github.com/AlexDeveOp/EvEX-MPP/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/AlexDeveOp/EvEX-MPP/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/AlexDeveOp/EvEX-MPP/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/AlexDeveOp/EvEX-MPP/tree/v0.3.0
[0.2.0]: https://github.com/AlexDeveOp/EvEX-MPP/blob/main/CHANGELOG.md#020---2026-11-02
[0.1.0]: https://github.com/AlexDeveOp/EvEX-MPP/blob/main/CHANGELOG.md#010---2026-11-02

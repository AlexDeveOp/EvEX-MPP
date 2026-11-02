# Contributing to EvEX-MPP

Thanks for your interest! Issues and pull requests are welcome in **English or Spanish**.

## Reporting bugs and requesting features

- Open an issue on [GitHub Issues](https://github.com/AlexDeveOp/EvEX-MPP/issues). Include the version (Preferences → About, or the file name you downloaded), Windows version, what you did, what you expected and what happened.
- **Never** include passwords, real account names or chat logs. Use generic examples (`user@example.com`, `pingbot`).
- **Security problems must not be reported in public issues.** Follow [SECURITY.md](SECURITY.md) and use the private report form.

## Development setup

Requirements: Windows 10/11 (the app targets Windows; tests also run on Linux), Node.js 22 or later, Git.

```
git clone https://github.com/AlexDeveOp/EvEX-MPP.git
cd EvEX-MPP
npm ci
npm start
```

To try the app without a real account, use the fake XMPP server (`npm run mock`); see "Testing without a real account" in the [README](README.md#testing-without-a-real-account).

## Before sending a pull request

Every pull request is checked by CI on Windows and Linux. Run the same checks locally:

```
npm run check   # syntax
npm run lint    # ESLint, must report 0 problems
npm test        # unit and XMPP integration tests, all must pass
npm run i18n    # every UI string must have an English translation
```

Requirements for changes:

- **Tests**: new functionality, and every bug fix where it is practical, must come with automated tests in `test/unit/` (Node's built-in `node:test`). Integration tests can use the fake server in `test/mock-xmpp.mjs`.
- **Style**: follow the existing code: ES modules, no build step, no new runtime dependency unless it is really needed (discuss it in an issue first). ESLint enforces the basic rules.
- **Interface text**: strings shown to the user are written in Spanish inside `t("…")` and translated in `src/renderer/locales/en.js`. Run `npm run i18n` to find missing translations.
- **Security**: never insert untrusted text as HTML without escaping it (`esc()` / `formatBody()`); keep the preload IPC allow-list as small as possible; passwords only through `safeStorage`.
- **Changelog**: add a line under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md).
- **Commits**: small and focused, with a clear message. Signed commits are appreciated ([how to sign with SSH](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification#ssh-commit-signature-verification)); the maintainer signs every commit on `main`.

## Releases

Only the maintainer publishes releases: version bump in `package.json`, CHANGELOG section, signed tag `vX.Y.Z`. GitHub Actions builds the installer and portable from that tag and publishes them with `checksums.txt` and a signed build provenance attestation.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).

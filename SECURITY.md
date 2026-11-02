# Security Policy

## Supported versions

Only the latest release receives security fixes.

| Version | Supported |
|---|---|
| 0.4.x | ✅ |
| < 0.4 | ❌ |

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report it privately through GitHub: go to the **Security** tab of this repository → **Report a vulnerability**. Include the version, what you did, what happened and, if possible, how to reproduce it.

You should get a first answer within 7 days. Once a fix is released, the report is published as a security advisory and you are credited unless you prefer otherwise.

## Verifying a download

Every release is built by GitHub Actions from the tagged source code and includes a `checksums.txt` file.

1. Check the SHA-256 hash of the file you downloaded (PowerShell):
   ```powershell
   Get-FileHash .\EvEX-MPP-Setup-0.4.0.exe -Algorithm SHA256
   ```
   It must match the line for that file in `checksums.txt`.
2. When the repository is public, releases also carry a signed build provenance attestation. With the GitHub CLI:
   ```
   gh attestation verify EvEX-MPP-Setup-0.4.0.exe --repo AlexDeveOp/EvEX-MPP
   ```
   This proves the file was built by this repository's release workflow from a specific commit.

The executables are not code-signed yet, so Windows SmartScreen may warn the first time ("More info" → "Run anyway").

## How the app protects you

- **Passwords** are encrypted with Windows DPAPI (`safeStorage`) and never leave your PC in clear text except to authenticate with your XMPP server over TLS.
- **TLS is required** by default (STARTTLS or direct TLS); plain-text authentication is refused unless you explicitly choose the insecure mode.
- **Isolated interface**: `contextIsolation`, `sandbox`, no Node.js in the renderer, a strict Content Security Policy and an allow-list of IPC channels.
- **Hardened executable**: the `RunAsNode`, `NODE_OPTIONS` and inspector Electron fuses are disabled.
- **Links** open in your browser and only for `http(s)`, `mailto` and `xmpp` schemes; external images are loaded without cookies or referrer.
- **Local data** (settings, history, avatars) stays in `%APPDATA%\EvEX-MPP` (or next to the portable `.exe`). Nothing is sent to third parties; the only optional external requests are emoji images (Google Noto / Twemoji) and link previews, both of which can be turned off.

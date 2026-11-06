# Changelog

All notable changes to EvEX-MPP are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Spanish summary / resumen en español: [README.es.md](README.es.md).

## [Unreleased]

### Added
- **Capture mode** for sharing your screen or streaming (*Preferences → Privacy*, new tab; also from the tray, with `Ctrl+Shift+H`, or with the red "● Capture" pill next to the EVE clock, which shows while it is on).
  - Outside the window nothing about the operation is shown: popups and system notifications only say "New fleet ping" or "New message" (no title, fields, sender, room, account or time), the mini window only shows the counters, and pings are not read aloud.
  - In the window, ping cards, the fleet calendar, mentions, messages, link previews and the names of rooms, contacts and the account are blurred. A click reveals one; it blurs again after 10 s or when the mouse leaves. The first click on a ping or message only reveals it.
  - The original text is never changed or stored differently: it is only covered when drawn.
  - Optional global shortcut (`Ctrl+Shift+H`, off by default). On Linux/Wayland it goes through the GlobalShortcuts desktop portal; GNOME asks once to add it ("Add Keyboard Shortcuts") and it can be changed in Settings → Apps. As a fallback, `evex-mpp --toggle-capture` toggles the running app without showing it, to bind to a desktop shortcut.
- **Local history that expires** (*Preferences → Privacy → Local history*): room and chat messages, fleet pings and the fleet calendar can be deleted after 30, 90, 180 or 365 days. Messages and pings default to *Never*, so nothing is deleted unless you choose it; the calendar keeps its 90 days.
  - Before a shorter limit is saved, the app says how much will be deleted and asks for confirmation. It then prunes once at startup and once a day, only with limits you confirmed.
  - Pings have their own limit so they are not lost by accident, and pings flagged for SRP are kept while they have the flag. The mentions inbox follows its rooms.
  - What the server sends again from before the limit (room history, message archive) and pings recovered from Pidgin are not saved again. Pidgin's own logs are never touched.
  - Safe by design: with *Never* no file is even opened; lines the app does not understand are kept as they are; files are rewritten through a temporary file, so a failure leaves the original intact.
- **Delete an account with all its local data** (*Accounts → Delete with its data…*), confirmed by typing the account's address.
  - It disconnects the account first (no retries or timers left, and it cannot reconnect halfway), then deletes its history (also in the *Repair history* backups), its saved and proxy passwords, its settings (per-room alerts, backgrounds, open tabs), its SRP marks and calendar fleets, its lines in the connection log and its own avatar.
  - It keeps what other accounts still need: SRP marks and fleets from a ping another account also received, and contacts' avatars, which are shared. Pidgin's logs, files you saved and anything outside the app's data folder are never touched.
  - If a step fails, the app lists what could not be done and keeps the account in the list so you can try again.
  - It says plainly that this is a normal deletion, not a secure wipe.
- **Notice when the server rejects an account** (possible revoked access): when the password is rejected twice in a row, or at once when the server says the account is disabled or its credentials expired, the app offers *Change the password*, *Don't connect at startup* or *Delete the local data…*. It changes nothing on its own. Only login rejections count, never network errors; the count is kept between restarts and resets after a successful login or a new password.

### Changed
- **Ping text is shown exactly as received, invisible characters included.** Some alliances mark each copy of a ping with invisible characters; the ping card, the ping pop-up, the formup alert and the calendar's fleet details used to drop them when showing the text, which changed what you see and capture. Now they keep them (only normal spaces are trimmed), and *Copy for SRP* copies the ping as is too. They are still ignored internally to recognise fields, the footer and times, to search, to detect duplicates and to read pings aloud.
- **Link previews load only when you click them** (opsec). Image and YouTube previews used to load as soon as a message was shown, so the website hosting the image saw your IP; anyone could post an image in a room to learn it. *Preferences → Messages → Content → Preview images and YouTube videos* now offers *When clicked* (new default: a box with just the domain, nothing is requested until you click), *Always, when the message is shown* and *Never*. If you had previews turned off they stay off; everyone else moves to *When clicked* and sees a one-time notice explaining how to switch back.
- **Privacy policy: complete list of network connections.** [PRIVACY.md](PRIVACY.md) now also lists the proxy, says that the Microsoft Store version never checks GitHub, that avatars, rooms and other room servers go only through your own XMPP server, that no fonts or scripts are loaded from the Internet, that the alliance calendar link is never opened and that the .ics export only writes a local file. It also says plainly that only the passwords are encrypted. A new test fails if the code points to a web address that the policy does not list, in English and in Spanish.
- **You choose how long the formup alert and the ping alert stay on screen.** Both have the same option, *How long the alert stays*: *Until closed* (the default, as before), *Like messages* (the message alert duration), 10 s, 30 s, 1 min or 5 min. The formup one is in *Preferences → Fleet pings → Formup countdown*; the ping one in *Preferences → Fleet pings* and *Notifications*. Before, the formup alert could only stay until closed or last like messages, so it stayed on screen while playing. Your current choice is kept: the old "stays until closed" switches become *Until closed* or *Like messages*. Hovering over an alert still pauses it, and clicking closes it.

### Fixed
- **An account whose access is revoked while connected no longer retries forever.** If the server started answering "account disabled" or "credentials expired" after a dropped connection, the app kept reconnecting every few seconds and showed "Connecting…" without saying why. It now stops at the first rejection and shows the error.
- **Disconnecting no longer leaves a ping timer running.** If the account was disconnected while it was still finishing logging in (roster, presence), the keep-alive ping timer was created afterwards and never stopped. In the app it ran with nothing to do; in the tests it kept the process alive, which made the CI hang now and then after the reconnection tests.
- **Closing the app with the network down takes 3 s at most.** Saying goodbye to the server (the "unavailable" presence and closing the stream) now has a single 3 s limit; before, sending the presence could wait forever on a half-dead connection.
- **The mini window (and the pop-ups) could end up behind other windows** on Windows. Windows sometimes takes "always on top" away from a window (for example after resuming, unlocking or a display change), and another always-on-top window opened later stays above. They now put themselves back on top when that happens and, just in case, every 10 seconds while they are visible. This never takes the focus or flashes the taskbar, so it does not pull you out of a game.
- The "Invalid fleet time" error, and the two calendar export errors (invalid date, event without a UID), now follow the interface language instead of always showing in Spanish. They only appear with broken fleet data.

## [0.10.0] - 2026-11-05

### Added
- **Microsoft Store version** (MSIX), signed by Microsoft, so Windows trusts it without the SmartScreen warning. The GitHub installer and portable stay as they are. In the Store version:
  - the Store keeps the app up to date, so it doesn't check GitHub for new versions;
  - *Start with Windows* is turned on in Windows *Settings → Apps → Startup* (Preferences opens it); the app then starts in the tray;
  - *Open data folder* opens the package's own folder, where Windows keeps its data.
- `npm run dist:store` builds the package, and the release workflow keeps it as a workflow artifact for uploading to Partner Center.
- **About** tab in *Preferences*: version and where it was installed from (GitHub or Microsoft Store), who makes it, and links to the repository, the changelog, the user guide, bug reports and suggestions, private security reports, the privacy policy, the license and the third-party components. Links open in your browser.

### Changed
- **New app icon:** a cynosural beacon (a column of light with its ring) with the fleet arriving, instead of the generic chat bubble. The tray, the taskbar and other small sizes (48 px and below) show just the cyno, thicker, so it still reads at 16 px. The unread dot and the Do not disturb badge work as before, and the fleet ping siren is unchanged. The title bar shows the small one.
- **Fleet calendar times** read "17:15 EVE" on one line, in the time's font, with the local time below.

### Fixed
- The formup reminder stayed on screen until closed whenever fleet pings were set to stay, even with its own *The alert stays on screen until closed* option off. It now follows only its own option ([#78](https://github.com/AlexDeveOp/EvEX-MPP/issues/78)).

## [0.9.0] - 2026-11-05

### Added
- **Fleet calendar** in *Fleet pings*: a *List | Upcoming | Month* switch in the header.
  - *Upcoming* is an agenda by EVE day: EVE and local time, countdown, target group and *Show ping*, which jumps to the ping card. *Month* is a Monday-first grid with previous, next and today.
  - Fleets come from the pings' formup time. Times are read better: "tomorrow at 17:15", "tonight", weekdays ("friday 19:00"), "at downtime" (11:00 EVE) and dates. A ping at 21:33 EVE saying "Tomorrow at 17:15" is now the next day at 17:15. A number without context is never taken as a time.
  - Pings of the same op (within 15 min, with the same calendar link or a similar title, to the same group) are one fleet.
  - A link to an alliance calendar or event in the ping is stored and can be copied, but the app never opens or fetches it.
  - Suggested fleets (dashed purple) are accepted or dismissed; a dismissed suggestion doesn't come back.
  - The formup reminders now cover every active calendar fleet, including ones added by hand, with the same alert ids as before.
  - The mini window lists the next three fleets.
  - Everything is stored locally (`settings.fleets`) and anything older than 90 days is pruned.
  - Developer API in `src/renderer/js/fleets.js` and `fleet-time.js`, with hooks for header and per-fleet actions in `fleet-view.js`.
- **Fleet calendar: add fleets yourself and suggested fleets.**
  - *＋ Add fleet* in the calendar header: EVE date and time (with your local time next to it), title, group and note. Every fleet you added, or that came from a message, has *Edit* (and *Delete* inside).
  - Right-click a room message or a ping card → *Add to calendar*, filled in with the time found in the text, the first line as the title and, for a ping, its target group. A ping that is already in the calendar says *Edit in the calendar* instead.
  - **Suggested fleets:** when a room message talks about a fleet (fleet, op, CTA, formup, roam, timer…) and gives a time in the next two weeks, such as "big op tomorrow at 21:00", it appears in the calendar as a suggestion (dashed purple) with *Add* and *Dismiss*. Suggestions are never added on their own, a dismissed one does not come back, and adding that message by hand accepts the suggestion instead of creating a second fleet. They also come from the saved history of active rooms when the app starts.
  - Each suggestion (and each fleet added from a room message) says where it comes from: "# room · author", with the room's current name, and *View message* opens that message in its room.
  - Fleets already in the calendar are not suggested again: no suggestion if there is an active fleet (from a ping, added by hand or accepted) within 30 minutes of that time, unless the message names a different group (caps, subcaps, supers, all…), which means another op at the same time. A pending suggestion is withdrawn on its own when such a fleet appears later (for example, when the ping arrives), and it does not come back.
  - A small calendar button in the footer of every ping card, next to *Copy*: *Add to calendar*, or *In the calendar: edit* when the ping is already a calendar fleet. It updates when the calendar changes.
- **Export fleets to a calendar (.ics)** for Outlook, Google Calendar or the Windows calendar, from the fleet calendar view: *Export .ics* in the header saves all upcoming active fleets, and *.ics* on each active fleet saves that one.
  - The file goes where you choose in the Save dialog and is never sent anywhere. The main process checks it is a calendar of at most 1 MB and cleans up the suggested name.
  - By default it only contains "Fleet", the group and the time (UTC), because an imported calendar may sync to Outlook or Google servers. *Preferences → Fleet pings → Calendar export* can add the title, FC, formup, doctrine and note (with a privacy warning), the fleet link and a reminder (15, 30 or 60 minutes before).
  - Text from the pings goes as is, invisible characters included, so a leaked calendar keeps any watermark.
  - RFC 5545: escaped text, lines folded at 75 octets, CRLF and stable UIDs, so exporting again updates the events instead of duplicating them.
- **Mini window for gaming** (*Preferences → Fleet pings → Mini window for gaming*, the tray menu or the button in the pings view). A small always-on-top window, also over EVE in borderless mode:
  - Shows the latest ping (title and target group only, never the whole text), the countdown to the next formup and the unread pings, mentions and messages. Clicking it opens fleet pings (or mentions, or the app).
  - It never takes focus or flashes the taskbar (both can throw a full-screen game out of focus).
  - Adjustable opacity (Windows; Linux desktops don't allow it) and an option to let clicks through to the game.
  - Move it by its top bar and resize it from the corner grip. It remembers its size and place on each monitor, and comes back on screen if that monitor is unplugged.
  - On Wayland the desktop decides where windows go, so it may not stay on top. Preferences says so.
- **Mentions inbox:** a *Mentions* entry under *Fleet pings* in the sidebar gathers the room messages that mention you (your nickname, alias, username or room nickname, and the mention words in *Preferences → Notifications*) or match one of your keyword rules.
  - The entry only appears when there are mentions you haven't seen, and stays while its tab is open; after you see them and leave the inbox, it hides again. *Always show the mentions inbox* (*Preferences → Notifications*) keeps it visible, and Ctrl+K opens it at any time. Mentions are gathered either way.
  - An **@** button in the title bar, next to the room browser and history ones, always opens the inbox. A small dot (no number) shows when there are unseen mentions.
  - Each entry shows the room, who wrote it, how long ago, local and EVE time, and the text with the mention highlighted. Click it (or press Enter) to open the room at that message, loading older history if needed; the message is highlighted for a moment.
  - Filter by text or by room. The counter shows the ones you haven't seen. They count as seen when you leave the inbox, with *Mark all as seen*, or when you read them in their room.
  - It is filled from the local history when the app starts (rooms active in the last 30 days, the last 1,000 messages of each), so mentions from before you opened the app are there too, and new ones arrive live. Large rooms are read from the end of the file, not in full.
  - The count does not add to the taskbar badge, which already counts the room's mentions.
- **Alerts per room and per chat.** Each room and private chat can be set to *Use the general setting*, *Everything*, *Only mentions and keywords* or *Nothing*.
  - Set it from the bell in the conversation header, the ⋮ menu or a right-click on the room or contact in the sidebar.
  - It affects sound, pop-up, taskbar flashing and the unread numbers on tabs, sidebar and taskbar. *Nothing* doesn't count at all and shows a crossed-out bell in the sidebar.
  - Messages are still saved. Keyword rules set to *always alert* still win, as before.
- **Do not disturb on a schedule** (*Preferences → Notifications → Do not disturb*).
  - From–to times that can cross midnight (23:00–07:00), on chosen days of the week.
  - Optionally *Let mentions through*.
  - A quick toggle in your status menu and in the tray menu, and a notice in the title bar while it is on. Clicking the notice turns it off; during the schedule, it stays off until that window ends.
  - It doesn't change your XMPP status. Fleet pings and connection lost or restored alerts always get through; the voice of pings and of the formup reminder follows the same rule.

### Changed
- **Fleet pings header in two rows**, so it fits narrow windows: title, view switch and icons on top; filter, groups, SRP and the calendar buttons below. In a narrow header the calendar buttons show only their icon (the text is in the tooltip).
- **Pop-ups now appear on the main screen by default.** Before, they appeared on the screen where the mouse was, so with two monitors a ping could show up on the secondary one. New option *Pop-up screen* (*Preferences → Notifications*, next to the corner): *Main screen* (the default), *Where the mouse is* (the old behavior), *Screen with the EvEX-MPP window*, or a specific monitor by number and resolution. Picking one shows a test pop-up there.
  - The screen is chosen when the first pop-up of a stack opens and stays while any is open, so a ping that stays on screen does not jump to another monitor when you move the mouse.
  - If the chosen monitor is disconnected, pop-ups move to the main screen (no alert is lost) and go back to it when it is connected again, even if the system gives it a new id. Open pop-ups are moved when a monitor is added, removed or changes resolution.
  - On Wayland, where alerts are system notifications, the option is disabled and says why.
- **Formup reminder, more flexible** (*Preferences → Fleet pings → Formup countdown*). The alert before a ping's formup time now has more options:
  - Several reminders at once: 5, 10, 15, 30 minutes and 1 hour before (plus the alert at the exact time, as before). The single "alert in advance" setting from earlier versions is kept.
  - Only for some target groups of the ping footer (e.g. `all, caps`), like the voice reading.
  - Optionally read aloud ("Formup in 15 minutes. <title>"), with the voice and speed of *Read pings aloud*.
  - Two copies of the same ping (another connection, the server archive) now give one reminder, not two.
- **Connection log** (`connection.log` in the data folder, at most 1 MB with the previous one): connects, disconnects, errors and server notices (which until now only reached the developer console), and why each reconnection happened. No messages, contacts or passwords. See [PRIVACY.md](PRIVACY.md).

### Fixed
- **Dotlan link in fleet pings** only for place fields (Formup Location, Location, System, Staging…). It no longer appears next to a time ("Formup Time: 2026-11-05 🗺 Dotlan") or a date.
- **Sharper tray icon on scaled displays.** The tray icon used to be a single 16 px image, so Windows at 125–150 % scaling enlarged it and it looked blurry. It now comes in 16, 24 and 32 px, each drawn at its own size, for the normal icon, the fleet ping siren and the do-not-disturb badge.
- A network change notice (for example from a virtual network adapter) no longer cuts a connection that is still logging in and making progress, which with a distant server takes a few seconds; it was retried from scratch. An attempt that has been stuck for more than 5 seconds is still retried at once.
- A connection reset by the server during login, or after disconnecting while the server did not answer, no longer leaves an unhandled error in the main process.
- When a connection attempt failed after you had disconnected or reconnected, it could put the account in the error state or cut the new connection.

### Security
- Updated the development dependency minimatch to 11.0.4 (GHSA-g3hv-75wg-m249, denial of service in glob patterns). It is only used by the build tools, not shipped in the app.

## [0.8.0] - 2026-11-05

### Added
- **Avatar editor** in *Preferences → Avatar*, also opened by clicking your avatar circle in the sidebar or from *Change my avatar…* in the status menu.
  - Choose an image and frame it in a circle: drag to move, wheel, slider or +/− to zoom, arrow keys to move.
  - Like Pidgin, it is scaled to 96×96 and compressed before it is sent: PNG if it fits in 8 KB, otherwise the best JPEG that fits.
  - Animated GIF, WebP or PNG images can stay animated: they become a GIF of up to 64 KB, with fewer colors, a smaller size or fewer frames if needed. The GIF encoder is built in, with no new dependencies.
  - Published in the vCard (XEP-0153) as before, and now also with XEP-0084 (a still version), which modern clients use. Servers without it just keep the vCard.
  - *Remove avatar* clears the photo from the vCard, sends an empty `<photo/>` and publishes empty XEP-0084 metadata.
  - With several accounts there is one avatar block per account. *Manage accounts* shows each account's avatar with an *Avatar…* shortcut that opens the Avatar tab with that account highlighted.
- **Contacts' XEP-0084 avatars.** The app now sends entity capabilities (XEP-0115) with `urn:xmpp:avatar:metadata+notify`, so the server pushes each contact's XEP-0084 avatar on connect and whenever it changes.
  - The image is downloaded from the contact's data node, checked against its SHA-1 and cached like vCard avatars.
  - It takes priority over the vCard photo. If the contact removes it, their vCard photo or initials come back.
  - Avatars already drawn (messages, chat header, participants) are updated in place, also when one is removed.
  - The mock server asks for the client's capabilities like a real server. Writing `!avatar` or `!sinavatar` to Alice changes or removes hers.

### Fixed
- **Repeated fleet pings.** Some ping bots send one copy of the broadcast to each connection of the account. With Pidgin (or another client) connected at the same time, the server also forwards Pidgin's copy to EvEX-MPP (Message Carbons), so the same ping showed up twice, with only the time in the footer one second apart. A ping from a ping sender with the same text as another received less than 10 seconds before (ignoring dates, times and invisible characters) is now neither saved nor announced again.
- **Fleet pings view showing only the newest ping** ([#46](https://github.com/AlexDeveOp/EvEX-MPP/issues/46)). Turning SRP off while the *Flagged* filter was on left the list empty, and the next ping was added to that empty list, so the view showed only that ping until SRP was toggled again. The *Flagged* filter is now cleared before the list is painted, and a ping that arrives while the list is waiting to be repainted is shown when it is repainted.
- **Free-text fleet pings shown as fields or as one bold block** ([#48](https://github.com/AlexDeveOp/EvEX-MPP/issues/48)). A time such as `17:15` was taken for a `Key: value` field (`Tomorrow at 17` → `15 we are forming…`), and a ping without fields was joined into a single bold title, losing its paragraphs. A colon between two digits no longer starts a field, and without fields only the first line is the title: the rest is shown below with its line breaks.
- **Pidgin's copy of a ping recovered as a new ping** ([#51](https://github.com/AlexDeveOp/EvEX-MPP/issues/51)). With Pidgin open at the same time, ping recovery (which reads Pidgin's logs and the server archive) compared the whole text, including the time in the footer, which differs by a second between copies. Pidgin's copy was saved again and announced as recovered. Recovery now ignores dates and times like the live filter does.

### Security
- **Images from a link are no longer saved as downloaded** (CodeQL alerts #24 and #25). The app checks what a link really is from the file itself, not from what the server says, and no longer writes the downloaded bytes to disk:
  - *My GIFs* keeps only the link (sending a GIF already used the link). Thumbnails saved by earlier versions keep working.
  - A background added from a link (or dragged from the browser) is redrawn by Chromium and saved as a new PNG (JPEG for photos), so nothing hidden in the original file is kept. Animated images can't be added from a link: save them and drag them from File Explorer or use *Choose file…*, which keeps them animated.

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
- The room topic's **edit** tag (and *Change topic…* in the ⋮ menu) appeared in every room when the server didn't say whether participants may change the topic. It now only appears for moderators, or for participants when the room says it allows it. `/topic` still tries and explains the server's answer.
- **Quitting could leave the app running without a window** when the accounts were already disconnected: the second quit request came too early and was ignored. This could also happen on Windows.
- **Linux: the tray icon could stay as "…".** On Ubuntu's GNOME (AppIndicator extension), the icon sometimes never loaded, mostly when the AppImage was still busy starting: the desktop asked for the icon a few milliseconds before the app had published it and never asked again. On Linux the app now recreates its tray icon a few seconds after starting, so the desktop reads it again. ([#37](https://github.com/AlexDeveOp/EvEX-MPP/issues/37))
- **Linux: the AppImage took about 35 s to open** on a virtual machine, because it was packed with the slowest compression (xz) and is unpacked on every start. It now uses faster compression: it opens in about 2 s and is 25 MB larger. The `.deb` and the Windows installer are unchanged. ([#38](https://github.com/AlexDeveOp/EvEX-MPP/issues/38))
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

[Unreleased]: https://github.com/AlexDeveOp/EvEX-MPP/compare/v0.10.0...HEAD
[0.10.0]: https://github.com/AlexDeveOp/EvEX-MPP/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/AlexDeveOp/EvEX-MPP/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/AlexDeveOp/EvEX-MPP/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/AlexDeveOp/EvEX-MPP/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/AlexDeveOp/EvEX-MPP/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/AlexDeveOp/EvEX-MPP/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/AlexDeveOp/EvEX-MPP/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/AlexDeveOp/EvEX-MPP/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/AlexDeveOp/EvEX-MPP/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/AlexDeveOp/EvEX-MPP/tree/v0.3.0
[0.2.0]: https://github.com/AlexDeveOp/EvEX-MPP/blob/main/CHANGELOG.md#020---2026-11-02
[0.1.0]: https://github.com/AlexDeveOp/EvEX-MPP/blob/main/CHANGELOG.md#010---2026-11-02

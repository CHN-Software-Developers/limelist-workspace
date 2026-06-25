# Limelist Workspace

A colorful, lightweight Electron desktop app for managing your **daily todo activities** on a proportional, scrollable timeline.

![type: desktop](https://img.shields.io/badge/platform-Electron-8a63ff)

## Features

- **Timeline view** — tasks are laid out top-to-bottom by time of day. A block's
  height is proportional to its duration, so a 1 PM–5 PM task is visually much
  larger than a 10:00–10:30 AM one.
- **Live "now" indicator** — a glowing lime line shows the current position in
  the day and updates every 15 seconds; the view auto-scrolls to it on launch.
- **Side-by-side overlaps** — overlapping tasks automatically split into columns
  instead of hiding each other.
- **Colorful editor** — name a task, set start/end times, pick a color, done.
- **Reminders** — a native desktop notification fires when a task starts.
- **Mark as done** — tap the circle on any task to complete it.
- **Per-day, persistent storage** — every change is saved to disk immediately, so
  nothing is lost across restarts or reboots. Browse other days with ‹ / Today / ›.

## Run it

```bash
npm install
npm start
```

> If `npm install` fails with a TLS / certificate error (common behind antivirus
> or corporate proxies that intercept HTTPS), it's an environment issue, not a
> code one. See the install note in `CLAUDE.md`.

## Where is my data?

A single JSON file in Electron's per-user data directory:

- **Windows:** `%APPDATA%\Limelist Workspace\limelist-data.json`
- **macOS:** `~/Library/Application Support/Limelist Workspace/limelist-data.json`
- **Linux:** `~/.config/Limelist Workspace/limelist-data.json`

## Packaging (optional)

`electron-builder` is pre-configured. Install it as a dev dependency and run:

```bash
npm install --save-dev electron-builder
npm run dist
```
# limelist-workspace

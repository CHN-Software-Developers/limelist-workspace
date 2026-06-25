# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install      # install dependencies (Electron)
npm start        # launch the app (electron .)
npm run dist     # package with electron-builder (requires it installed as devDep)
node --check src/<file>.js   # syntax-check a source file (no test suite exists)
```

There is no test/lint setup. Validate changes by running `npm start` and exercising the UI.

### Install note (environment, not code)
`npm install` may fail with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` / `unable to verify the first certificate`.
This is local HTTPS interception (antivirus / proxy), not a project problem. The Electron **binary**
download (postinstall `node install.js`) uses `got`, which ignores npm's `--strict-ssl=false`, so it also
needs the TLS env var:
```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 npm install --strict-ssl=false
```
Use only as a local workaround; do not commit any persistent strict-ssl config change.

## Architecture

Plain Electron + vanilla JS/HTML/CSS — no framework, no build step, no bundler. Three process layers:

- **Main** (`src/main.js`) — owns the `BrowserWindow` and is the only place with
  Node/filesystem access. Persistence is a single JSON file at
  `app.getPath('userData')/limelist-data.json`, written atomically (temp file + rename).
  Exposes three IPC handlers: `data:load`, `data:save`, `notify`. Native notifications
  are sent here via Electron's `Notification`.
- **Preload** (`src/preload.js`) — `contextIsolation` is on and `nodeIntegration` off.
  Bridges exactly three functions to the renderer as `window.api`: `load()`, `save(data)`,
  `notify(title, body)`. The renderer never touches Node directly.
- **Renderer** (`src/renderer.js` + `index.html` + `styles.css`) — all UI and app logic.

### Data model
`data` is `{ 'YYYY-MM-DD': Task[] }`. A `Task` is
`{ id, name, start: 'HH:MM', end: 'HH:MM', color, done, notified }`.
Each day is keyed separately; the header's ‹ / Today / › navigation changes `currentDate`.
`pruneOldData()` runs on boot and deletes any day key older than `RETENTION_DAYS` (7); since
`YYYY-MM-DD` keys sort lexicographically the same as chronologically, it uses a plain string compare.

### UI surfaces (no permanent sidebar)
The timeline is full-width. All editing happens in popovers (`.overlay`/`.modal` in index.html):
- **Task editor** (`taskOverlay`) — opened for new tasks by the floating `+` `#fab`, or for editing by
  clicking a task block (`openEditModal`). Edit mode additionally reveals the Delete button and the
  "Duplicate to [date]" row (`#dupRow`).
- **Import** (`importOverlay`) — `openImportModal` lists every *other* day that has tasks; `doImport`
  clones them into the current day in `merge` or `replace` mode.
Modals close on backdrop click, the × button, or Esc. Cross-day copies always go through `cloneTask()`
(new id, `done:false`, `notified:false`).

### Timeline rendering (the core concept)
The timeline is an absolutely-positioned 24-hour column. `PX_PER_HOUR` (renderer.js) **must stay
in sync with `--hour` in styles.css** — both define the vertical scale.
- A task's `top` and `height` are derived from its start minutes and duration, which is what makes
  block size proportional to time span.
- `layoutTasks()` clusters overlapping tasks and assigns each a column so they render side by side
  (`width`/`left` are percentages of the cluster's column count).
- The "now" line (`renderNowLine`) is re-rendered every 15s by `tick()`; it only shows when
  `currentDate` is today.

### Reminders
`checkReminders()` (also on the 15s `tick`) scans **today's** tasks regardless of which day is being
viewed. It fires a notification only within ~90s of a task's start (so reopening the app later doesn't
replay past reminders) and sets `task.notified = true` so each fires at most once. Editing a task's
start time resets `notified` so the reminder can fire again.

### Conventions
- Persist on every mutation: call `persist()` (which calls `window.api.save`) then `render()`.
- Times are stored as `'HH:MM'` strings; convert with `toMinutes()` / `formatClock()` rather than Date math.
- Keep all DOM creation in the render functions; there is no virtual DOM — `render()` rebuilds from `data`.

# File Organiser Agent

A cross-platform (macOS · Windows · Linux) Node.js agent that watches your
folders, classifies each new file, renames it intelligently, de-duplicates by
content hash, and moves it to a rule-defined destination. It ships with a system
tray, native notifications, an undo log, and a localhost dashboard.

Built in four phases per `file-organiser-agent-plan.docx`. Every invariant from
the plan is preserved: the undo log is written **before** every move, `rules.yaml`
is the single source of truth, nothing is ever deleted, and dry-run is a flag
(not a separate code path).

## Quick start

```bash
npm install            # installs deps (better-sqlite3 builds a native module)
npm run start:dry      # first boot: dry-run, prints a preview table, moves nothing
npm run confirm        # flips dry_run=0 in SQLite — files now actually move
npm start              # normal run (watcher + tray + dashboard)
```

Open the dashboard at <http://localhost:4242> (or from the tray menu).

## How it works

```
new file ─▶ classify ─▶ hash + dupe check ─▶ rename ─▶ resolve dest (rule + conflict guard)
                                │                                   │
                          duplicate? ─▶ .dupes/{category}/    record undo row ─▶ move ─▶ index hash
```

- **Classify** — magic-byte sniff (`file-type`) first, extension map second,
  `Other` as a fallback. Returns `{ category, confidence }`.
- **Rename** — `YYYY-MM-DD-keyword-slug.ext` from the file's birthtime + a
  slug of the original name.
- **De-dupe** — streaming SHA-256; a content match routes the file to
  `.file-organiser/.dupes/` and appends a `dupes-manifest.json` entry.
- **Conflict guard** — a name clash at the destination becomes `name_2.ext`,
  `name_3.ext`, … Nothing is overwritten.
- **Undo** — every move writes an `actions` row first; undo reverses the move
  and sets `undone=1`. Cross-device moves fall back to copy+unlink.

## CLI flags

| Command | Effect |
|---|---|
| `npm start` | watcher + tray + dashboard |
| `npm run start:dry` | force dry-run on |
| `npm run confirm` | enable real moves (`dry_run=0`) |
| `npm run install-autostart` | register login auto-start (launchd / Task Scheduler / XDG) |
| `npm run remove-autostart` | unregister auto-start |
| `node src/index.js --no-tray` | run headless |
| `node src/index.js --no-server` | run without the dashboard |

## Configuration — `rules.yaml`

The source of truth for everything. Paths accept `~` and the tokens
`{year} {month} {day} {category}`. Edit it by hand or via the dashboard's Rules
editor, which writes back to YAML and hot-reloads the watcher with no restart.

```yaml
watched:
  - ~/Downloads
  - ~/Desktop
rules:
  Images:    ~/Pictures/Sorted/{year}/{month}
  Documents: ~/Documents/Sorted/{year}
  Other:     ~/Downloads/.unsorted
```

## Project layout

```
src/
  index.js        entry point: boots watcher + tray + server
  config.js       rules.yaml load/save, ~ and {token} expansion, paths
  db.js           better-sqlite3: settings, actions (undo log), file_hashes
  classifier.js   content sniff + extension map -> { category, confidence }
  hasher.js       streaming SHA-256
  renamer.js      date-prefix + slug composition
  sorter.js       rule lookup, conflict guard, cross-device safe move
  dupe-detector.js hash index check + .dupes/ routing + manifest
  pipeline.js     the per-file flow (classify→dedupe→rename→move)
  watcher.js      chokidar setup + dry-run preview table
  undo.js         reverse a move from the SQLite log
  notifier.js     node-notifier toast wrapper
  tray.js         systray2 menu + daily-count badge
  autostart.js    launchd / Task Scheduler / XDG installer
  server.js       Express app + SSE
  api/            rules · feed · undo · stats
public/           dashboard SPA (vanilla JS, no build step)
scripts/          launchd.plist · task-scheduler.xml templates
assets/           tray icons (png + ico)
test/             unit tests (node --test)
```

## Dashboard

Four tabs on `localhost:4242`:

- **Activity** — live SSE feed; every real move has an inline **Undo** button.
- **Stats** — summary cards + per-category bars, straight from SQLite.
- **Rules** — edit watched folders and category→destination mappings; Save
  writes `rules.yaml` and hot-reloads.
- **Duplicates** — every entry from `dupes-manifest.json`.

## Tests

```bash
npm test            # unit tests for the pure modules
```

The classifier, renamer, sorter (conflict guard), hasher, and config token
logic are covered. The full move/dedupe/undo pipeline has been verified
end-to-end against a temp filesystem.

## Notes

- The tray's "daily move count badge" is shown via the tray tooltip and the
  first menu item (`Today: N moved`) — a portable stand-in, since OS tray APIs
  don't expose numeric overlay badges uniformly across macOS and Windows.
- `better-sqlite3`, `systray2`, and `node-notifier` are native/host-specific;
  the agent degrades gracefully (logs instead of toasts, runs headless) if the
  tray or notifier is unavailable, but `better-sqlite3` is required.

## License

MIT

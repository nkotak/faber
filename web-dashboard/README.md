# faber-web

An editorial-meets-terminal web dashboard for the faber pipeline.

This is **complementary** to the Go TUI in `dashboard/` — it reads the same data
files, watches the same folders, invokes the same subprocesses. Neither side
touches the other. You can run both at the same time.

## Why this exists

The TUI is excellent in a terminal session. But sometimes you want:

- A reader's view of reports (editorial typography, long-form proportions)
- Inline PDF previews
- A shareable window you can show a collaborator
- A command palette for fast jumps across hundreds of applications
- Live ticker of job activity you can glance at without thinking

All while keeping data, scripts, and the Go TUI exactly as they are.

## How it works

A small Fastify server reads `data/applications.md`, `data/pipeline.md`, the
`reports/`, `output/`, and `interview-prep/` directories, and watches them all
via `chokidar`. Changes fan out to the browser via Server-Sent Events. Subprocess
jobs (PDF generation, eval, interview prep) are spawned with `child_process.spawn`
— same commands the Go TUI runs — and their lifecycle is fanned out too.

The browser runs a React + Vite + TypeScript app with TanStack Query (for data
fetching, invalidated by SSE) and TanStack Virtual (for the 1k+ row table). The
UI ships its own typography (Gloock / Spectral / Fragment Mono via `@fontsource`)
so nothing has to render over the network.

View Transitions morph the hero between application selections. The theme
switcher is a radial reveal from the click origin. Both fall back gracefully to
static alternatives under `prefers-reduced-motion`.

## Quick start

```bash
cd web-dashboard
npm install
npm run dev     # runs Vite on :5173 and Fastify on :7433 side-by-side
```

Then open http://127.0.0.1:5173/. Vite proxies `/api` calls to the backend so
they behave as one origin.

### Production-ish run

```bash
npm run build   # builds the frontend to ./dist/app
npm start       # Fastify on :7433, serves the built frontend + API
```

Or via the bundled CLI (opens a browser automatically):

```bash
node bin/faber-web.mjs
```

## Keyboard

| Key          | Action                                              |
|--------------|-----------------------------------------------------|
| `⌘K`         | Command palette                                     |
| `↑` / `↓`    | Previous / next row                                 |
| `←` / `→`    | Previous / next filter tab                          |
| `c`          | Change status of selected application               |
| `s`          | Cycle sort mode: score / date / company / status    |
| `v`          | Toggle grouped / flat list                          |
| `r`          | Manual refresh                                      |
| `⌘M`         | Toggle "mask comp figures" (privacy for shared view)|
| `Enter`      | Focus the report reader                             |
| `Esc`        | Close open palette / picker                         |

## Environment

The server looks at these env vars:

- `CAREER_OPS_ROOT` — absolute path to the project root. Defaults to `..` relative
  to `web-dashboard/`.
- `PORT` — HTTP port. Default `7433`.
- `HOST` — HTTP host. Default `127.0.0.1` (loopback; do not expose to LAN
  without adding auth first).

## Coexistence with the Go TUI

Both read freely. Both write to `applications.md` via atomic temp-file + rename.
There's no lockfile — a lock would create more failure modes than it would
prevent at single-user scale. If both write in the same 50ms window, the
loser is visible immediately via chokidar, and you notice.

## Directory layout

```
web-dashboard/
  package.json
  bin/
    faber-web.mjs          CLI: launches server + opens browser
  server/
    index.mjs              Fastify bootstrap
    routes/                REST + SSE
    watchers/files.mjs     chokidar debounced fan-out
    jobs/manager.mjs       subprocess lifecycle + toast timers
    parsers/               applications.md / pipeline.md / report.md / output/
    writers/applications.mjs  atomic status mutations
  app/
    index.html
    public/favicon.svg
    src/
      main.tsx
      App.tsx              top-level shell + routing
      components/          Masthead, TickerTape, FilterTabs, Table, DetailPane,
                           JobTray, Palette, Queue, States, StatusPicker
      lib/                 api, events, keymap, theme, types
      styles/              tokens, globals
  vite.config.ts
  tsconfig.json
```

## What's not here (yet)

- Mobile detail pane (the shell hides the detail pane on narrow viewports;
  TODO a slide-up sheet).
- Multi-user sharing: no auth, no permissions. Loopback-only by default.
- Any edits to the TUI — fully complementary, as requested.

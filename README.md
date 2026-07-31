# LaCrema — AI Jigsaw Puzzle

A single-page canvas jigsaw puzzle game (`index.html`): drag pieces, watch
connected groups form magnetically, race the timer. Works with mouse and touch.

## Run it

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Or deploy as-is (static, `vercel.json` included).

## Testing & demos

- **[demo/](demo/index.html)** — demo hub: one-click scenarios, puzzle catalog,
  sample analytics. Scripts in [demo/USE-CASES.md](demo/USE-CASES.md).
- **[test-data/](test-data/README.md)** — deterministic fixtures, a 13-puzzle
  catalog, 51 realistic play sessions, and a validator
  (`node test-data/validate.mjs`).
- URL parameters (default behavior is unchanged without them):
  - `?state=<fixture>` — resume a saved board, e.g. `?state=nearly-solved`
  - `?puzzle=<id>` — start a catalog puzzle, e.g. `?puzzle=kids-first-puzzle`
  - `?img=<url>&rows=<n>&cols=<n>` — ad-hoc puzzle

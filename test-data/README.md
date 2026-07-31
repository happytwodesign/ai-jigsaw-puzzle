# LaCrema Test Data

Representative, realistic, **deterministic** data sets for testing the LaCrema
jigsaw puzzle app. Everything is self-contained (artwork is committed SVG under
`assets/puzzles/`), so tests and demos work offline and in CI.

| File | What it is | Consumed by |
|------|------------|-------------|
| `puzzles.json` | Catalog of 13 puzzle definitions: artwork, grid, difficulty, QA flags | `index.html?puzzle=<id>`, demo hub |
| `game-states/*.json` | 7 board fixtures — saved games at interesting moments | `index.html?state=<name>` |
| `sessions.json` | 51 realistic play sessions over a 3-week window | demo hub analytics, future stats features |
| `leaderboard.json` | Top-5 completion times per puzzle, derived from sessions | demo hub |
| `generate.mjs` | Seeded generator that produces all of the above from `puzzles.json` | you, when changing the data design |
| `validate.mjs` | Dependency-free validator, 253 checks | you / CI: `node test-data/validate.mjs` |

## Quick start

```bash
# from the repo root
python3 -m http.server 8000
# open http://localhost:8000/index.html?state=nearly-solved
# or the full demo hub: http://localhost:8000/demo/

node test-data/validate.mjs   # verify all data invariants
node test-data/generate.mjs   # regenerate (byte-identical unless you edit the design)
```

## Game-state fixtures

Each fixture is a complete board the app can resume via `?state=<name>`:

| Fixture | Board | Why it exists |
|---------|-------|---------------|
| `fresh-shuffle` | 0/24 placed, timer 00:00 | Reproducible "just pressed Start" board for screenshots and bug reports |
| `early-game` | 4 corners placed, 01:35 | Corners-first play pattern; the 4 solved pieces form one draggable group |
| `mid-game-clusters` | 5 solved + floating 2×2 and L-of-3 clusters, 05:16 | Group drag, group snap, magnetic merge — the app's signature mechanics |
| `nearly-solved` | 23/24, 11:03 | One drag to win: solve detection, snap, timer stop, single alert |
| `solved` | 24/24, frozen 14:32 | Fully-solved rendering; whole board is one group |
| `kids-nearly-solved` | 2×3 grid, 5/6, 00:41 | Non-default grid via fixture; touch demo |
| `edge-cases` | 10 hand-placed boundary conditions, 03:42 | Regression board — see the `cases` array inside |

### Fixture schema

```jsonc
{
  "schemaVersion": 1,
  "name": "nearly-solved",
  "description": "...",
  "whatToTest": ["..."],
  "puzzle": { "id": "crema-classic", "image": "assets/puzzles/crema-swirl.svg", "rows": 4, "cols": 6 },
  "canvas": { "width": 800, "height": 1200 },        // must match index.html's canvas
  "timer": { "elapsedSeconds": 663, "display": "11:03" },
  "stats": { "movesSoFar": 52, "previewUses": 2, "shuffleUses": 0, "organizeUses": 1 },
  "expected": {                                       // machine-checkable, verified by validate.mjs
    "solvedCount": 23,
    "groupSizes": [23, 1],                            // partition under the app's connection rule
    "outOfBoundsPieces": []
  },
  "pieces": [
    { "row": 0, "col": 0, "sx": 0, "sy": 0, "correctX": 0, "correctY": 0, "x": 0, "y": 0 }
    // ... row/col are documentation; the app uses sx/sy/x/y/correctX/correctY
  ]
}
```

### Geometry contract (mirrors `index.html`)

- `pieceWidth = canvas.width / cols`, `pieceHeight = canvas.height / rows` —
  **raw floats, never rounded**. Fixtures carry bit-exact values because the
  app's solve check is strict equality (`x === correctX`).
- Snap: a piece (or group) within **< 20 px on both axes** of its slot snaps on release.
- Connection: two pieces are "connected" when their offsets from home agree
  within **< 10 px on both axes**. Adjacency is *not* required, which is why
  all solved pieces always form a single group.
- Scattered fixture pieces keep ≥ 40 px (max-norm) from their own slot and
  ≥ 25 px offset-distance from every other piece, so no *accidental* snaps or
  connections can occur — any connection in a fixture is there by design.

## Sessions data set

51 sessions across 2026-07-09 → 2026-07-30 with realistic shape:

- **Mix:** 15 registered players + guests (~40%); devices 55% mobile /
  30% desktop / 15% tablet with matching browsers; evening- and
  weekend-skewed timestamps.
- **Outcomes:** 35 completed / 14 abandoned / 2 image-load errors (69%
  completion). Completion rate and solve time scale with piece count,
  device, and artwork difficulty (`mist-cruel` is punishing on purpose).
- **Narrative anchors** for demos: Mia Chen's improving times
  (14:02 → 06:58), Yuki Tanaka's 02:41 record, Jonas Weber's 150-piece
  marathon (1:21:10), Amara Okafor's rage-quit at 92%.

Session schema (one object per session):

```jsonc
{
  "sessionId": "s-032", "playerId": "p-001", "playerName": "Mia Chen",
  "playerType": "registered",              // or "guest" (playerId null)
  "device": "desktop", "browser": "Chrome",
  "puzzleId": "crema-classic", "pieceCount": 24,
  "startedAt": "2026-07-21T19:48:02Z", "durationSeconds": 495,
  "durationDisplay": "08:15",              // null unless completed
  "outcome": "completed",                  // completed | abandoned | error
  "progressPercent": 100,
  "moves": 38, "previewUses": 1, "shuffleUses": 0, "organizeUses": 0,
  "shareClicked": false
  // error sessions additionally carry "errorCode": "IMAGE_LOAD_FAILED"
}
```

## Puzzle catalog notes

Difficulty is a product of **piece count × artwork distinctiveness** — the
committed SVGs are designed along that axis, from `kids-friends.svg` (every
region unique) to `misty-gradient.svg` (deliberately uniform fog) and
`geo-terrazzo.svg` (repeating pattern). `qa-*` entries are for testing only:
degenerate grids (1×2, 6×1), a 150-piece stress board, and an intentionally
broken image URL. `aurora-original-remote` preserves the app's original CDN
artwork and is the only entry that needs network access.

## Regenerating

`generate.mjs` is fully seeded (mulberry32) — running it twice produces
byte-identical output. Edit the design in the script (or the catalog), run it,
then run `validate.mjs`; commit the JSON. Don't hand-edit generated files —
the validator will catch drift if you do.

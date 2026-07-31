# LaCrema — Demo Use Cases

Nine scripted scenarios that demonstrate (and test) the LaCrema jigsaw app using
the data sets in [`test-data/`](../test-data/). Every scenario is a URL — open
the [Demo Hub](index.html) for one-click access.

**Setup:** serve the repo over HTTP from its root, e.g.

```bash
python3 -m http.server 8000
# open http://localhost:8000/demo/
```

(Fixtures are loaded with `fetch()`, so `file://` won't work. The deployed
Vercel site serves everything as-is.)

---

## UC-01 · Instant Win — the 30-second stakeholder demo

- **Persona:** anyone showing the product to someone with no time.
- **URL:** `../index.html?state=nearly-solved`
- **Script:**
  1. The board opens 23/24 complete, timer running from 11:03.
  2. Point out the one loose piece parked at the bottom-left.
  3. Drag it toward its gap (row 2, col 3). As it gets within ~10 px of
     alignment it magnetically merges with the solved region; release within
     20 px and everything snaps pixel-perfect.
  4. A single congratulations alert reports the finish time; the timer stops.
- **Validates:** fixture loading, timer resume, magnetic join, snap, solve
  detection, single (not double) end-of-game alert.

## UC-02 · Kids Quick Win — mobile touch demo

- **Persona:** parent handing a phone to a small child; also the standard
  touch-input smoke test.
- **URL:** `../index.html?state=kids-nearly-solved`
- **Script:** one 267×600 px piece is loose on a 2×3 board. Drag it to the
  bottom-right slot with a finger. Solved in one move, timer under a minute.
- **Validates:** non-default grid from a fixture, touch events
  (`touchstart/move/end`), big-piece ergonomics on small screens.

## UC-03 · Group Magnetism Showcase

- **Persona:** demoing the app's most satisfying mechanic.
- **URL:** `../index.html?state=mid-game-clusters`
- **Script:**
  1. The top edge (5 pieces) is solved. A 2×2 block and an L-of-three float
     mid-board, each assembled but away from home.
  2. Grab any piece of the 2×2 block — all four move as one.
  3. Drop the block so any member lands within 20 px of its slot: the whole
     block snaps home and fuses with the solved region.
  4. Repeat with the L-cluster. Finish the remaining 12 loose pieces or move on.
- **Validates:** `findConnectedPieces` group drag, group snap, group-merge on
  drop, cluster fixtures behaving as designed (group sizes 5/4/3 + 12
  singletons are asserted by `validate.mjs`).

## UC-04 · Full Playthrough — the honest test

- **Persona:** playtester; baseline UX session.
- **URL:** `../index.html?puzzle=crema-classic` (press **Start Game**)
- **Script:** play to completion. Use **Preview Image** when lost, **Organize
  Pieces** to un-pile the board. Expected time: 5–15 min on desktop (the
  sessions data set says the median is ~7 min; the record is Yuki Tanaka's
  02:41 — try to beat it).
- **Validates:** the complete real gameplay loop with self-contained artwork.

## UC-05 · Difficulty Ladder — catalog browsing

- **Persona:** product/design discussion about difficulty tuning.
- **URL:** Demo Hub → *Puzzle catalog* table.
- **Script:** climb `kids-first-puzzle` (6 pc, every region unique) →
  `sunset-warmup` → `crema-classic` → `city-nights` (54 pc) →
  `terrazzo-expert` (96 pc, repeating pattern) → `mist-cruel` (40 pc of
  near-identical fog).
- **Talking point:** difficulty = piece count × artwork distinctiveness.
  `mist-cruel` has fewer pieces than `city-nights` but is far harder — the
  sessions data reflects that (35% vs 45% completion), including Amara
  Okafor's rage-quit at 92%.
- **Validates:** `?puzzle=` loading across grids from 1×2 up to 8×12.

## UC-06 · Stress Test — 150 pieces

- **Persona:** performance check before shipping changes to piece logic.
- **URL:** `../index.html?puzzle=qa-stress-150` (press **Start Game**)
- **Script:** shuffle-drag pieces around; every mouse/touch move runs an
  O(n²) `findConnectedPieces` sweep over 150 pieces — watch for dropped
  frames. Press **Organize Pieces** and observe the parking behavior.
- **Validates:** rendering and input latency at 6× the default piece count.

## UC-07 · Failure Handling — broken image

- **Persona:** QA verifying graceful degradation.
- **URLs:** `../index.html?puzzle=qa-broken-image`,
  `../index.html?state=no-such-fixture`, and the app offline.
- **Expected:** a friendly red message naming the URL/fixture that failed —
  never a silent blank canvas. With no parameters the app must still behave
  exactly as before this loader existed (default image, 4×6, Start button).
- **Validates:** `img.onerror` path, loader error path, no-regression default.

## UC-08 · QA Regression Board — edge cases

- **Persona:** engineer changing `snapGroup`/`areConnected`/z-order code.
- **URL:** `../index.html?state=edge-cases`
- **Checklist** (all placements asserted numerically by `validate.mjs`;
  the `cases` array inside the fixture documents each):

  | # | Case | Action | Expected |
  |---|------|--------|----------|
  | 1 | `max-boundary` | look at bottom-right corner | piece renders fully at the exact in-bounds limit |
  | 2 | `min-boundary` | click piece at (0,0), release | stays — it's far from *its own* slot |
  | 3 | `snap-inside` (19 px off) | click, release | snaps home (threshold is strict `< 20`) |
  | 4 | `snap-at-threshold` (20 px off) | click, release | does **not** snap |
  | 5 | `connect-pair` (9 px misaligned) | grab either piece | partner snaps into alignment and both drag as one |
  | 6 | `stacked-pair` | click the stack at (350,500) | topmost (later in array) is picked |
  | 7 | `off-canvas-corner` | drag the sliver at bottom-right edge | fractional-coordinate piece hanging off two edges is still usable; **Organize** rescues it |
  | 8 | `off-canvas-sliver` | find the 20 px sliver at the bottom | still selectable |
  | 9 | `tray-stack-1/2` | unstack the two 7-piece piles | z-order sane, no accidental grouping |

## UC-09 · Share Flow

- **Persona:** growth/social feature demo.
- **URL:** any — e.g. `../index.html?state=mid-game-clusters`
- **Script:** the "Share this puzzle with a friend!" link reflects the full
  current URL, so sharing a `?state=`/`?puzzle=` link hands your friend the
  exact same board setup.
- **Validates:** share link includes query parameters.

---

## Analytics demo (no gameplay needed)

The Demo Hub renders `sessions.json` (51 sessions over three weeks, 69%
completion, device/browser mix, guests vs registered) and `leaderboard.json`
(top-5 per puzzle). Narrative anchors to point at during a demo:

- **Mia Chen** — returning player, four crema-classic sessions improving
  14:02 → 09:47 → 08:15 → 06:58.
- **Yuki Tanaka** — the 02:41 speedrun record.
- **Jonas Weber** — completed the 150-piece stress board in 1:21:10.
- **Amara Okafor** — abandoned `mist-cruel` at 92% after 40 minutes
  (difficulty-tuning conversation starter).
- Two `IMAGE_LOAD_FAILED` error sessions on `qa-broken-image`.

## Known quirks (current app behavior, on purpose not changed here)

- **Shuffle** only re-orders the z-stack; it does not move pieces. Piece
  positions only randomize on Start.
- **Preview Image** paints the full artwork over the board and it stays until
  your next drag redraws the pieces.
- **Organize Pieces** parks the first N pieces *in array order* into a grid
  ring — including already-solved pieces, which get yanked off their slots.
- Because connection is "offset agreement within 10 px" without adjacency,
  all solved pieces always count as one group (that's why dragging any
  solved piece drags the whole solved region).

One bug **was** fixed on this branch because the demos made it obvious:
the congratulations alert used to fire twice (once in `checkPuzzleSolved`,
once in `handleEnd`). `checkPuzzleSolved` is now a pure check.

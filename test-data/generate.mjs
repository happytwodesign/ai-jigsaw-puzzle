#!/usr/bin/env node
/**
 * Deterministic test-data generator for the LaCrema jigsaw puzzle app.
 *
 * Regenerates every derived data set from test-data/puzzles.json:
 *
 *   node test-data/generate.mjs
 *     -> test-data/game-states/*.json   (board fixtures, loadable via index.html?state=<name>)
 *     -> test-data/sessions.json        (realistic play-session analytics)
 *     -> test-data/leaderboard.json     (derived from sessions)
 *
 * Everything is seeded (mulberry32), so output is byte-identical between runs.
 * The generated files are committed; run this only when changing the data design.
 *
 * Geometry contract with index.html (do not break):
 *   pieceWidth  = canvas.width  / cols          (raw float, no rounding)
 *   pieceHeight = canvas.height / rows
 *   piece = { sx, sy, x, y, correctX, correctY }   (row/col are extra, app ignores them)
 *   sx === correctX === col * pieceWidth, sy === correctY === row * pieceHeight
 *   solved       <=> x === correctX && y === correctY   (strict equality)
 *   snap radius  = 20px on BOTH axes (strict <)
 *   "connected"  <=> two pieces' offsets (x-correctX, y-correctY) agree within
 *                    <10px on BOTH axes - adjacency is NOT required, so all
 *                    solved pieces always form one group.
 *
 * Because of that connection rule, scattered pieces are placed with margins:
 *   - at least 40px (max-norm) away from their own correct spot (snap is 20), and
 *   - offsets at least 25px (max-norm) apart from every other piece's offset
 *     (connect threshold is 10), unless the fixture intends a connection.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG = JSON.parse(readFileSync(join(HERE, 'puzzles.json'), 'utf8'));
const CANVAS = CATALOG.canvas;

const CONNECT_THRESHOLD = 10; // app: areConnected()
const SNAP_THRESHOLD = 20;    // app: snapGroup()
const OFFSET_CLEARANCE = 25;  // margin over CONNECT_THRESHOLD for unintended pairs
const SOLVED_CLEARANCE = 40;  // margin over SNAP_THRESHOLD from a piece's own slot

// ---------------------------------------------------------------- utilities

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Standard normal via Box-Muller, driven by the seeded rng.
function gauss(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function formatDuration(totalSeconds) {
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function puzzleById(id) {
  const p = CATALOG.puzzles.find((x) => x.id === id);
  if (!p) throw new Error(`unknown puzzle id: ${id}`);
  return p;
}

// Row-major pieces at their correct positions, exact app float math.
function gridPieces(puzzle) {
  const pw = CANVAS.width / puzzle.cols;
  const ph = CANVAS.height / puzzle.rows;
  const pieces = [];
  for (let row = 0; row < puzzle.rows; row++) {
    for (let col = 0; col < puzzle.cols; col++) {
      pieces.push({
        row,
        col,
        sx: col * pw,
        sy: row * ph,
        correctX: col * pw,
        correctY: row * ph,
        x: col * pw,
        y: row * ph,
      });
    }
  }
  return { pieces, pw, ph };
}

function pieceAt(pieces, row, col) {
  const p = pieces.find((q) => q.row === row && q.col === col);
  if (!p) throw new Error(`no piece at ${row},${col}`);
  return p;
}

// Place a piece at a random in-bounds spot that neither nearly-solves it nor
// accidentally "connects" it to any offset already on the board.
function scatter(piece, rng, pw, ph, takenOffsets) {
  for (let tries = 0; tries < 2000; tries++) {
    const x = rng() * (CANVAS.width - pw);
    const y = rng() * (CANVAS.height - ph);
    const ox = x - piece.correctX;
    const oy = y - piece.correctY;
    if (Math.max(Math.abs(ox), Math.abs(oy)) < SOLVED_CLEARANCE) continue;
    if (takenOffsets.some(([tx, ty]) =>
      Math.abs(ox - tx) < OFFSET_CLEARANCE && Math.abs(oy - ty) < OFFSET_CLEARANCE)) continue;
    piece.x = x;
    piece.y = y;
    takenOffsets.push([ox, oy]);
    return;
  }
  throw new Error(`scatter failed for piece ${piece.row},${piece.col}`);
}

// Group partition using the app's exact connection rule - stored in each
// fixture as a machine-checkable expectation.
function groupSizes(pieces) {
  const parent = pieces.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => { parent[find(a)] = find(b); };
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const a = pieces[i], b = pieces[j];
      const dxErr = Math.abs((a.x - b.x) - (a.correctX - b.correctX));
      const dyErr = Math.abs((a.y - b.y) - (a.correctY - b.correctY));
      if (dxErr < CONNECT_THRESHOLD && dyErr < CONNECT_THRESHOLD) union(i, j);
    }
  }
  const counts = new Map();
  for (let i = 0; i < pieces.length; i++) {
    const r = find(i);
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  return [...counts.values()].sort((a, b) => b - a);
}

function expectations(pieces, pw, ph) {
  const solved = pieces.filter((p) => p.x === p.correctX && p.y === p.correctY);
  // Epsilon absorbs float noise: a last-column piece at its slot computes
  // x + pw = 800.0000000000001, which is not really out of bounds.
  const EPS = 1e-6;
  const outOfBounds = pieces.filter(
    (p) => p.x < -EPS || p.y < -EPS || p.x + pw > CANVAS.width + EPS || p.y + ph > CANVAS.height + EPS,
  );
  return {
    solvedCount: solved.length,
    groupSizes: groupSizes(pieces),
    outOfBoundsPieces: outOfBounds.map((p) => ({ row: p.row, col: p.col })),
  };
}

function writeFixture(name, fixture) {
  const dir = join(HERE, 'game-states');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(fixture, null, 2) + '\n');
  console.log(`  game-states/${name}.json  (${fixture.pieces.length} pieces)`);
}

function baseFixture(name, description, whatToTest, puzzle, elapsedSeconds, stats, pieces, pw, ph, extra = {}) {
  return {
    schemaVersion: 1,
    name,
    description,
    whatToTest,
    puzzle: { id: puzzle.id, image: puzzle.image, rows: puzzle.rows, cols: puzzle.cols },
    canvas: { width: CANVAS.width, height: CANVAS.height },
    timer: { elapsedSeconds, display: formatDuration(elapsedSeconds) },
    stats,
    expected: expectations(pieces, pw, ph),
    ...extra,
    pieces,
  };
}

// ---------------------------------------------------------------- fixtures

function buildFreshShuffle() {
  const puzzle = puzzleById('crema-classic');
  const { pieces, pw, ph } = gridPieces(puzzle);
  const rng = mulberry32(101);
  const taken = [];
  for (const p of pieces) scatter(p, rng, pw, ph, taken);
  writeFixture('fresh-shuffle', baseFixture(
    'fresh-shuffle',
    'The board exactly as it looks right after pressing Start: every piece at a random spot, timer at zero. Statistically identical to what initPuzzle() produces, but reproducible.',
    [
      'initial render of a scrambled board',
      'no piece accidentally within snap range (20px) of its slot',
      'no two pieces accidentally within connect range (10px offset agreement)',
      'timer starts from 00:00',
    ],
    puzzle, 0,
    { movesSoFar: 0, previewUses: 0, shuffleUses: 0, organizeUses: 0 },
    pieces, pw, ph,
  ));
}

function buildEarlyGame() {
  const puzzle = puzzleById('crema-classic');
  const { pieces, pw, ph } = gridPieces(puzzle);
  const rng = mulberry32(202);
  const corners = [[0, 0], [0, 5], [3, 0], [3, 5]];
  const solved = corners.map(([r, c]) => pieceAt(pieces, r, c));
  const rest = pieces.filter((p) => !solved.includes(p));
  const taken = [[0, 0]];
  for (const p of rest) scatter(p, rng, pw, ph, taken);
  writeFixture('early-game', baseFixture(
    'early-game',
    'About ninety seconds in: a corners-first player has placed all four corner pieces; everything else is still scattered.',
    [
      'solved pieces render seamlessly at their slots',
      'the four solved pieces form ONE group (the app connects by offset agreement, not adjacency) - dragging any solved piece drags all four',
      'timer resumes from 01:35',
    ],
    puzzle, 95,
    { movesSoFar: 9, previewUses: 1, shuffleUses: 0, organizeUses: 0 },
    [...solved, ...rest], pw, ph,
  ));
}

function buildMidGameClusters() {
  const puzzle = puzzleById('crema-classic');
  const { pieces, pw, ph } = gridPieces(puzzle);
  const rng = mulberry32(303);

  // Solved: most of the top edge plus the piece under the top-left corner.
  const solvedRefs = [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0]];
  const solved = solvedRefs.map(([r, c]) => pieceAt(pieces, r, c));

  // Floating cluster A: an assembled 2x2 interior block, offset from home.
  const clusterARefs = [[1, 2], [1, 3], [2, 2], [2, 3]];
  const clusterA = clusterARefs.map(([r, c]) => pieceAt(pieces, r, c));
  const offsetA = [173.5, 262];
  for (const p of clusterA) { p.x = p.correctX + offsetA[0]; p.y = p.correctY + offsetA[1]; }

  // Floating cluster B: an assembled L of three, elsewhere on the board.
  const clusterBRefs = [[2, 0], [3, 0], [3, 1]];
  const clusterB = clusterBRefs.map(([r, c]) => pieceAt(pieces, r, c));
  const offsetB = [310, -405];
  for (const p of clusterB) { p.x = p.correctX + offsetB[0]; p.y = p.correctY + offsetB[1]; }

  const placed = new Set([...solved, ...clusterA, ...clusterB]);
  const rest = pieces.filter((p) => !placed.has(p));
  const taken = [[0, 0], offsetA, offsetB];
  for (const p of rest) scatter(p, rng, pw, ph, taken);

  writeFixture('mid-game-clusters', baseFixture(
    'mid-game-clusters',
    'Five minutes in: top edge mostly solved, plus two assembled clusters (a 2x2 block and an L of three) floating away from their slots, and twelve loose pieces.',
    [
      'grabbing any piece of the 2x2 cluster drags all four as one group',
      'grabbing any piece of the L-cluster drags all three',
      'dropping a cluster with any member within 20px of its slot snaps the whole cluster home',
      'dragging a cluster within 10px offset-agreement of the solved region merges the groups (magnetic join)',
      'loose pieces stay independent',
    ],
    puzzle, 316,
    { movesSoFar: 38, previewUses: 1, shuffleUses: 0, organizeUses: 1 },
    [...solved, ...rest, ...clusterB, ...clusterA], pw, ph,
    {
      clusters: [
        { pieces: clusterARefs.map(([row, col]) => ({ row, col })), offset: { x: offsetA[0], y: offsetA[1] } },
        { pieces: clusterBRefs.map(([row, col]) => ({ row, col })), offset: { x: offsetB[0], y: offsetB[1] } },
      ],
    },
  ));
}

function buildNearlySolved() {
  const puzzle = puzzleById('crema-classic');
  const { pieces, pw, ph } = gridPieces(puzzle);
  const last = pieceAt(pieces, 2, 3);
  last.x = 47.5;
  last.y = 862.25;
  const rest = pieces.filter((p) => p !== last);
  writeFixture('nearly-solved', baseFixture(
    'nearly-solved',
    'One move from victory: 23 of 24 pieces are placed; only the piece for row 2, col 3 is parked at the bottom-left. Drag it home to finish.',
    [
      'the 30-second stakeholder demo: one drag ends the game',
      'dropping the piece within 20px of its slot snaps it and triggers the solve alert exactly once',
      'timer stops at the solve and the reported time reads 11:0x',
      'while dragging, the piece magnetically merges with the solved region once within 10px offset agreement',
    ],
    puzzle, 663,
    { movesSoFar: 52, previewUses: 2, shuffleUses: 0, organizeUses: 1 },
    [...rest, last], pw, ph,
    { hint: { dragPiece: { row: 2, col: 3 }, dropAt: { x: last.correctX, y: last.correctY } } },
  ));
}

function buildSolved() {
  const puzzle = puzzleById('crema-classic');
  const { pieces, pw, ph } = gridPieces(puzzle);
  writeFixture('solved', baseFixture(
    'solved',
    'A finished board: every piece exactly at its slot, timer frozen at the completion time.',
    [
      'fully assembled artwork renders with no visible seams',
      'clicking any piece and releasing re-triggers the solve check (expect a single congratulations alert)',
      'all 24 pieces form one group - dragging anywhere drags the whole board',
    ],
    puzzle, 872,
    { movesSoFar: 61, previewUses: 2, shuffleUses: 1, organizeUses: 1 },
    pieces, pw, ph,
  ));
}

function buildKidsNearlySolved() {
  const puzzle = puzzleById('kids-first-puzzle');
  const { pieces, pw, ph } = gridPieces(puzzle);
  const last = pieceAt(pieces, 1, 2);
  last.x = 60;
  last.y = 30;
  const rest = pieces.filter((p) => p !== last);
  writeFixture('kids-nearly-solved', baseFixture(
    'kids-nearly-solved',
    'The 2x3 kids puzzle with five of six chunky pieces placed - one drag for a small child (or a phone demo) to win.',
    [
      'non-default grid (2 rows x 3 cols) loads correctly from a fixture',
      'chunky 267x600 pieces drag comfortably with touch',
      'single drag to the bottom-right slot completes the puzzle',
    ],
    puzzle, 41,
    { movesSoFar: 6, previewUses: 0, shuffleUses: 0, organizeUses: 0 },
    [...rest, last], pw, ph,
    { hint: { dragPiece: { row: 1, col: 2 }, dropAt: { x: last.correctX, y: last.correctY } } },
  ));
}

function buildEdgeCases() {
  const puzzle = puzzleById('crema-classic');
  const { pieces, pw, ph } = gridPieces(puzzle);

  const place = (row, col, x, y) => { const p = pieceAt(pieces, row, col); p.x = x; p.y = y; return p; };

  const c1 = place(0, 0, CANVAS.width - pw, CANVAS.height - ph); // exact max-boundary corner
  const c2 = place(3, 5, 0, 0);                                  // exact min-boundary corner
  const c3 = place(1, 1, 1 * pw + 19, 1 * ph);                   // 19px off: inside snap radius
  const c4 = place(1, 2, 2 * pw, 1 * ph + 20);                   // 20px off: exactly AT radius, must NOT snap
  const c5a = place(2, 3, 3 * pw - 180, 2 * ph + 150);           // pair misaligned by (9,0):
  const c5b = place(2, 4, 4 * pw - 171, 2 * ph + 150);           //   inside connect threshold -> joined
  const c6a = place(0, 5, 350, 500);                             // two pieces stacked exactly
  const c6b = place(3, 0, 350, 500);
  const c7 = place(2, 0, 723.4567, 1050.123);                    // fractional + off right AND bottom edge
  const c8 = place(3, 1, 400, 1180);                             // 20px sliver visible at bottom edge

  // Remaining 14 pieces: two deep "tray" stacks of seven, each stack at one
  // exact point. Offsets inside a stack differ by full piece sizes, so a
  // stack never self-connects - it is a pure z-order stress.
  const used = new Set([c1, c2, c3, c4, c5a, c5b, c6a, c6b, c7, c8]);
  const fillers = pieces.filter((p) => !used.has(p));
  const tray1 = fillers.slice(0, 7);
  const tray2 = fillers.slice(7);
  for (const p of tray1) { p.x = 660; p.y = 8; }
  for (const p of tray2) { p.x = 20; p.y = 640; }

  const order = [...tray1, ...tray2, c1, c2, c5a, c5b, c6a, c6b, c7, c8, c3, c4];

  writeFixture('edge-cases', baseFixture(
    'edge-cases',
    'A hand-built regression board packing ten boundary conditions of the piece mechanics into one state. Each case is documented in the "cases" array.',
    [
      'boundary coordinates, snap-radius edges, connect-threshold edges',
      'z-order behavior on deep stacks',
      'pieces dragged partially off-canvas remain usable',
    ],
    puzzle, 222,
    { movesSoFar: 27, previewUses: 0, shuffleUses: 1, organizeUses: 0 },
    order, pw, ph,
    {
      cases: [
        { id: 'max-boundary', piece: { row: 0, col: 0 }, expectation: 'sits exactly at the bottom-right in-bounds limit (666.67, 900); renders fully, no clipping' },
        { id: 'min-boundary', piece: { row: 3, col: 5 }, expectation: 'sits exactly at (0,0) - the top-left limit, which is also piece (0,0)\'s slot; must NOT snap (its own slot is far away)' },
        { id: 'snap-inside', piece: { row: 1, col: 1 }, expectation: 'is 19px right of its slot; clicking and releasing it snaps it home (threshold is strict < 20)' },
        { id: 'snap-at-threshold', piece: { row: 1, col: 2 }, expectation: 'is exactly 20px below its slot; clicking and releasing must NOT snap (strict < 20)' },
        { id: 'connect-pair', pieces: [{ row: 2, col: 3 }, { row: 2, col: 4 }], expectation: 'misaligned by (9,0) relative to each other - inside the 10px connect threshold, so picking either drags both and the partner snaps into perfect alignment' },
        { id: 'stacked-pair', pieces: [{ row: 0, col: 5 }, { row: 3, col: 0 }], expectation: 'both exactly at (350,500); a click picks the one later in the pieces array (rendered on top)' },
        { id: 'off-canvas-corner', piece: { row: 2, col: 0 }, expectation: 'fractional coords (723.4567, 1050.123), hangs off the right AND bottom edges; still draggable by its visible sliver; Organize rescues it' },
        { id: 'off-canvas-sliver', piece: { row: 3, col: 1 }, expectation: 'only a 20px sliver visible at the bottom edge; still selectable' },
        { id: 'tray-stack-1', count: 7, at: { x: 660, y: 8 }, expectation: 'seven pieces stacked on one point: z-order stress, no accidental grouping (offsets differ by full piece sizes)' },
        { id: 'tray-stack-2', count: 7, at: { x: 20, y: 640 }, expectation: 'second seven-piece stack, lower left area' },
      ],
    },
  ));
}

// ---------------------------------------------------------------- sessions

const REGISTERED_PLAYERS = [
  { id: 'p-001', name: 'Mia Chen' },
  { id: 'p-002', name: 'Yuki Tanaka' },
  { id: 'p-003', name: 'Oscar Lindqvist' },
  { id: 'p-004', name: 'Priya Sharma' },
  { id: 'p-005', name: 'Jonas Weber' },
  { id: 'p-006', name: 'Sofia Rossi' },
  { id: 'p-007', name: 'Amara Okafor' },
  { id: 'p-008', name: 'Lucas Silva' },
  { id: 'p-009', name: 'Emma Johansson' },
  { id: 'p-010', name: 'Ravi Patel' },
  { id: 'p-011', name: 'Inès Dubois' },
  { id: 'p-012', name: 'Mateo García' },
  { id: 'p-013', name: 'Hana Kim' },
  { id: 'p-014', name: 'Tunde Adeyemi' },
  { id: 'p-015', name: 'Freja Nielsen' },
];

const BROWSERS = {
  mobile: ['Safari iOS', 'Chrome Android', 'Samsung Internet'],
  desktop: ['Chrome', 'Firefox', 'Safari macOS', 'Edge'],
  tablet: ['Safari iPadOS', 'Chrome Android'],
};

// seconds per piece by device, before difficulty/noise factors
const DEVICE_PACE = { desktop: 17, mobile: 26, tablet: 22 };
const DIFFICULTY_FACTOR = { easy: 0.8, medium: 1.0, hard: 1.15, expert: 1.3, cruel: 1.6 };
// share of sessions that finish, by piece count (cruel art overrides below)
const COMPLETION_RATE = { 2: 0.95, 6: 0.88, 12: 0.85, 24: 0.72, 40: 0.5, 54: 0.45, 96: 0.3, 150: 0.2 };

// July 2026; 11/12, 18/19, 25/26 are the weekends in the window.
const WEEKEND_DAYS = [11, 12, 18, 19, 25, 26];
const EVENING_WEIGHTED_HOURS = [7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 15, 16, 17, 18, 19, 19, 20, 20, 21, 21, 22, 22, 23];

function randomStartedAt(rng) {
  const day = rng() < 0.35
    ? WEEKEND_DAYS[Math.floor(rng() * WEEKEND_DAYS.length)]
    : 10 + Math.floor(rng() * 21); // 10..30
  const hour = EVENING_WEIGHTED_HOURS[Math.floor(rng() * EVENING_WEIGHTED_HOURS.length)];
  const min = Math.floor(rng() * 60);
  const sec = Math.floor(rng() * 60);
  const dd = String(day).padStart(2, '0');
  const hh = String(hour).padStart(2, '0');
  const mi = String(min).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return `2026-07-${dd}T${hh}:${mi}:${ss}Z`;
}

function buildSessions() {
  const rng = mulberry32(777);
  const sessions = [];

  const pushSession = (s) => sessions.push(s);

  // ---- narrative sessions (hand-authored, stable anchors for demos) ----

  // Mia Chen: a returning player whose crema-classic times improve week over week.
  const mia = [
    ['2026-07-09T19:24:11Z', 842, 47, 2, 1, false],
    ['2026-07-14T20:05:43Z', 587, 41, 1, 1, false],
    ['2026-07-21T19:48:02Z', 495, 38, 1, 0, false],
    ['2026-07-29T21:12:37Z', 418, 33, 0, 0, true],
  ];
  for (const [startedAt, dur, moves, previews, organizes, shared] of mia) {
    pushSession({
      playerId: 'p-001', playerName: 'Mia Chen', playerType: 'registered',
      device: 'desktop', browser: 'Chrome', puzzleId: 'crema-classic', pieceCount: 24,
      startedAt, durationSeconds: dur, durationDisplay: formatDuration(dur),
      outcome: 'completed', progressPercent: 100, moves,
      previewUses: previews, shuffleUses: 0, organizeUses: organizes, shareClicked: shared,
    });
  }

  // Yuki Tanaka: the speedrun outlier on the flagship puzzle.
  pushSession({
    playerId: 'p-002', playerName: 'Yuki Tanaka', playerType: 'registered',
    device: 'desktop', browser: 'Firefox', puzzleId: 'crema-classic', pieceCount: 24,
    startedAt: '2026-07-26T14:31:05Z', durationSeconds: 161, durationDisplay: '02:41',
    outcome: 'completed', progressPercent: 100, moves: 26,
    previewUses: 0, shuffleUses: 0, organizeUses: 0, shareClicked: true,
  });

  // Jonas Weber: completed the 150-piece stress board in one 81-minute marathon.
  pushSession({
    playerId: 'p-005', playerName: 'Jonas Weber', playerType: 'registered',
    device: 'desktop', browser: 'Chrome', puzzleId: 'qa-stress-150', pieceCount: 150,
    startedAt: '2026-07-19T10:02:54Z', durationSeconds: 4870, durationDisplay: '1:21:10',
    outcome: 'completed', progressPercent: 100, moves: 236,
    previewUses: 4, shuffleUses: 0, organizeUses: 3, shareClicked: false,
  });

  // Amara Okafor: gave up on the cruel fog board at 92% after 40 minutes.
  pushSession({
    playerId: 'p-007', playerName: 'Amara Okafor', playerType: 'registered',
    device: 'mobile', browser: 'Safari iOS', puzzleId: 'mist-cruel', pieceCount: 40,
    startedAt: '2026-07-23T18:40:19Z', durationSeconds: 2410, durationDisplay: null,
    outcome: 'abandoned', progressPercent: 92, moves: 71,
    previewUses: 5, shuffleUses: 1, organizeUses: 2, shareClicked: false,
  });

  // Two failed loads of the intentionally broken image.
  pushSession({
    playerId: null, playerName: 'Guest #7302', playerType: 'guest',
    device: 'mobile', browser: 'Chrome Android', puzzleId: 'qa-broken-image', pieceCount: 24,
    startedAt: '2026-07-16T08:12:33Z', durationSeconds: 14, durationDisplay: null,
    outcome: 'error', progressPercent: 0, moves: 0,
    previewUses: 0, shuffleUses: 0, organizeUses: 0, shareClicked: false,
    errorCode: 'IMAGE_LOAD_FAILED',
  });
  pushSession({
    playerId: 'p-004', playerName: 'Priya Sharma', playerType: 'registered',
    device: 'desktop', browser: 'Edge', puzzleId: 'qa-broken-image', pieceCount: 24,
    startedAt: '2026-07-24T13:03:21Z', durationSeconds: 9, durationDisplay: null,
    outcome: 'error', progressPercent: 0, moves: 0,
    previewUses: 0, shuffleUses: 0, organizeUses: 0, shareClicked: false,
    errorCode: 'IMAGE_LOAD_FAILED',
  });

  // ---- bulk sessions (seeded random over a fixed play-mix plan) ----

  const plan = [
    ['crema-classic', 10], ['kids-first-puzzle', 6], ['sunset-warmup', 5],
    ['aurora-ridge', 4], ['botanical-afternoon', 4], ['city-nights', 4],
    ['terrazzo-expert', 2], ['mist-cruel', 2], ['aurora-original-remote', 2],
    ['qa-minimal-2', 1], ['qa-single-column', 1], ['qa-stress-150', 1],
  ];

  for (const [puzzleId, count] of plan) {
    const puzzle = puzzleById(puzzleId);
    for (let i = 0; i < count; i++) {
      const device = rng() < 0.55 ? 'mobile' : rng() < 0.67 ? 'desktop' : 'tablet';
      const browser = BROWSERS[device][Math.floor(rng() * BROWSERS[device].length)];
      const registered = rng() < 0.6;
      const player = registered
        ? REGISTERED_PLAYERS[Math.floor(rng() * REGISTERED_PLAYERS.length)]
        : { id: null, name: `Guest #${1000 + Math.floor(rng() * 9000)}` };

      let rate = COMPLETION_RATE[puzzle.pieceCount] ?? 0.6;
      if (puzzle.difficulty === 'cruel') rate = 0.35;
      const completed = rng() < rate;

      const pace = DEVICE_PACE[device]
        * (puzzle.id === 'kids-first-puzzle' ? 0.55 : DIFFICULTY_FACTOR[puzzle.difficulty])
        * Math.exp(gauss(rng) * 0.35);
      const fullTime = Math.max(25, Math.round(puzzle.pieceCount * pace));

      let outcome, progressPercent, durationSeconds;
      if (completed) {
        outcome = 'completed';
        progressPercent = 100;
        durationSeconds = fullTime;
      } else {
        outcome = 'abandoned';
        progressPercent = Math.min(95, Math.max(5, Math.round(5 + Math.pow(rng(), 1.4) * 90)));
        durationSeconds = Math.max(20, Math.round(fullTime * progressPercent / 100 * (0.8 + rng() * 0.4)));
      }

      const moves = outcome === 'completed'
        ? Math.round(puzzle.pieceCount * (1.3 + rng() * 1.1))
        : Math.max(1, Math.round(puzzle.pieceCount * (1.3 + rng() * 1.1) * progressPercent / 100));

      const hardish = puzzle.difficulty === 'hard' || puzzle.difficulty === 'expert' || puzzle.difficulty === 'cruel';
      pushSession({
        playerId: player.id, playerName: player.name,
        playerType: registered ? 'registered' : 'guest',
        device, browser, puzzleId, pieceCount: puzzle.pieceCount,
        startedAt: randomStartedAt(rng),
        durationSeconds,
        durationDisplay: outcome === 'completed' ? formatDuration(durationSeconds) : null,
        outcome, progressPercent, moves,
        previewUses: Math.floor(rng() * 3) + (hardish ? Math.floor(rng() * 3) : 0),
        shuffleUses: rng() < 0.25 ? 1 : 0,
        organizeUses: Math.floor(Math.pow(rng(), 2) * 3),
        shareClicked: rng() < 0.12,
      });
    }
  }

  sessions.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  sessions.forEach((s, i) => { s.sessionId = `s-${String(i + 1).padStart(3, '0')}`; });
  // sessionId first for readability
  const ordered = sessions.map(({ sessionId, ...rest }) => ({ sessionId, ...rest }));

  const completedSessions = ordered.filter((s) => s.outcome === 'completed');
  const durations = completedSessions.map((s) => s.durationSeconds).sort((a, b) => a - b);
  const median = durations.length % 2
    ? durations[(durations.length - 1) / 2]
    : Math.round((durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2);

  const out = {
    schemaVersion: 1,
    description: 'Realistic play-session analytics for the LaCrema jigsaw app. Deterministically generated (see generate.mjs); narrative anchor sessions include a returning player with improving times (Mia Chen), a speedrun outlier (Yuki Tanaka), a 150-piece marathon (Jonas Weber), a rage-quit at 92% on the cruel board (Amara Okafor), and two failed image loads.',
    window: { from: '2026-07-09', to: '2026-07-30' },
    summary: {
      totalSessions: ordered.length,
      completed: completedSessions.length,
      abandoned: ordered.filter((s) => s.outcome === 'abandoned').length,
      errors: ordered.filter((s) => s.outcome === 'error').length,
      completionRate: Math.round((completedSessions.length / ordered.length) * 100) / 100,
      medianCompletedDurationSeconds: median,
    },
    sessions: ordered,
  };
  writeFileSync(join(HERE, 'sessions.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`  sessions.json  (${ordered.length} sessions, ${completedSessions.length} completed)`);
  return out;
}

function buildLeaderboard(sessionsData) {
  const boards = [];
  for (const puzzle of CATALOG.puzzles) {
    const done = sessionsData.sessions
      .filter((s) => s.puzzleId === puzzle.id && s.outcome === 'completed')
      .sort((a, b) => a.durationSeconds - b.durationSeconds)
      .slice(0, 5);
    if (done.length === 0) continue;
    boards.push({
      puzzleId: puzzle.id,
      title: puzzle.title,
      pieceCount: puzzle.pieceCount,
      entries: done.map((s, i) => ({
        rank: i + 1,
        playerName: s.playerName,
        playerType: s.playerType,
        device: s.device,
        durationSeconds: s.durationSeconds,
        durationDisplay: s.durationDisplay,
        date: s.startedAt.slice(0, 10),
        sessionId: s.sessionId,
      })),
    });
  }
  const out = {
    schemaVersion: 1,
    description: 'Best completion times per puzzle, derived from sessions.json. Regenerate with generate.mjs; do not edit by hand.',
    boards,
  };
  writeFileSync(join(HERE, 'leaderboard.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`  leaderboard.json  (${boards.length} boards)`);
}

// ---------------------------------------------------------------- main

console.log('Generating LaCrema test data...');
buildFreshShuffle();
buildEarlyGame();
buildMidGameClusters();
buildNearlySolved();
buildSolved();
buildKidsNearlySolved();
buildEdgeCases();
const sessionsData = buildSessions();
buildLeaderboard(sessionsData);
console.log('Done.');

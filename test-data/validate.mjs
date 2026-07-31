#!/usr/bin/env node
/**
 * Validator for the LaCrema test data sets. No dependencies.
 *
 *   node test-data/validate.mjs
 *
 * Exits non-zero if any invariant fails. Everything is re-derived
 * independently of generate.mjs (same rules, separate code path), so it
 * catches hand-edits, generator regressions, and schema drift:
 *
 *   - puzzles.json: unique ids, sane grids, difficulty enum, local images exist
 *   - game-states/*.json: exact grid float math, grid completeness, embedded
 *     "expected" blocks (solved count, group partition per the app's
 *     areConnected rule, out-of-bounds pieces), timer display, edge-case
 *     invariants (snap radii, connect pair, stacks, off-canvas pieces)
 *   - sessions.json: schema, ISO timestamps in window, outcome consistency,
 *     summary block re-computed
 *   - leaderboard.json: every entry backed by a session, sorted, ranks contiguous
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let failures = 0;
let checks = 0;

function ok(cond, label) {
  checks++;
  if (cond) return true;
  failures++;
  console.error(`  FAIL  ${label}`);
  return false;
}

function section(title) {
  console.log(`\n${title}`);
}

const CONNECT_THRESHOLD = 10;
const SNAP_THRESHOLD = 20;

// ---------------------------------------------------------------- catalog

const catalog = JSON.parse(readFileSync(join(HERE, 'puzzles.json'), 'utf8'));
const CANVAS = catalog.canvas;

section('puzzles.json');
{
  const ids = catalog.puzzles.map((p) => p.id);
  ok(new Set(ids).size === ids.length, 'puzzle ids are unique');
  ok(CANVAS.width === 800 && CANVAS.height === 1200, 'canvas is 800x1200 (matches index.html)');
  for (const p of catalog.puzzles) {
    ok(Number.isInteger(p.rows) && p.rows >= 1 && Number.isInteger(p.cols) && p.cols >= 1,
      `${p.id}: rows/cols are positive integers`);
    ok(p.pieceCount === p.rows * p.cols, `${p.id}: pieceCount equals rows*cols`);
    ok(catalog.difficultyScale.includes(p.difficulty), `${p.id}: difficulty is on the scale`);
    if (/^https?:\/\//.test(p.image)) {
      ok(p.requiresNetwork === true, `${p.id}: remote image is marked requiresNetwork`);
    } else if (p.expectFailure) {
      ok(!existsSync(join(ROOT, p.image)), `${p.id}: expectFailure image really is missing`);
    } else {
      ok(existsSync(join(ROOT, p.image)), `${p.id}: local image exists (${p.image})`);
    }
  }
  console.log(`  ${catalog.puzzles.length} puzzles checked`);
}

// ---------------------------------------------------------------- fixtures

function computeGroupSizes(pieces) {
  const parent = pieces.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const a = pieces[i], b = pieces[j];
      const dxErr = Math.abs((a.x - b.x) - (a.correctX - b.correctX));
      const dyErr = Math.abs((a.y - b.y) - (a.correctY - b.correctY));
      if (dxErr < CONNECT_THRESHOLD && dyErr < CONNECT_THRESHOLD) parent[find(i)] = find(j);
    }
  }
  const counts = new Map();
  for (let i = 0; i < pieces.length; i++) {
    const r = find(i);
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  return [...counts.values()].sort((a, b) => b - a);
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

const fixtureDir = join(HERE, 'game-states');
const fixtureFiles = readdirSync(fixtureDir).filter((f) => f.endsWith('.json')).sort();

for (const file of fixtureFiles) {
  section(`game-states/${file}`);
  const fx = JSON.parse(readFileSync(join(fixtureDir, file), 'utf8'));
  const cat = catalog.puzzles.find((p) => p.id === fx.puzzle.id);

  ok(!!cat, `puzzle id "${fx.puzzle.id}" exists in catalog`);
  if (!cat) continue;
  ok(fx.puzzle.image === cat.image && fx.puzzle.rows === cat.rows && fx.puzzle.cols === cat.cols,
    'puzzle image/rows/cols match the catalog');
  ok(fx.canvas.width === CANVAS.width && fx.canvas.height === CANVAS.height, 'canvas matches catalog');

  const { rows, cols } = fx.puzzle;
  const pw = CANVAS.width / cols;
  const ph = CANVAS.height / rows;
  const pieces = fx.pieces;

  ok(pieces.length === rows * cols, `piece count is ${rows * cols}`);
  const seen = new Set(pieces.map((p) => `${p.row},${p.col}`));
  ok(seen.size === rows * cols, 'every grid cell appears exactly once');

  let exactGrid = true;
  for (const p of pieces) {
    // strict === : the app compares x === correctX for the solve check, so
    // fixtures must carry bit-exact grid coordinates.
    if (p.sx !== p.col * pw || p.sy !== p.row * ph || p.correctX !== p.sx || p.correctY !== p.sy) {
      exactGrid = false;
      break;
    }
  }
  ok(exactGrid, 'sx/sy/correctX/correctY carry bit-exact app float math');

  const solvedCount = pieces.filter((p) => p.x === p.correctX && p.y === p.correctY).length;
  ok(solvedCount === fx.expected.solvedCount, `solvedCount ${solvedCount} matches expected`);

  const sizes = computeGroupSizes(pieces);
  ok(JSON.stringify(sizes) === JSON.stringify(fx.expected.groupSizes),
    `group partition ${JSON.stringify(sizes)} matches expected`);

  const EPS = 1e-6;
  const oob = pieces
    .filter((p) => p.x < -EPS || p.y < -EPS || p.x + pw > CANVAS.width + EPS || p.y + ph > CANVAS.height + EPS)
    .map((p) => ({ row: p.row, col: p.col }));
  ok(JSON.stringify(oob) === JSON.stringify(fx.expected.outOfBoundsPieces),
    'out-of-bounds pieces match expected');

  ok(fx.timer.display === formatDuration(fx.timer.elapsedSeconds),
    `timer display "${fx.timer.display}" matches elapsedSeconds`);

  if (fx.hint) {
    const target = pieces.find((p) => p.row === fx.hint.dragPiece.row && p.col === fx.hint.dragPiece.col);
    ok(target && target.x !== target.correctX,
      'hint.dragPiece is really the unsolved piece');
    ok(fx.hint.dropAt.x === target.correctX && fx.hint.dropAt.y === target.correctY,
      'hint.dropAt is the piece\'s slot');
  }
  console.log(`  ${pieces.length} pieces checked`);
}

// Edge-case fixture: verify each documented boundary condition numerically.
section('edge-cases invariants');
{
  const fx = JSON.parse(readFileSync(join(fixtureDir, 'edge-cases.json'), 'utf8'));
  const pw = CANVAS.width / fx.puzzle.cols;
  const ph = CANVAS.height / fx.puzzle.rows;
  const at = (row, col) => fx.pieces.find((p) => p.row === row && p.col === col);

  const c1 = at(0, 0);
  ok(c1.x === CANVAS.width - pw && c1.y === CANVAS.height - ph, 'max-boundary piece exactly at limit');
  const c2 = at(3, 5);
  ok(c2.x === 0 && c2.y === 0, 'min-boundary piece exactly at (0,0)');

  const c3 = at(1, 1);
  const d3 = Math.max(Math.abs(c3.x - c3.correctX), Math.abs(c3.y - c3.correctY));
  ok(d3 > 0 && d3 < SNAP_THRESHOLD, `snap-inside piece is ${d3}px off (0 < d < ${SNAP_THRESHOLD})`);

  const c4 = at(1, 2);
  const d4 = Math.max(Math.abs(c4.x - c4.correctX), Math.abs(c4.y - c4.correctY));
  ok(d4 === SNAP_THRESHOLD, `snap-at-threshold piece is exactly ${SNAP_THRESHOLD}px off`);

  const c5a = at(2, 3), c5b = at(2, 4);
  const relX = Math.abs((c5a.x - c5b.x) - (c5a.correctX - c5b.correctX));
  const relY = Math.abs((c5a.y - c5b.y) - (c5a.correctY - c5b.correctY));
  ok(relX < CONNECT_THRESHOLD && relY < CONNECT_THRESHOLD && (relX > 0 || relY > 0),
    `connect-pair misalignment (${relX},${relY}) is inside the connect threshold but not zero`);

  const c6a = at(0, 5), c6b = at(3, 0);
  ok(c6a.x === c6b.x && c6a.y === c6b.y, 'stacked pair occupies the same point');

  const tray1 = fx.pieces.filter((p) => p.x === 660 && p.y === 8);
  const tray2 = fx.pieces.filter((p) => p.x === 20 && p.y === 640);
  ok(tray1.length === 7 && tray2.length === 7, 'both tray stacks hold seven pieces');
}

// ---------------------------------------------------------------- sessions

section('sessions.json');
const sessionsData = JSON.parse(readFileSync(join(HERE, 'sessions.json'), 'utf8'));
{
  const sessions = sessionsData.sessions;
  const ids = new Set();
  const isoRe = /^2026-07-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
  const outcomes = new Set(['completed', 'abandoned', 'error']);
  const devices = new Set(['mobile', 'desktop', 'tablet']);
  let allGood = true;

  for (const s of sessions) {
    const problems = [];
    if (ids.has(s.sessionId)) problems.push('duplicate sessionId');
    ids.add(s.sessionId);
    if (!isoRe.test(s.startedAt) || Number.isNaN(Date.parse(s.startedAt))) problems.push('bad startedAt');
    if (!outcomes.has(s.outcome)) problems.push('bad outcome');
    if (!devices.has(s.device)) problems.push('bad device');
    if (!catalog.puzzles.some((p) => p.id === s.puzzleId)) problems.push('unknown puzzleId');
    const cat = catalog.puzzles.find((p) => p.id === s.puzzleId);
    if (cat && s.pieceCount !== cat.pieceCount) problems.push('pieceCount mismatch');
    if (!(s.durationSeconds > 0)) problems.push('non-positive duration');
    if (s.outcome === 'completed' && (s.progressPercent !== 100 || !s.durationDisplay)) problems.push('completed inconsistency');
    if (s.outcome === 'abandoned' && !(s.progressPercent >= 1 && s.progressPercent <= 95)) problems.push('abandoned progress out of range');
    if (s.outcome === 'error' && (s.progressPercent !== 0 || !s.errorCode)) problems.push('error inconsistency');
    if (s.playerType === 'guest' && s.playerId !== null) problems.push('guest with playerId');
    if (s.playerType === 'registered' && !/^p-\d{3}$/.test(s.playerId ?? '')) problems.push('registered without playerId');
    if (s.outcome !== 'error' && s.moves < 1) problems.push('playable session with no moves');
    if (problems.length) {
      allGood = false;
      failures++;
      checks++;
      console.error(`  FAIL  ${s.sessionId}: ${problems.join('; ')}`);
    }
  }
  if (allGood) ok(true, 'per-session checks');

  const sorted = [...sessions].every((s, i, a) => i === 0 || a[i - 1].startedAt <= s.startedAt);
  ok(sorted, 'sessions sorted by startedAt');

  const sum = sessionsData.summary;
  const completed = sessions.filter((s) => s.outcome === 'completed');
  ok(sum.totalSessions === sessions.length, 'summary.totalSessions');
  ok(sum.completed === completed.length, 'summary.completed');
  ok(sum.abandoned === sessions.filter((s) => s.outcome === 'abandoned').length, 'summary.abandoned');
  ok(sum.errors === sessions.filter((s) => s.outcome === 'error').length, 'summary.errors');
  const durations = completed.map((s) => s.durationSeconds).sort((a, b) => a - b);
  const median = durations.length % 2
    ? durations[(durations.length - 1) / 2]
    : Math.round((durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2);
  ok(sum.medianCompletedDurationSeconds === median, 'summary median re-computes');
  console.log(`  ${sessions.length} sessions checked`);
}

// ---------------------------------------------------------------- leaderboard

section('leaderboard.json');
{
  const lb = JSON.parse(readFileSync(join(HERE, 'leaderboard.json'), 'utf8'));
  for (const board of lb.boards) {
    ok(catalog.puzzles.some((p) => p.id === board.puzzleId), `${board.puzzleId}: known puzzle`);
    ok(board.entries.length >= 1 && board.entries.length <= 5, `${board.puzzleId}: 1-5 entries`);
    let prev = 0;
    board.entries.forEach((e, i) => {
      ok(e.rank === i + 1, `${board.puzzleId}#${i + 1}: rank contiguous`);
      ok(e.durationSeconds >= prev, `${board.puzzleId}#${i + 1}: sorted by time`);
      prev = e.durationSeconds;
      const backing = sessionsData.sessions.find((s) => s.sessionId === e.sessionId);
      ok(backing
        && backing.outcome === 'completed'
        && backing.puzzleId === board.puzzleId
        && backing.durationSeconds === e.durationSeconds
        && backing.playerName === e.playerName,
        `${board.puzzleId}#${i + 1}: backed by session ${e.sessionId}`);
    });
    // no completed session for this puzzle beats the board's worst entry unless the board is full
    const all = sessionsData.sessions
      .filter((s) => s.puzzleId === board.puzzleId && s.outcome === 'completed')
      .sort((a, b) => a.durationSeconds - b.durationSeconds);
    const expectedTop = all.slice(0, 5).map((s) => s.sessionId);
    ok(JSON.stringify(expectedTop) === JSON.stringify(board.entries.map((e) => e.sessionId)),
      `${board.puzzleId}: entries are exactly the top completed sessions`);
  }
  console.log(`  ${lb.boards.length} boards checked`);
}

// ---------------------------------------------------------------- report

console.log(`\n${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);

/**
 * Property / fuzz tests for the pure rules engine.
 *
 * Every game is driven by a seeded PRNG (the engine's own randomness is routed
 * through a stubbed globalThis.crypto), so any failure message carries a seed
 * and config that replay the exact game: `runGame(seed, players, hand, rules)`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ACTIONS,
  COLORS,
  DECK_SIZE,
  DEFAULT_GAME_RULES,
  MAX_PLAYERS,
  MIN_PLAYERS,
  MIN_STARTING_HAND,
  applyCallUno,
  applyDraw,
  applyPassTurn,
  applyPlay,
  chooseAIMove,
  foldSlotIntoDrawPile,
  getActivePlayerSlots,
  getTurnCycle,
  getValidMoves,
  isSlotActive,
  makeInitialGameState,
  maxStartingHandForPlayers,
  needsUnoCall,
} from "./gameLogic.js";

// ---------------------------------------------------------------------------
// Seeded randomness
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

let engineRng = mulberry32(1);

beforeAll(() => {
  // gameLogic.js reads globalThis.crypto.getRandomValues for shuffles and ids.
  vi.stubGlobal("crypto", {
    getRandomValues(buf) {
      for (let i = 0; i < buf.length; i += 1) buf[i] = engineRng();
      return buf;
    },
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    float: () => next() / 0x100000000,
    int: (maxExclusive) => (maxExclusive <= 1 ? 0 : next() % maxExclusive),
    pick: (arr) => arr[next() % arr.length],
    chance: (p) => next() / 0x100000000 < p,
  };
}

const RULE_KEYS = Object.keys(DEFAULT_GAME_RULES);
const RULE_COMBOS = 1 << RULE_KEYS.length; // 128

function rulesFromMask(mask) {
  const rules = {};
  RULE_KEYS.forEach((k, i) => {
    rules[k] = Boolean(mask & (1 << i));
  });
  return rules;
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

function collectIds(state) {
  const ids = [];
  for (const hand of state.hands) for (const c of hand) ids.push(c.id);
  for (const c of state.drawPile) ids.push(c.id);
  for (const c of state.discardPile) ids.push(c.id);
  return ids;
}

function fail(msg, ctx) {
  throw new Error(`${msg}\n  ${ctx}`);
}

/** Structural invariants that must hold after every transition. */
function checkInvariants(state, ids, ctx, { endedByFold }) {
  const n = state.playerCount;
  if (state.hands.length !== n) fail(`hands.length ${state.hands.length} !== ${n}`, ctx);

  const seen = collectIds(state);
  if (seen.length !== DECK_SIZE) fail(`card count ${seen.length} !== ${DECK_SIZE}`, ctx);
  const set = new Set(seen);
  if (set.size !== DECK_SIZE) fail("duplicate card ids in play", ctx);
  for (const id of ids) if (!set.has(id)) fail(`card ${id} vanished`, ctx);

  state.hands.forEach((h, i) => {
    if (!Array.isArray(h) || h.length < 0) fail(`hand ${i} malformed`, ctx);
    if (state.foldedSlots[i] && h.length !== 0) fail(`folded slot ${i} still holds cards`, ctx);
  });

  if (state.direction !== 1 && state.direction !== -1) fail(`direction ${state.direction}`, ctx);
  if (!Number.isInteger(state.pendingDraw) || state.pendingDraw < 0) {
    fail(`pendingDraw ${state.pendingDraw}`, ctx);
  }
  if (state.pendingDraw > 0 && !state.drawStackType) fail("pendingDraw without stack type", ctx);
  if (state.pendingDraw === 0 && state.drawStackType !== null) {
    fail("stack type without pendingDraw", ctx);
  }
  if (state.pendingDraw === 0 && state.penaltyChainMode !== null) {
    fail("penaltyChainMode without pendingDraw", ctx);
  }

  const top = state.discardPile[state.discardPile.length - 1];
  if (!top) fail("empty discard pile", ctx);
  if (state.topCard.id !== top.id || state.topCard.color !== top.color) {
    fail("topCard !== last of discardPile", ctx);
  }
  if (!COLORS.includes(state.topCard.color)) fail(`topCard.color ${state.topCard.color}`, ctx);
  if (state.drawPile.length === 0 && state.discardPile.length > 1) {
    // A draw would reshuffle; allowed. Nothing to assert, but never negative.
  }

  if (!Number.isInteger(state.currentPlayer) || state.currentPlayer < 0 || state.currentPlayer >= n) {
    fail(`currentPlayer ${state.currentPlayer} out of range`, ctx);
  }
  if (state.unoMissed.length !== n) fail("unoMissed length", ctx);
  if (state.foldedSlots.length !== n) fail("foldedSlots length", ctx);

  if (state.winner === null) {
    if (!isSlotActive(state, state.currentPlayer)) {
      fail(`currentPlayer ${state.currentPlayer} is folded`, ctx);
    }
    if (getActivePlayerSlots(state).length < 2) fail("fewer than 2 active players, no winner", ctx);
    const moves = getValidMoves(state, state.currentPlayer);
    if (moves.length === 0 && !state.mayPassAfterDraw) {
      fail("current player has no valid move", ctx);
    }
    const cycle = getTurnCycle(state);
    if (cycle.length !== getActivePlayerSlots(state).length || cycle[0] !== state.currentPlayer) {
      fail(`turn cycle ${JSON.stringify(cycle)} inconsistent`, ctx);
    }
  } else {
    if (!Number.isInteger(state.winner) || state.winner < 0 || state.winner >= n) {
      fail(`winner ${state.winner} out of range`, ctx);
    }
    if (!endedByFold && state.hands[state.winner].length !== 0) {
      fail("winner still holds cards", ctx);
    }
    if (state.foldedSlots[state.winner]) fail("winner is folded", ctx);
  }
}

// ---------------------------------------------------------------------------
// Game driver
// ---------------------------------------------------------------------------

// Hard cap on turns; the real deadlock detector is the no-progress window below.
const MAX_TURNS = 3000;
// Rounds (each = one turn per active player) with no card moving before we call it a livelock.
const STALL_ROUNDS = 3;
const SKIP_REJECT_CHECKS = process.env.FUZZ_SKIP_REJECT === "1";

function describeMove(m) {
  if (!m) return "null";
  if (m.type === "play") return `play#${m.cardIndex}(${m.card.color} ${m.card.value})`;
  return `${m.type}${m.amount ? `x${m.amount}` : ""}`;
}

function sameMove(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === "play") return a.cardIndex === b.cardIndex;
  if (a.type === "draw") return a.amount === b.amount;
  return true;
}

/**
 * Plays one full game. Throws (with seed + config + recent log) on any violation.
 * Returns summary stats.
 */
function runGame(seed, playerCount, handSize, rules, { foldy = false } = {}) {
  engineRng = mulberry32(seed ^ 0x9e3779b9);
  const rng = makeRng(seed);
  const cfg = `seed=${seed} players=${playerCount} hand=${handSize} rules=${JSON.stringify(rules)} foldy=${foldy}`;
  const log = [];
  const ctx = () => `${cfg}\n  last moves: ${log.slice(-12).join(" | ")}`;

  let state = makeInitialGameState(playerCount, handSize, rules);
  const ids = collectIds(state);
  if (new Set(ids).size !== DECK_SIZE) throw new Error(`deck id collision at deal (${cfg})`);
  expect(state.hands.length).toBe(playerCount);
  state.hands.forEach((h) => expect(h.length).toBe(handSize));

  let endedByFold = false;
  let reshuffles = 0;
  let folds = 0;
  let unoCalls = 0;
  let turns = 0;
  let stalledTurns = 0;
  let unoPenaltyDraws = 0;
  let emptyDraws = 0;

  checkInvariants(state, ids, ctx(), { endedByFold });

  while (state.winner === null) {
    if (turns >= MAX_TURNS) fail(`game did not terminate in ${MAX_TURNS} turns`, ctx());
    turns += 1;
    const p = state.currentPlayer;

    // Disconnect paths: fold a random player (current or not).
    if (foldy && rng.chance(0.04) && getActivePlayerSlots(state).length >= 2) {
      const slot = rng.pick(getActivePlayerSlots(state));
      const before = state;
      state = foldSlotIntoDrawPile(state, slot);
      folds += 1;
      log.push(`P${slot} folds`);
      if (isSlotActive(state, slot)) fail("folded slot still active", ctx());
      if (state.drawPile.length !== before.drawPile.length + before.hands[slot].length) {
        fail("folded hand not returned to draw pile", ctx());
      }
      if (state.winner !== null) endedByFold = true;
      checkInvariants(state, ids, ctx(), { endedByFold });
      // Folding twice is a no-op.
      if (foldSlotIntoDrawPile(state, slot) !== state) fail("double fold changed state", ctx());
      continue;
    }

    // UNO pre-calls: mostly the current player, sometimes anyone with 2 cards.
    if (needsUnoCall(state, p) && rng.chance(0.6)) {
      state = applyCallUno(state, p);
      unoCalls += 1;
      log.push(`P${p} UNO`);
      checkInvariants(state, ids, ctx(), { endedByFold });
    } else if (rng.chance(0.05)) {
      const q = rng.int(playerCount);
      const before = state;
      state = applyCallUno(state, q);
      if (before.hands[q].length !== 2 && state !== before) fail("UNO call accepted off 2 cards", ctx());
      checkInvariants(state, ids, ctx(), { endedByFold });
    }

    const moves = getValidMoves(state, p);
    if (moves.length === 0 && !state.mayPassAfterDraw) fail("no valid moves", ctx());

    // Pick a move: AI 30% of the time, random otherwise, pass when allowed.
    let move;
    if (rng.chance(0.3)) {
      move = chooseAIMove(state, p);
      if (!moves.some((m) => sameMove(m, move))) {
        fail(`chooseAIMove returned ${describeMove(move)} not in ${moves.map(describeMove)}`, ctx());
      }
    } else {
      // Random but human-like: prefer playing a card when one is playable,
      // otherwise draw / pass. Pure uniform choice stalls large tables.
      const plays = moves.filter((m) => m.type === "play");
      const others = moves.filter((m) => m.type !== "play");
      if (state.mayPassAfterDraw) others.push({ type: "pass" });
      if (plays.length > 0 && (others.length === 0 || rng.chance(0.92))) {
        move = rng.pick(plays);
      } else {
        move = rng.pick(others);
      }
    }

    const before = state;
    if (move.type === "play") {
      const card = before.hands[p][move.cardIndex];
      const isWildCard = card.value === ACTIONS.WILD || card.value === ACTIONS.WILD_DRAW_FOUR;
      const color = isWildCard ? rng.pick(COLORS) : null;
      state = applyPlay(before, p, move.cardIndex, color);
      log.push(`P${p} ${describeMove(move)}${color ? `->${color}` : ""}`);
      if (state.hands[p].length !== before.hands[p].length - 1) fail("play did not remove one card", ctx());
      if (state.topCard.id !== card.id) fail("played card is not on top", ctx());
      if (isWildCard && state.topCard.color !== color) fail("chosen color not applied", ctx());
      if (state.discardPile.length !== before.discardPile.length + 1) fail("discard did not grow by 1", ctx());
      if (state.hands[p].length === 0 && state.winner !== p) fail("empty hand without win", ctx());
    } else if (move.type === "draw") {
      const drawable = Math.min(move.amount, before.drawPile.length + before.discardPile.length - 1);
      state = applyDraw(before, p, move.amount);
      log.push(`P${p} ${describeMove(move)}`);
      const gained = state.hands[p].length - before.hands[p].length;
      if (gained !== drawable) fail(`drew ${gained}, expected ${drawable}`, ctx());
      if (before.drawPile.length < move.amount && before.discardPile.length > 1) {
        reshuffles += 1;
        if (state.discardPile.length !== 1 && gained > before.drawPile.length) {
          fail("reshuffle left more than the top card in discard", ctx());
        }
      }
      if (state.pendingDraw !== 0) fail("pendingDraw survived a draw", ctx());
      if (move.unoPenalty && state.unoMissed[p]) fail("uno penalty not cleared by draw", ctx());
      if (move.unoPenalty) unoPenaltyDraws += 1;
      if (gained === 0) {
        emptyDraws += 1;
        // Nothing to draw and nothing to play: the "draw" must have ended the turn.
        if (state.currentPlayer === p && state.winner === null && !state.mayPassAfterDraw) {
          fail("empty draw kept the turn without a pass window", ctx());
        }
      }
    } else {
      state = applyPassTurn(before, p);
      log.push(`P${p} pass`);
      if (state.currentPlayer === p && getActivePlayerSlots(state).length > 1) fail("pass kept turn", ctx());
      if (state.mayPassAfterDraw) fail("mayPassAfterDraw survived pass", ctx());
    }

    if (state.turnCount !== before.turnCount + 1) fail("turnCount did not advance by 1", ctx());
    checkInvariants(state, ids, ctx(), { endedByFold });

    // Livelock detector: cards must move at least once every few rounds.
    const cardsMoved = state.hands.some((h, i) => h.length !== before.hands[i].length);
    stalledTurns = cardsMoved ? 0 : stalledTurns + 1;
    if (stalledTurns > STALL_ROUNDS * getActivePlayerSlots(state).length) {
      fail(`no card moved for ${stalledTurns} turns (livelock)`, ctx());
    }

    // Rejected inputs must not be silently accepted (checked on live states; costly, so sampled).
    if (state.winner === null && !SKIP_REJECT_CHECKS && rng.chance(0.02)) {
      assertRejectsBadInputs(state, ctx());
    }
  }

  return { turns, reshuffles, folds, unoCalls, unoPenaltyDraws, emptyDraws, endedByFold, winner: state.winner };
}

/** Malicious / out-of-protocol calls against a real mid-game state. */
function assertRejectsBadInputs(state, ctx) {
  const p = state.currentPlayer;
  const n = state.playerCount;
  const valid = getValidMoves(state, p);
  const snapshot = JSON.stringify(state);

  const expectClean = (fn, label) => {
    let out;
    try {
      out = fn();
    } catch (err) {
      if (!(err instanceof Error) || err instanceof TypeError || err instanceof RangeError) {
        fail(`${label}: threw non-clean ${err?.constructor?.name}: ${err?.message}`, ctx);
      }
      return { threw: true };
    }
    return { threw: false, out };
  };

  // Unplayable card index (present in hand but not a valid move).
  const hand = state.hands[p];
  for (let i = 0; i < hand.length; i += 1) {
    if (valid.some((m) => m.type === "play" && m.cardIndex === i)) continue;
    const r = expectClean(() => applyPlay(state, p, i, null), `applyPlay unplayable #${i}`);
    if (!r.threw && r.out !== state) fail(`applyPlay accepted unplayable card #${i}`, ctx);
    break;
  }

  for (const idx of [-1, hand.length, 1e9, NaN, Infinity, 0.5, "0", null, undefined, {}]) {
    const r = expectClean(() => applyPlay(state, p, idx, null), `applyPlay index ${String(idx)}`);
    if (!r.threw && r.out !== state) fail(`applyPlay accepted bad index ${String(idx)}`, ctx);
  }

  const playMove = valid.find((m) => m.type === "play");
  if (playMove) {
    for (const color of ["Purple", "red", 123, {}, [], true]) {
      const r = expectClean(
        () => applyPlay(state, p, playMove.cardIndex, color),
        `applyPlay color ${String(color)}`
      );
      if (!r.threw && r.out !== state) fail(`applyPlay accepted color ${String(color)}`, ctx);
    }
  }

  for (const amount of [0, -1, -1e9, 1e9, NaN, Infinity, 0.5, "1", null, undefined]) {
    const r = expectClean(() => applyDraw(state, p, amount), `applyDraw amount ${String(amount)}`);
    if (!r.threw && r.out !== state) fail(`applyDraw accepted amount ${String(amount)}`, ctx);
  }

  // Draw when not allowed (after drawing with a playable card, or wrong amount).
  const drawMove = valid.find((m) => m.type === "draw");
  if (!drawMove) {
    const r = expectClean(() => applyDraw(state, p, 1), "applyDraw when no draw move");
    if (!r.threw && r.out !== state) fail("applyDraw accepted when not a valid move", ctx);
  } else {
    const wrong = drawMove.amount === 1 ? 2 : 1;
    const r = expectClean(() => applyDraw(state, p, wrong), "applyDraw wrong amount");
    if (!r.threw && r.out !== state) fail(`applyDraw accepted amount ${wrong} (valid ${drawMove.amount})`, ctx);
  }

  // Actions from a non-current player, and from out-of-range players.
  const others = [...Array(n).keys()].filter((i) => i !== p);
  for (const q of [...others.slice(0, 2), -1, n, 99, NaN, "0"]) {
    const rp = expectClean(() => applyPlay(state, q, 0, null), `applyPlay by P${String(q)}`);
    if (!rp.threw && rp.out !== state) fail(`applyPlay accepted from non-current P${String(q)}`, ctx);
    const rd = expectClean(() => applyDraw(state, q, 1), `applyDraw by P${String(q)}`);
    if (!rd.threw && rd.out !== state) fail(`applyDraw accepted from non-current P${String(q)}`, ctx);
    const rpass = expectClean(() => applyPassTurn(state, q), `applyPassTurn by P${String(q)}`);
    if (!rpass.threw && rpass.out !== state) fail(`applyPassTurn accepted from P${String(q)}`, ctx);
  }

  // Pass when not allowed.
  if (!state.mayPassAfterDraw) {
    const r = expectClean(() => applyPassTurn(state, p), "applyPassTurn when not allowed");
    if (!r.threw && r.out !== state) fail("applyPassTurn accepted when not allowed", ctx);
  }

  // UNO call when not allowed: unchanged state.
  for (let q = 0; q < n; q += 1) {
    if (state.hands[q].length === 2) continue;
    const r = expectClean(() => applyCallUno(state, q), `applyCallUno P${q}`);
    if (!r.threw && r.out !== state) fail(`applyCallUno accepted for P${q} with ${state.hands[q].length} cards`, ctx);
  }
  for (const q of [-1, n, 99, NaN]) {
    const r = expectClean(() => applyCallUno(state, q), `applyCallUno P${String(q)}`);
    if (!r.threw && r.out !== state) fail(`applyCallUno accepted for P${String(q)}`, ctx);
  }

  // Fold of an out-of-range slot: unchanged.
  for (const slot of [-1, n, 99, NaN]) {
    const r = expectClean(() => foldSlotIntoDrawPile(state, slot), `fold slot ${String(slot)}`);
    if (!r.threw && r.out !== state) fail(`fold accepted out-of-range slot ${String(slot)}`, ctx);
  }

  if (JSON.stringify(state) !== snapshot) fail("rejected input mutated the state object", ctx);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const GAME_COUNT = Number(process.env.FUZZ_GAMES ?? 3000);
const BASE_SEED = Number(process.env.FUZZ_SEED ?? 20260906);

describe("gameLogic fuzz", () => {
  it(`plays ${GAME_COUNT} complete random games without violating invariants`, () => {
    const totals = {
      turns: 0, reshuffles: 0, folds: 0, unoCalls: 0, unoPenaltyDraws: 0, emptyDraws: 0, endedByFold: 0, maxTurns: 0,
    };
    const playerRange = MAX_PLAYERS - MIN_PLAYERS + 1;

    for (let i = 0; i < GAME_COUNT; i += 1) {
      const seed = (BASE_SEED + i * 7919) >>> 0;
      // Cycle deterministically through every rule combo and player count,
      // and every legal starting hand for that player count.
      const rules = rulesFromMask(i % RULE_COMBOS);
      const playerCount = MIN_PLAYERS + (Math.floor(i / RULE_COMBOS) + i) % playerRange;
      const maxHand = maxStartingHandForPlayers(playerCount);
      const handSize = MIN_STARTING_HAND + (Math.floor(i / 7) % (maxHand - MIN_STARTING_HAND + 1));
      const foldy = i % 10 === 0;

      const r = runGame(seed, playerCount, handSize, rules, { foldy });
      totals.turns += r.turns;
      totals.reshuffles += r.reshuffles;
      totals.folds += r.folds;
      totals.unoCalls += r.unoCalls;
      totals.unoPenaltyDraws += r.unoPenaltyDraws;
      totals.emptyDraws += r.emptyDraws;
      totals.endedByFold += r.endedByFold ? 1 : 0;
      totals.maxTurns = Math.max(totals.maxTurns, r.turns);
    }

    // Sanity: the fuzz actually exercised the interesting paths.
    expect(totals.reshuffles).toBeGreaterThan(0);
    expect(totals.folds).toBeGreaterThan(0);
    expect(totals.unoCalls).toBeGreaterThan(0);
    expect(totals.unoPenaltyDraws).toBeGreaterThan(0);
    expect(totals.maxTurns).toBeLessThanOrEqual(MAX_TURNS);
    if (process.env.FUZZ_VERBOSE) process.stderr.write(`fuzz totals ${JSON.stringify(totals)}\n`);
  }, 60_000);

  it("covers every player count at its maximum starting hand", () => {
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n += 1) {
      const max = maxStartingHandForPlayers(n);
      for (let mask = 0; mask < RULE_COMBOS; mask += 17) {
        runGame((n * 1000 + mask) >>> 0, n, max, rulesFromMask(mask), { foldy: n % 3 === 0 });
      }
    }
  }, 60_000);

  it("is reproducible: the same seed yields the same game", () => {
    const a = runGame(4242, 5, 7, DEFAULT_GAME_RULES, { foldy: true });
    const b = runGame(4242, 5, 7, DEFAULT_GAME_RULES, { foldy: true });
    expect(a).toEqual(b);
  });
});


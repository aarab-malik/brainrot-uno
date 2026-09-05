export const COLORS = ["Red", "Blue", "Green", "Yellow"];
export const ACTIONS = {
  SKIP: "Skip",
  REVERSE: "Reverse",
  DRAW_TWO: "+2",
  WILD: "Wild",
  WILD_DRAW_FOUR: "Wild+4",
};

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 16;
/** @deprecated Use state.playerCount */
export const PLAYER_COUNT = 3;
export const DECK_SIZE = 108;
export const MIN_DRAW_PILE_REMAINING = 20;
export const MIN_STARTING_HAND = 4;
export const MAX_STARTING_HAND = 15;
/** Default when not configured (online lobby / bots). */
export const STARTING_HAND_SIZE = 8;

export const DEFAULT_GAME_RULES = {
  allowDrawTwoOnDrawTwo: true,
  allowDrawTwoOnDrawFour: false,
  allowDrawFourOnDrawTwo: false,
  allowDrawFourOnDrawFour: true,
  drawTwoSkipsTurn: true,
  drawFourSkipsTurn: false,
  allowSkipReverseOnDrawTwo: true,
};

export function normalizeGameRules(rules = {}) {
  return {
    allowDrawTwoOnDrawTwo:
      rules.allowDrawTwoOnDrawTwo ?? DEFAULT_GAME_RULES.allowDrawTwoOnDrawTwo,
    allowDrawTwoOnDrawFour:
      rules.allowDrawTwoOnDrawFour ?? DEFAULT_GAME_RULES.allowDrawTwoOnDrawFour,
    allowDrawFourOnDrawTwo:
      rules.allowDrawFourOnDrawTwo ?? DEFAULT_GAME_RULES.allowDrawFourOnDrawTwo,
    allowDrawFourOnDrawFour:
      rules.allowDrawFourOnDrawFour ?? DEFAULT_GAME_RULES.allowDrawFourOnDrawFour,
    drawTwoSkipsTurn: rules.drawTwoSkipsTurn ?? DEFAULT_GAME_RULES.drawTwoSkipsTurn,
    drawFourSkipsTurn: rules.drawFourSkipsTurn ?? DEFAULT_GAME_RULES.drawFourSkipsTurn,
    allowSkipReverseOnDrawTwo:
      rules.allowSkipReverseOnDrawTwo ?? DEFAULT_GAME_RULES.allowSkipReverseOnDrawTwo,
  };
}

export function getPlayerCount(state) {
  return state.playerCount ?? state.hands?.length ?? MIN_PLAYERS;
}

export function clampPlayerCount(n) {
  return Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Math.floor(n)));
}

/** Largest equal starting hand that leaves MIN_DRAW_PILE_REMAINING + 1 top card in the deck. */
export function maxStartingHandForPlayers(playerCount) {
  const n = clampPlayerCount(playerCount);
  const reserved = MIN_DRAW_PILE_REMAINING + 1;
  const byDeck = Math.floor((DECK_SIZE - reserved) / n);
  return Math.min(MAX_STARTING_HAND, Math.max(MIN_STARTING_HAND, byDeck));
}

export function clampStartingHandSize(handSize, playerCount) {
  const max = maxStartingHandForPlayers(playerCount);
  const n = Math.floor(Number(handSize));
  if (!Number.isFinite(n)) return Math.min(STARTING_HAND_SIZE, max);
  return Math.min(max, Math.max(MIN_STARTING_HAND, n));
}

/** How a pending +2 penalty can be responded to after redirects. */
export const PENALTY_CHAIN = {
  STACK: "stack",
  POST_SKIP: "post_skip",
  POST_REVERSE_TIGHT: "post_reverse_tight",
  POST_REVERSE_OPEN: "post_reverse_open",
};

function randomFloat() {
  const c = globalThis.crypto;
  if (c?.getRandomValues) {
    const buf = new Uint32Array(1);
    c.getRandomValues(buf);
    return buf[0] / 0x100000000;
  }
  return Math.random();
}

function randomInt(maxExclusive) {
  if (maxExclusive <= 1) return 0;
  return Math.floor(randomFloat() * maxExclusive);
}

function createCard(color, value) {
  return { color, value, id: `${color}-${value}-${randomInt(0x7fffffff).toString(36)}` };
}

export function createDeck() {
  const deck = [];
  for (const color of COLORS) {
    deck.push(createCard(color, 0));
    for (let n = 1; n <= 9; n += 1) {
      deck.push(createCard(color, n));
      deck.push(createCard(color, n));
    }
    for (let i = 0; i < 2; i += 1) {
      deck.push(createCard(color, ACTIONS.SKIP));
      deck.push(createCard(color, ACTIONS.REVERSE));
      deck.push(createCard(color, ACTIONS.DRAW_TWO));
    }
  }
  for (let i = 0; i < 4; i += 1) {
    deck.push(createCard("Wild", ACTIONS.WILD));
    deck.push(createCard("Wild", ACTIONS.WILD_DRAW_FOUR));
  }
  return deck;
}

export function shuffleCards(cards) {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Move all played cards except the visible top card into the draw pile and shuffle. */
export function reshuffleDiscardIntoDraw(drawPile, discardPile, topCard) {
  const top = topCard ?? discardPile[discardPile.length - 1] ?? null;
  if (!top) {
    return { drawPile, discardPile };
  }
  const recycled =
    discardPile.length > 1
      ? discardPile.slice(0, -1)
      : discardPile.length === 1 && discardPile[0].id !== top.id
        ? [...discardPile]
        : [];
  if (recycled.length === 0) {
    return { drawPile, discardPile: top ? [top] : discardPile };
  }
  return {
    drawPile: shuffleCards([...drawPile, ...recycled]),
    discardPile: [top],
  };
}

function drawOne(drawPile, discardPile, topCard) {
  if (drawPile.length === 0) {
    const reshuffled = reshuffleDiscardIntoDraw(drawPile, discardPile, topCard);
    drawPile = reshuffled.drawPile;
    discardPile = reshuffled.discardPile;
    if (drawPile.length === 0) {
      return { drawPile, discardPile, drawn: null };
    }
  }
  const drawn = drawPile[0];
  return {
    drawPile: drawPile.slice(1),
    discardPile,
    drawn,
  };
}

/** How many cards can be drawn right now (reshuffling discard when needed). */
export function countDrawableCards(state, maxCount = Infinity) {
  let drawPile = [...state.drawPile];
  let discardPile = [...state.discardPile];
  let drawn = 0;

  for (let i = 0; i < maxCount; i += 1) {
    const result = drawOne(drawPile, discardPile, state.topCard);
    drawPile = result.drawPile;
    discardPile = result.discardPile;
    if (!result.drawn) break;
    drawn += 1;
  }

  return drawn;
}

export function canDrawAtLeast(state, amount = 1) {
  return countDrawableCards(state, amount) >= amount;
}

function chooseStartingTop(drawPile, discardPile) {
  const pile = [...drawPile];
  const numericIndexes = [];
  for (let i = 0; i < pile.length; i += 1) {
    if (typeof pile[i].value === "number") numericIndexes.push(i);
  }
  if (numericIndexes.length > 0) {
    const pickIndex = numericIndexes[randomInt(numericIndexes.length)];
    const [topCard] = pile.splice(pickIndex, 1);
    return { topCard, drawPile: pile, discardPile: [topCard] };
  }

  // Fallback (extremely unlikely): no number cards left.
  const topCard = pile[0] ?? null;
  return {
    topCard,
    drawPile: topCard ? pile.slice(1) : pile,
    discardPile: topCard ? [topCard] : [...discardPile],
  };
}

export function makeInitialGameState(
  playerCount = 3,
  startingHandSize = STARTING_HAND_SIZE,
  rules = DEFAULT_GAME_RULES
) {
  const n = clampPlayerCount(playerCount);
  const handSize = clampStartingHandSize(startingHandSize, n);
  let drawPile = shuffleCards(createDeck());
  const hands = Array.from({ length: n }, () => []);

  for (let r = 0; r < handSize; r += 1) {
    for (let p = 0; p < n; p += 1) {
      hands[p].push(drawPile[0]);
      drawPile = drawPile.slice(1);
    }
  }

  const start = chooseStartingTop(drawPile, []);
  const normalizedRules = normalizeGameRules(rules);

  return {
    hands,
    playerCount: n,
    startingHandSize: handSize,
    drawPile: start.drawPile,
    discardPile: start.discardPile,
    topCard: start.topCard,
    currentPlayer: 0,
    direction: 1,
    pendingDraw: 0,
    drawStackType: null,
    penaltyChainMode: null,
    penaltyAnchorColor: null,
    winner: null,
    turnCount: 0,
    initialDrawPileSize: start.drawPile.length,
    lastMove: null,
    mayPassAfterDraw: false,
    unoPending: null,
    unoMissed: Array(n).fill(false),
    foldedSlots: Array(n).fill(false),
    rules: normalizedRules,
  };
}

export function normalizeDirection(direction) {
  const d = Number(direction);
  return d === -1 ? -1 : 1;
}

export function displayTurnDirection(gameDirection) {
  return normalizeDirection(gameDirection);
}

export function getEffectiveTurnDirection(state) {
  return normalizeDirection(state.direction);
}

export function isSlotActive(state, slot) {
  if (!state.foldedSlots) return true;
  return !state.foldedSlots[slot];
}

/** Active seats in ascending slot index (stable baseline). */
export function getActivePlayerSlots(state) {
  const n = getPlayerCount(state);
  const slots = [];
  for (let i = 0; i < n; i += 1) {
    if (isSlotActive(state, i)) slots.push(i);
  }
  return slots;
}

/**
 * Turn order for UI: active players in the order they will play,
 * starting from currentPlayer, following state.direction (skips folded).
 */
export function getTurnCycle(state) {
  const active = getActivePlayerSlots(state);
  if (active.length === 0) return [];

  const dir = getEffectiveTurnDirection(state);
  let start = state.currentPlayer;
  if (!isSlotActive(state, start)) {
    start = active[0];
  }

  const cycle = [start];
  let cur = start;
  let guard = 0;
  const maxSteps = getPlayerCount(state);

  while (guard < maxSteps) {
    const next = nextActivePlayerIndex(cur, dir, state, 1);
    if (next === start) break;
    cycle.push(next);
    cur = next;
    guard += 1;
  }

  return cycle;
}

/**
 * UI-friendly cycle: keep true order, but anchor on the last acting player when available.
 * Example after P1 plays Reverse: P1 -> P4 -> P3 -> P2.
 */
export function getDisplayTurnCycle(state) {
  const cycle = getTurnCycle(state);
  if (cycle.length <= 1) return cycle;
  const anchor = state.lastMove?.playerIndex;
  if (anchor == null) return cycle;
  const idx = cycle.indexOf(anchor);
  if (idx <= 0) return cycle;
  return [...cycle.slice(idx), ...cycle.slice(0, idx)];
}

export function nextActivePlayerIndex(current, direction, state, steps = 1) {
  const n = getPlayerCount(state);
  if (!state.foldedSlots || !state.foldedSlots.some(Boolean)) {
    return nextPlayerIndex(current, direction, n, steps);
  }
  let idx = current;
  let remaining = steps;
  let guard = 0;
  while (remaining > 0 && guard <= n) {
    idx = nextPlayerIndex(idx, direction, n, 1);
    guard += 1;
    if (isSlotActive(state, idx)) remaining -= 1;
  }
  return idx;
}

/** Shuffle a folded player's hand into the draw pile and mark the slot inactive. */
export function foldSlotIntoDrawPile(state, slot) {
  const hand = handAsArray(state.hands[slot]);
  if (hand.length === 0 && state.foldedSlots?.[slot]) return state;

  const foldedSlots = state.foldedSlots
    ? [...state.foldedSlots]
    : Array(getPlayerCount(state)).fill(false);
  foldedSlots[slot] = true;

  const hands = state.hands.map((h, i) => (i === slot ? [] : [...handAsArray(h)]));
  const drawPile = shuffleCards([...state.drawPile, ...hand]);

  let next = {
    ...state,
    hands,
    drawPile,
    foldedSlots,
    unoPending:
      state.unoPending?.playerIndex === slot ? null : state.unoPending,
  };

  if (next.currentPlayer === slot) {
    // The folding player owed any pending penalty / draw-then-pass window; drop it.
    next = {
      ...next,
      mayPassAfterDraw: false,
      pendingDraw: 0,
      drawStackType: null,
      penaltyChainMode: null,
      penaltyAnchorColor: null,
      currentPlayer: nextActivePlayerIndex(slot, next.direction, next, 1),
    };
  }

  const remaining = getActivePlayerSlots(next);
  if (remaining.length === 1 && next.winner === null) {
    next = { ...next, winner: remaining[0], currentPlayer: remaining[0] };
  }

  return next;
}

export function ensureActiveCurrentPlayer(state) {
  if (!state.foldedSlots?.some(Boolean)) return state;
  const n = getPlayerCount(state);
  let current = state.currentPlayer;
  let guard = 0;
  while (!isSlotActive(state, current) && guard < n) {
    current = nextActivePlayerIndex(current, state.direction, state, 1);
    guard += 1;
  }
  if (current === state.currentPlayer) return state;
  return { ...state, currentPlayer: current };
}

function handAsArray(hand) {
  return Array.isArray(hand) ? hand : [];
}

function emptyUnoMissed(n) {
  return Array(n).fill(false);
}

export function applyCallUno(state, playerIndex) {
  if (handAsArray(state.hands[playerIndex]).length !== 2) {
    return state;
  }
  const n = getPlayerCount(state);
  const unoMissed = state.unoMissed ? [...state.unoMissed] : emptyUnoMissed(n);
  unoMissed[playerIndex] = false;
  return {
    ...state,
    unoPending: { playerIndex, called: true },
    unoMissed,
    lastMove: { type: "uno", playerIndex },
  };
}

/** Close another player's pending pre-call only after their hand changes away from 2 cards. */
function closeUnoWindowForOtherPlayer(state, actingPlayerIndex) {
  const pending = state.unoPending;
  if (!pending || pending.playerIndex === actingPlayerIndex) {
    return state;
  }
  if (handAsArray(state.hands[pending.playerIndex]).length === 2) {
    return state;
  }
  return { ...state, unoPending: null };
}

function setMissedUnoIfNoPreCall(state, playerIndex) {
  const n = getPlayerCount(state);
  const unoMissed = state.unoMissed ? [...state.unoMissed] : emptyUnoMissed(n);
  const calledBeforePlay =
    state.unoPending?.playerIndex === playerIndex && state.unoPending.called;
  if (!calledBeforePlay) {
    unoMissed[playerIndex] = true;
  }
  return {
    ...state,
    unoMissed,
    unoPending: state.unoPending?.playerIndex === playerIndex ? null : state.unoPending,
  };
}

function syncUnoStateForHandSize(state, playerIndex) {
  const len = handAsArray(state.hands[playerIndex]).length;
  const n = getPlayerCount(state);
  const unoMissed = state.unoMissed ? [...state.unoMissed] : emptyUnoMissed(n);
  if (len > 2) {
    unoMissed[playerIndex] = false;
    return {
      ...state,
      unoMissed,
      unoPending: state.unoPending?.playerIndex === playerIndex ? null : state.unoPending,
    };
  }
  if (len === 2) {
    return {
      ...state,
      unoMissed,
    };
  }
  if (len === 1) {
    return setMissedUnoIfNoPreCall(state, playerIndex);
  }
  return state;
}

/** When a player's turn ends, close successful UNO pre-calls after they reach 1 card. */
function endPlayerTurn(state, leavingPlayer) {
  const n = getPlayerCount(state);
  const unoMissed = state.unoMissed ? [...state.unoMissed] : emptyUnoMissed(n);
  let unoPending = state.unoPending;

  if (
    unoPending?.playerIndex === leavingPlayer &&
    unoPending.called &&
    handAsArray(state.hands[leavingPlayer]).length !== 2
  ) {
    unoPending = null;
  }

  return { ...state, unoPending, unoMissed };
}

export function needsUnoCall(state, playerIndex) {
  if (handAsArray(state.hands[playerIndex]).length !== 2 || state.winner !== null) {
    return false;
  }
  const pending = state.unoPending;
  if (pending?.playerIndex === playerIndex && pending.called) {
    return false;
  }
  return !state.unoMissed?.[playerIndex];
}

export function hasPlayableCard(state, playerIndex) {
  return handAsArray(state.hands[playerIndex]).some((card) =>
    isPlayable(card, state, playerIndex)
  );
}

export function isWild(card) {
  return card.value === ACTIONS.WILD || card.value === ACTIONS.WILD_DRAW_FOUR;
}

function stackType(card) {
  if (card.value === ACTIONS.DRAW_TWO) return ACTIONS.DRAW_TWO;
  if (card.value === ACTIONS.WILD_DRAW_FOUR) return ACTIONS.WILD_DRAW_FOUR;
  return null;
}

function penaltyChainMode(state) {
  return state.penaltyChainMode ?? PENALTY_CHAIN.STACK;
}

function gameRules(state) {
  return normalizeGameRules(state?.rules);
}

function canStackDrawOnPending(card, state) {
  if (state.pendingDraw <= 0 || !state.drawStackType) return false;
  const rules = gameRules(state);
  if (state.drawStackType === ACTIONS.DRAW_TWO) {
    if (card.value === ACTIONS.DRAW_TWO) {
      return rules.allowDrawTwoOnDrawTwo && penaltyChainMode(state) === PENALTY_CHAIN.STACK;
    }
    if (card.value === ACTIONS.WILD_DRAW_FOUR) {
      return rules.allowDrawFourOnDrawTwo;
    }
    return false;
  }
  if (state.drawStackType === ACTIONS.WILD_DRAW_FOUR) {
    if (card.value === ACTIONS.WILD_DRAW_FOUR) {
      return rules.allowDrawFourOnDrawFour;
    }
    if (card.value === ACTIONS.DRAW_TWO) {
      return (
        rules.allowDrawTwoOnDrawFour &&
        !!state.topCard?.color &&
        card.color === state.topCard.color
      );
    }
    return false;
  }
  return false;
}

/** Skip / reverse played to pass a pending +2 to another player. */
export function canRedirectPenalty(card, state) {
  if (state.pendingDraw <= 0 || state.drawStackType !== ACTIONS.DRAW_TWO) return false;
  const rules = gameRules(state);
  if (!rules.allowSkipReverseOnDrawTwo) return false;
  const anchor = state.penaltyAnchorColor;
  const mode = penaltyChainMode(state);

  if (card.value === ACTIONS.SKIP) {
    if (mode === PENALTY_CHAIN.POST_SKIP) return true;
    if (mode === PENALTY_CHAIN.POST_REVERSE_OPEN) return true;
    if (mode === PENALTY_CHAIN.STACK || mode === PENALTY_CHAIN.POST_REVERSE_TIGHT) {
      return card.color === anchor;
    }
    return false;
  }

  if (card.value === ACTIONS.REVERSE) {
    if (mode === PENALTY_CHAIN.POST_REVERSE_OPEN) return true;
    if (mode === PENALTY_CHAIN.STACK || mode === PENALTY_CHAIN.POST_REVERSE_TIGHT) {
      return card.color === anchor;
    }
    return false;
  }

  return false;
}

export function isPlayable(card, state, playerIndex = state.currentPlayer) {
  if (state.pendingDraw > 0) {
    return canStackDrawOnPending(card, state) || canRedirectPenalty(card, state);
  }
  if (isWild(card)) return true;
  if (!state.topCard) return true;
  if (card.color === state.topCard.color) return true;
  if (card.value === state.topCard.value) return true;
  return false;
}

function appendDrawMove(moves, state) {
  if (state.mayPassAfterDraw) return;
  const amount = state.pendingDraw > 0 ? state.pendingDraw : 1;
  if (state.pendingDraw > 0) {
    moves.push({ type: "draw", amount });
    return;
  }
  if (canDrawAtLeast(state, 1)) {
    moves.push({ type: "draw", amount: 1 });
  }
}

export function getValidMoves(state, playerIndex) {
  if (
    state.currentPlayer === playerIndex &&
    state.unoMissed?.[playerIndex] &&
    handAsArray(state.hands[playerIndex]).length > 0
  ) {
    return [{ type: "draw", amount: 2, unoPenalty: true }];
  }

  const hand = handAsArray(state.hands[playerIndex]);
  const playable = hand
    .map((card, cardIndex) => ({ type: "play", cardIndex, card }))
    .filter((m) => isPlayable(m.card, state, playerIndex));

  const moves = [...playable];
  appendDrawMove(moves, state);
  return moves;
}

export function nextPlayerIndex(current, direction, playerCount, steps = 1) {
  const n = playerCount;
  return ((current + direction * steps) % n + n) % n;
}

export function applyPassTurn(state, playerIndex) {
  if (state.currentPlayer !== playerIndex || !state.mayPassAfterDraw) {
    return state;
  }
  const afterEnd = endPlayerTurn(state, playerIndex);
  return {
    ...afterEnd,
    mayPassAfterDraw: false,
    currentPlayer: nextActivePlayerIndex(playerIndex, afterEnd.direction, afterEnd, 1),
    turnCount: afterEnd.turnCount + 1,
    lastMove: { type: "pass", playerIndex },
  };
}

export function applyDraw(state, playerIndex, amount) {
  let base = closeUnoWindowForOtherPlayer(state, playerIndex);
  const rules = gameRules(base);
  const forceEndFromPenalty =
    base.pendingDraw > 0 &&
    ((base.drawStackType === ACTIONS.DRAW_TWO && rules.drawTwoSkipsTurn) ||
      (base.drawStackType === ACTIONS.WILD_DRAW_FOUR && rules.drawFourSkipsTurn));

  let drawPile = [...base.drawPile];
  let discardPile = [...base.discardPile];
  const hands = base.hands.map((h) => [...handAsArray(h)]);

  for (let i = 0; i < amount; i += 1) {
    const d = drawOne(drawPile, discardPile, base.topCard);
    drawPile = d.drawPile;
    discardPile = d.discardPile;
    if (!d.drawn) break;
    hands[playerIndex].push(d.drawn);
  }

  const topCard = discardPile[discardPile.length - 1] ?? base.topCard;

  let afterDraw = {
    ...base,
    hands,
    drawPile,
    discardPile,
    topCard,
    pendingDraw: 0,
    drawStackType: null,
    penaltyChainMode: null,
    penaltyAnchorColor: null,
    mayPassAfterDraw: false,
  };
  if (base.unoMissed?.[playerIndex]) {
    const unoMissed = [...base.unoMissed];
    unoMissed[playerIndex] = false;
    afterDraw = { ...afterDraw, unoMissed };
  }
  afterDraw = syncUnoStateForHandSize(afterDraw, playerIndex);

  if (forceEndFromPenalty) {
    const afterEnd = endPlayerTurn(afterDraw, playerIndex);
    return {
      ...afterEnd,
      currentPlayer: nextActivePlayerIndex(playerIndex, afterEnd.direction, afterEnd, 1),
      turnCount: base.turnCount + 1,
      lastMove: { type: "draw", playerIndex, amount, endedTurn: true },
    };
  }

  const canPlay = hasPlayableCard(afterDraw, playerIndex);

  if (canPlay) {
    return {
      ...afterDraw,
      currentPlayer: playerIndex,
      mayPassAfterDraw: true,
      turnCount: base.turnCount + 1,
      lastMove: { type: "draw", playerIndex, amount, endedTurn: false },
    };
  }

  const afterEnd = endPlayerTurn(afterDraw, playerIndex);
  return {
    ...afterEnd,
    currentPlayer: nextActivePlayerIndex(playerIndex, afterEnd.direction, afterEnd, 1),
    turnCount: base.turnCount + 1,
    lastMove: { type: "draw", playerIndex, amount, endedTurn: true },
  };
}

export function applyPlay(state, playerIndex, cardIndex, chosenColor = null) {
  if (chosenColor != null && !COLORS.includes(chosenColor)) {
    throw new Error("Invalid color.");
  }
  const working = closeUnoWindowForOtherPlayer(state, playerIndex);
  const hands = working.hands.map((h) => [...handAsArray(h)]);
  const hand = hands[playerIndex];
  const card = hand[cardIndex];
  if (!card) {
    throw new Error("Invalid card.");
  }
  hand.splice(cardIndex, 1);

  const topCard = isWild(card) ? { ...card, color: chosenColor ?? COLORS[0] } : card;
  const discardPile = [...working.discardPile, topCard];
  let direction = working.direction;
  let pendingDraw = working.pendingDraw;
  let drawStackType = working.drawStackType;
  let penaltyChain = working.penaltyChainMode;
  let penaltyAnchor = working.penaltyAnchorColor;
  let nextPlayer = playerIndex;

  const redirectingPenalty =
    working.pendingDraw > 0 &&
    working.drawStackType === ACTIONS.DRAW_TWO &&
    canRedirectPenalty(card, working);

  if (redirectingPenalty && card.value === ACTIONS.SKIP) {
    penaltyChain = PENALTY_CHAIN.POST_SKIP;
    nextPlayer = nextActivePlayerIndex(playerIndex, direction, working, 1);
  } else if (redirectingPenalty && card.value === ACTIONS.REVERSE) {
    direction *= -1;
    const mode = penaltyChainMode(working);
    if (mode === PENALTY_CHAIN.STACK) {
      penaltyChain = PENALTY_CHAIN.POST_REVERSE_TIGHT;
    } else if (mode === PENALTY_CHAIN.POST_REVERSE_TIGHT) {
      penaltyChain = PENALTY_CHAIN.POST_REVERSE_OPEN;
    } else {
      penaltyChain = PENALTY_CHAIN.POST_REVERSE_TIGHT;
    }
    nextPlayer = nextActivePlayerIndex(playerIndex, direction, working, 1);
  } else {
    let stepAdvance = 1;

    if (pendingDraw === 0) {
      if (card.value === ACTIONS.REVERSE) {
        if (getActivePlayerSlots(working).length === 2) {
          // Two players left: Reverse acts as Skip.
          stepAdvance = 2;
        } else {
          direction *= -1;
        }
      } else if (card.value === ACTIONS.SKIP) {
        stepAdvance = 2;
      }
    }

    const st = stackType(card);
    if (st === ACTIONS.DRAW_TWO) {
      if (pendingDraw > 0) {
        pendingDraw += 2;
      } else {
        pendingDraw = 2;
      }
      drawStackType = ACTIONS.DRAW_TWO;
      penaltyChain = PENALTY_CHAIN.STACK;
      penaltyAnchor = topCard.color;
    } else if (st === ACTIONS.WILD_DRAW_FOUR) {
      if (pendingDraw > 0) {
        pendingDraw += 4;
      } else {
        pendingDraw = 4;
      }
      drawStackType = ACTIONS.WILD_DRAW_FOUR;
      penaltyChain = PENALTY_CHAIN.STACK;
      penaltyAnchor = null;
    }

    if (pendingDraw > 0 && st !== null) {
      nextPlayer = nextActivePlayerIndex(playerIndex, direction, working, 1);
    } else {
      nextPlayer = nextActivePlayerIndex(playerIndex, direction, working, stepAdvance);
    }
  }

  const winner = hand.length === 0 ? playerIndex : null;
  const unoPending = working.unoPending;
  const unoMissed = working.unoMissed
    ? [...working.unoMissed]
    : emptyUnoMissed(getPlayerCount(working));

  let next = {
    ...working,
    hands,
    topCard,
    discardPile,
    direction,
    pendingDraw,
    drawStackType,
    penaltyChainMode: pendingDraw > 0 ? penaltyChain : null,
    penaltyAnchorColor: pendingDraw > 0 && drawStackType === ACTIONS.DRAW_TWO ? penaltyAnchor : null,
    mayPassAfterDraw: false,
    unoPending,
    unoMissed,
    lastMove: { type: "play", playerIndex, card, chosenColor: topCard.color },
  };
  next = syncUnoStateForHandSize(next, playerIndex);

  if (winner !== null) {
    return {
      ...next,
      currentPlayer: playerIndex,
      winner,
      turnCount: working.turnCount + 1,
    };
  }

  const turnEndsNow = nextPlayer !== playerIndex;
  const withTurn = turnEndsNow ? endPlayerTurn(next, playerIndex) : next;

  return {
    ...withTurn,
    currentPlayer: nextPlayer,
    turnCount: working.turnCount + 1,
  };
}

export function autoChooseColor(hand) {
  const counts = Object.fromEntries(COLORS.map((c) => [c, 0]));
  hand.forEach((card) => {
    if (counts[card.color] !== undefined) counts[card.color] += 1;
  });
  return COLORS.reduce((best, c) => (counts[c] > counts[best] ? c : best), COLORS[0]);
}

export function chooseAIMove(state, playerIndex) {
  const moves = getValidMoves(state, playerIndex);
  const hand = handAsArray(state.hands[playerIndex]);

  if (state.pendingDraw > 0) {
    const stackMoves = moves.filter(
      (m) => m.type === "play" && canStackDrawOnPending(m.card, state)
    );
    if (stackMoves.length > 0) return stackMoves[0];

    const redirectMoves = moves.filter(
      (m) => m.type === "play" && canRedirectPenalty(m.card, state)
    );
    if (redirectMoves.length > 0) return redirectMoves[0];

    return moves.find((m) => m.type === "draw");
  }

  const priorities = [ACTIONS.WILD_DRAW_FOUR, ACTIONS.DRAW_TWO, ACTIONS.SKIP, ACTIONS.REVERSE];
  for (const p of priorities) {
    const candidate = moves.find(
      (m) => m.type === "play" && m.card.value === p && isPlayable(m.card, state, playerIndex)
    );
    if (candidate) return candidate;
  }

  const numeric = moves.find((m) => m.type === "play" && typeof m.card.value === "number");
  if (numeric) return numeric;

  const wild = moves.find((m) => m.type === "play");
  if (wild) return wild;

  if (canDrawAtLeast(state, 1)) {
    return { type: "draw", amount: 1, card: hand[0] ?? null };
  }

  return moves[0] ?? { type: "draw", amount: 1 };
}

const SPRITE_EXTENSIONS = ["jpg", "png", "webp", "jpeg"];

function spriteVariants(baseName) {
  return SPRITE_EXTENSIONS.map((ext) => `${baseName}.${ext}`);
}

function dedupeSprites(files) {
  return [...new Set(files)];
}

export function spriteCandidates(card) {
  if (!card) return [];
  if (card.value === ACTIONS.WILD) return spriteVariants("Wild");
  if (card.value === ACTIONS.WILD_DRAW_FOUR) return spriteVariants("Wild_Draw_4");

  const color = card.color;
  const value = card.value;
  if (typeof value === "number") return spriteVariants(`${color}_${value}`);
  if (value === ACTIONS.SKIP) return spriteVariants(`${color}_Skip`);
  if (value === ACTIONS.REVERSE) {
    return dedupeSprites([
      ...spriteVariants(`${color}_Reverse`),
      ...spriteVariants(`${color.toUpperCase()}_Reverse`),
    ]);
  }
  if (value === ACTIONS.DRAW_TWO) return spriteVariants(`${color}_Draw_2`);
  return [];
}

export function allSpriteCandidates() {
  const files = [];
  files.push(...spriteVariants("Wild"));
  files.push(...spriteVariants("Wild_Draw_4"));
  for (const color of COLORS) {
    for (let n = 0; n <= 9; n += 1) {
      files.push(...spriteVariants(`${color}_${n}`));
    }
    files.push(...spriteVariants(`${color}_Skip`));
    files.push(...spriteVariants(`${color}_Draw_2`));
    files.push(...spriteVariants(`${color}_Reverse`));
    files.push(...spriteVariants(`${color.toUpperCase()}_Reverse`));
  }
  return dedupeSprites(files);
}

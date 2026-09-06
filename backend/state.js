const VISIBLE_DISCARD = 3;

/**
 * Hide the draw pile's contents but keep its length (the client only reads
 * `drawPile.length`), and trim the discard pile to the cards the UI renders.
 */
function hidePiles(state) {
  const drawPile = Array.isArray(state.drawPile) ? state.drawPile : [];
  const discardPile = Array.isArray(state.discardPile) ? state.discardPile : [];
  return {
    drawPile: drawPile.map((_, i) => ({ id: `hidden-${i}`, hidden: true })),
    drawPileCount: drawPile.length,
    discardPile: discardPile.slice(-VISIBLE_DISCARD),
  };
}

/** Per-player view: full hand for self, counts only for opponents. */
export function serializeStateForPlayer(state, viewerSlot) {
  if (!state) return null;
  return {
    ...state,
    ...hidePiles(state),
    hands: state.hands.map((hand, i) =>
      i === viewerSlot ? hand : { hidden: true, count: hand.length }
    ),
  };
}

/** Spectators see counts only for every hand. */
export function serializeStateForSpectator(state) {
  if (!state) return null;
  return {
    ...state,
    ...hidePiles(state),
    hands: state.hands.map((hand) => ({ hidden: true, count: hand.length })),
  };
}

export function normalizeHand(hand) {
  if (Array.isArray(hand)) return hand;
  if (hand?.hidden) return [];
  return [];
}

export function handCount(hand) {
  if (Array.isArray(hand)) return hand.length;
  return hand?.count ?? 0;
}

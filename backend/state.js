/** Per-player view: full hand for self, counts only for opponents. */
export function serializeStateForPlayer(state, viewerSlot) {
  if (!state) return null;
  return {
    ...state,
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

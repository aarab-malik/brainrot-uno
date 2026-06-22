export function handCount(hand) {
  if (Array.isArray(hand)) return hand.length;
  if (hand?.hidden) return hand.count ?? 0;
  return 0;
}

export function getHandCards(hand) {
  return Array.isArray(hand) ? hand : [];
}

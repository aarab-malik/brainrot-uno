import { handCount } from "./hand";

/** Detect how many cards a player gained from the latest draw move. */
export function getDrawAnimationInfo(prevState, nextState) {
  if (!prevState || !nextState?.lastMove) return null;
  if (nextState.lastMove.type !== "draw") return null;

  const playerIndex = nextState.lastMove.playerIndex;
  if (playerIndex == null) return null;

  const before = handCount(prevState.hands[playerIndex]);
  const after = handCount(nextState.hands[playerIndex]);
  const count = after - before;
  if (count <= 0) return null;

  return { playerIndex, count };
}

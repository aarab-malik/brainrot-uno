/** Screen-space degrees: 0 = right, 90 = bottom. */
export function getSeatAngles(playerCount, humanIndex) {
  const step = 360 / playerCount;
  const base = 90 - humanIndex * step;
  return Array.from({ length: playerCount }, (_, i) => {
    const deg = base + i * step;
    return ((deg % 360) + 360) % 360;
  });
}

/** Seat opponents on the top arc only (human plays from dock below the table). */
export function getOpponentSeatAngles(opponentCount) {
  if (opponentCount <= 0) return [];
  if (opponentCount === 1) return [270];
  const startDeg = 200;
  const endDeg = 340;
  const span = endDeg - startDeg;
  return Array.from({ length: opponentCount }, (_, i) => startDeg + (span * i) / (opponentCount - 1));
}

/**
 * Opponents around the table in play order, starting from the player after `humanPlayer`.
 * Keeps visual seat order aligned with turn order for every viewer.
 */
export function getOpponentSlotsInTableOrder(turnCycle, humanPlayer, isSpectator) {
  if (!turnCycle?.length) return [];
  if (isSpectator) return [...turnCycle];

  const humanIdx = turnCycle.indexOf(humanPlayer);
  if (humanIdx === -1) {
    return turnCycle.filter((slot) => slot !== humanPlayer);
  }

  const afterHuman = [...turnCycle.slice(humanIdx + 1), ...turnCycle.slice(0, humanIdx + 1)];
  return afterHuman.filter((slot) => slot !== humanPlayer);
}

export function opponentSeatRadius(playerCount) {
  if (playerCount <= 3) return 40;
  if (playerCount <= 5) return 42;
  if (playerCount <= 8) return 44;
  if (playerCount <= 12) return 45;
  return 46;
}

export function seatPositionStyle(angleDeg, radiusPercent = 40) {
  const rad = (angleDeg * Math.PI) / 180;
  const x = 50 + radiusPercent * Math.cos(rad);
  const y = 50 + radiusPercent * Math.sin(rad);
  return {
    left: `${x}%`,
    top: `${y}%`,
    transform: "translate(-50%, -50%)",
  };
}

export function defaultHumanSlot(playerCount) {
  return playerCount - 1;
}

/** Ring / HUD turn order: human at bottom, opponents on the same arc as the table. */
export function getRingSeatAngles(playerCount, humanIndex) {
  const angles = new Array(playerCount);
  const human = humanIndex ?? defaultHumanSlot(playerCount);
  angles[human] = 270;

  const opponents = Array.from({ length: playerCount }, (_, i) => i).filter((i) => i !== human);
  const oppAngles = getOpponentSeatAngles(opponents.length);
  opponents.forEach((slot, idx) => {
    angles[slot] = oppAngles[idx] ?? 270;
  });

  return angles;
}

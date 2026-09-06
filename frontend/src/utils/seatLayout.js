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
  // the arc widens as the table fills: top only for a few, down both sides for many
  let startDeg = 200;
  let endDeg = 340;
  if (opponentCount > 10) {
    startDeg = 150;
    endDeg = 390;
  } else if (opponentCount > 6) {
    startDeg = 170;
    endDeg = 370;
  } else if (opponentCount > 3) {
    startDeg = 185;
    endDeg = 355;
  }
  return spaceByArcLength(startDeg, endDeg, opponentCount, 1.9);
}

/**
 * Equal angles bunch seats on the short sides of a wide ellipse. Walk the arc,
 * measure real distance for the given width/height ratio, and pick points at
 * equal arc length. Returned values are parametric degrees for seatPositionStyle.
 */
function spaceByArcLength(startDeg, endDeg, count, aspect) {
  const steps = 720;
  const toRad = Math.PI / 180;
  const pts = [];
  let total = 0;
  let prev = null;
  for (let s = 0; s <= steps; s += 1) {
    const deg = startDeg + ((endDeg - startDeg) * s) / steps;
    const x = aspect * Math.cos(deg * toRad);
    const y = Math.sin(deg * toRad);
    if (prev) total += Math.hypot(x - prev.x, y - prev.y);
    pts.push({ deg, x, y, dist: total });
    prev = { x, y };
  }
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const target = (total * i) / (count - 1);
    const p = pts.find((q) => q.dist >= target) ?? pts[pts.length - 1];
    out.push(((p.deg % 360) + 360) % 360);
  }
  return out;
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
  if (playerCount <= 8) return 45;
  if (playerCount <= 12) return 47;
  return 48;
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

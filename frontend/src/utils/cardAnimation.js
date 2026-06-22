export const FLY_MS = 580;
export const FLIP_MS = 300;
export const DRAW_FLY_MS = 480;

/** Match flying card size to rendered hand cards (respects zoom via rem CSS vars). */
export function getFlightCardSize(root) {
  const sample =
    root?.querySelector?.(".human-hand .card") ??
    root?.querySelector?.(".draw-pile-card") ??
    root?.querySelector?.(".card");
  if (sample) {
    const r = sample.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      return { w: r.width, h: r.height };
    }
  }
  if (typeof document !== "undefined") {
    const style = getComputedStyle(document.documentElement);
    const w = parseFloat(style.getPropertyValue("--card-w"));
    const h = parseFloat(style.getPropertyValue("--card-h"));
    if (w > 0 && h > 0) return { w, h };
  }
  return { w: 72, h: 108 };
}

export function measureAnchor(root, name) {
  if (!root) return null;
  const el = root.querySelector(`[data-anchor="${name}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    x: r.left + r.width / 2,
    y: r.top + r.height / 2,
    w: r.width,
    h: r.height,
  };
}

export function opponentAnchor(playerIndex) {
  return `opponent-${playerIndex}`;
}

export function humanCardAnchor(cardIndex) {
  return `human-card-${cardIndex}`;
}

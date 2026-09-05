import { memo } from "react";
import CardSprite from "../components/CardSprite";

const MAX_VISIBLE_CARDS = 8;

export function seatHue(playerIndex) {
  const hues = [198, 268, 330, 22, 150, 45, 210, 300, 0, 120, 240, 60, 180, 285, 15, 100];
  return hues[playerIndex % hues.length];
}

export function PlayerTag({ name, count, isActive, playerIndex, isYou = false, className = "" }) {
  const initial = (name ?? "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <div className={`player-tag ${isActive ? "is-active" : ""} ${isYou ? "is-you" : ""} ${className}`}>
      <span className="player-tag-name" title={name}>
        {name}
      </span>
      <span className="player-tag-row">
        <span className="player-avatar" style={{ "--hue": seatHue(playerIndex) }} aria-hidden="true">
          {initial}
        </span>
        <span className="player-count" aria-label={`${count} cards`}>
          {count}
        </span>
      </span>
    </div>
  );
}

function OpponentSeat({
  name,
  cardCount,
  isActive,
  className = "",
  style,
  playerIndex,
  hidden,
  compact = false,
  extraCompact = false,
  showUnoShout = false,
}) {
  const count = Math.max(0, cardCount);
  const visible = Math.min(count, MAX_VISIBLE_CARDS);
  const extra = count - visible;

  return (
    <div
      className={`opponent-seat ${className} ${compact ? "compact" : ""} ${extraCompact ? "extra-compact" : ""} ${isActive ? "active-turn" : ""}`}
      style={style}
    >
      {showUnoShout ? (
        <div className="uno-shout-burst uno-shout-opponent" aria-live="polite">
          UNO!
        </div>
      ) : null}
      <PlayerTag name={name} count={count} isActive={isActive} playerIndex={playerIndex} />
      <div
        className={`opponent-hand-fan ${hidden ? "anchor-hidden" : ""}`}
        data-anchor={`opponent-${playerIndex}`}
        role="img"
        aria-label={`${name}: ${count} cards`}
      >
        {visible === 0 ? (
          <span className="opponent-empty-hand">No cards</span>
        ) : (
          Array.from({ length: visible }, (_, i) => (
            <div key={i} className="opponent-fan-slot" style={{ "--fan-i": i, "--fan-n": visible }}>
              <CardSprite showBack className="opponent-fan-card" />
            </div>
          ))
        )}
        {extra > 0 ? <span className="opponent-fan-more">+{extra}</span> : null}
      </div>
    </div>
  );
}

export default memo(OpponentSeat);

import CardSprite from "../components/CardSprite";

const MAX_VISIBLE_CARDS = 8;

export default function OpponentSeat({
  name,
  cardCount,
  isActive,
  className = "",
  style,
  playerIndex,
  hidden,
  compact = false,
  extraCompact = false,
  nameOnTop = false,
  showUnoShout = false,
}) {
  const count = Math.max(0, cardCount);
  const visible = Math.min(count, MAX_VISIBLE_CARDS);
  const extra = count - visible;

  return (
    <div
      className={`opponent-seat ${className} ${compact ? "compact" : ""} ${extraCompact ? "extra-compact" : ""} ${isActive ? "active-turn" : ""} ${nameOnTop ? "name-on-top" : ""}`}
      style={style}
    >
      {showUnoShout ? (
        <div className="uno-shout-burst uno-shout-opponent" aria-live="polite">
          UNO!
        </div>
      ) : null}
      <div className="player-badge">
        <span className="player-badge-name" title={name}>
          {name}
        </span>
        <span className="hand-count-tag">{count}</span>
      </div>
      <div
        className={`opponent-hand-fan ${hidden ? "anchor-hidden" : ""}`}
        data-anchor={`opponent-${playerIndex}`}
        aria-label={`${count} cards`}
      >
        {visible === 0 ? (
          <span className="opponent-empty-hand">No cards</span>
        ) : (
          Array.from({ length: visible }, (_, i) => (
            <div
              key={i}
              className="opponent-fan-slot"
              style={{ "--fan-i": i, "--fan-n": visible }}
            >
              <CardSprite showBack className="opponent-fan-card" />
            </div>
          ))
        )}
        {extra > 0 ? <span className="opponent-fan-more">+{extra}</span> : null}
      </div>
    </div>
  );
}

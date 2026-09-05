import { memo, useId } from "react";
import { ACTIONS } from "@shared/gameLogic.js";

/*
 * Card faces drawn as SVG. viewBox is 100 x 150 so every measurement below is
 * a percentage of card width. The white ellipse is printed twice with a small
 * offset (the riso misregistration) so cards match the rest of the theme.
 */

const INK = {
  Red: "#f0433a",
  Blue: "#1b6bd6",
  Green: "#1fa35e",
  Yellow: "#f5c518",
  Wild: "#17181c",
};
const DARK = "#17181c";
const FONT = "'Bricolage Grotesque', 'Archivo Black', Impact, sans-serif";

function inkFor(card) {
  if (!card) return INK.Wild;
  if (card.value === ACTIONS.WILD || card.value === ACTIONS.WILD_DRAW_FOUR) return INK.Wild;
  return INK[card.color] ?? INK.Wild;
}

function cornerText(card) {
  const v = card.value;
  if (typeof v === "number") return String(v);
  if (v === ACTIONS.DRAW_TWO) return "+2";
  if (v === ACTIONS.WILD_DRAW_FOUR) return "+4";
  if (v === ACTIONS.SKIP) return "⊘"; // ⊘
  if (v === ACTIONS.REVERSE) return "⇄"; // ⇄
  return "";
}

/* ---- centre glyphs ------------------------------------------------- */

function Numeral({ value }) {
  const underline = value === 6 || value === 9;
  const common = {
    x: 50,
    y: 75,
    textAnchor: "middle",
    dominantBaseline: "central",
    fontFamily: FONT,
    fontWeight: 800,
    fontSize: 70,
    style: { letterSpacing: "-0.04em" },
  };
  return (
    <>
      {/* offset dark shadow, then white numeral with a dark edge */}
      <text {...common} transform="translate(3 3)" fill={DARK} opacity="0.55">
        {value}
      </text>
      <text {...common} fill="#fff" stroke={DARK} strokeWidth="2.5" paintOrder="stroke fill">
        {value}
      </text>
      {underline ? <rect x="37" y="106" width="26" height="5" rx="2" fill="#fff" stroke={DARK} strokeWidth="1.5" /> : null}
    </>
  );
}

function SkipGlyph() {
  return (
    <g fill="none" strokeLinecap="round">
      <g stroke={DARK} strokeWidth="14" opacity="0.5" transform="translate(3 3)">
        <circle cx="50" cy="75" r="20" />
        <line x1="36" y1="61" x2="64" y2="89" />
      </g>
      <g stroke={DARK} strokeWidth="13">
        <circle cx="50" cy="75" r="20" />
        <line x1="36" y1="61" x2="64" y2="89" />
      </g>
      <g stroke="#fff" strokeWidth="8">
        <circle cx="50" cy="75" r="20" />
        <line x1="36" y1="61" x2="64" y2="89" />
      </g>
    </g>
  );
}

function ReverseGlyph() {
  const d1 = "M32 62 h26 l-6 -9 h9 l11 15 -11 15 h-9 l6 -9 h-26 z";
  const d2 = "M68 88 h-26 l6 9 h-9 l-11 -15 11 -15 h9 l-6 9 h26 z";
  return (
    <g>
      <g fill={DARK} opacity="0.5" transform="translate(3 3)">
        <path d={d1} />
        <path d={d2} />
      </g>
      <g fill="#fff" stroke={DARK} strokeWidth="2.5" strokeLinejoin="round" paintOrder="stroke fill">
        <path d={d1} />
        <path d={d2} />
      </g>
    </g>
  );
}

function MiniCard({ x, y, r, fill }) {
  return (
    <rect
      x={x}
      y={y}
      width="18"
      height="27"
      rx="3"
      fill={fill}
      stroke="#fff"
      strokeWidth="3"
      transform={`rotate(${r} ${x + 9} ${y + 13.5})`}
      style={{ filter: "drop-shadow(2px 2px 0 rgba(23,24,28,0.5))" }}
    />
  );
}

function DrawTwoGlyph({ fill }) {
  return (
    <g>
      <MiniCard x={37} y={58} r={-12} fill={fill} />
      <MiniCard x={47} y={64} r={8} fill={fill} />
    </g>
  );
}

function WildGlyph() {
  // four quadrant ellipse, printed on the ink-black card
  const clipId = useId();
  return (
    <g transform="rotate(-32 50 75)">
      <clipPath id={clipId}>
        <ellipse cx="50" cy="75" rx="30" ry="42" />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        <rect x="20" y="33" width="30" height="42" fill={INK.Red} />
        <rect x="50" y="33" width="30" height="42" fill={INK.Blue} />
        <rect x="20" y="75" width="30" height="42" fill={INK.Yellow} />
        <rect x="50" y="75" width="30" height="42" fill={INK.Green} />
      </g>
      <ellipse cx="50" cy="75" rx="30" ry="42" fill="none" stroke="#fff" strokeWidth="4" />
    </g>
  );
}

function WildDrawFourGlyph() {
  return (
    <g>
      <MiniCard x={30} y={56} r={-16} fill={INK.Red} />
      <MiniCard x={41} y={60} r={-5} fill={INK.Blue} />
      <MiniCard x={51} y={62} r={6} fill={INK.Green} />
      <MiniCard x={60} y={66} r={16} fill={INK.Yellow} />
    </g>
  );
}

function CentreGlyph({ card, ink }) {
  const v = card.value;
  if (v === ACTIONS.WILD) return <WildGlyph />;
  if (v === ACTIONS.WILD_DRAW_FOUR) return <WildDrawFourGlyph />;
  if (typeof v === "number") return <Numeral value={v} />;
  if (v === ACTIONS.SKIP) return <SkipGlyph />;
  if (v === ACTIONS.REVERSE) return <ReverseGlyph />;
  if (v === ACTIONS.DRAW_TWO) return <DrawTwoGlyph fill={ink} />;
  return null;
}

/* ---- faces --------------------------------------------------------- */

function CardFront({ card }) {
  const ink = inkFor(card);
  const isWild = card.value === ACTIONS.WILD || card.value === ACTIONS.WILD_DRAW_FOUR;
  const corner = cornerText(card);
  const cornerSize = corner.length > 1 ? 16 : 20;
  const cornerProps = {
    fontFamily: FONT,
    fontWeight: 800,
    fontSize: cornerSize,
    fill: "#fff",
    stroke: DARK,
    strokeWidth: 1.6,
    paintOrder: "stroke fill",
    dominantBaseline: "hanging",
  };

  return (
    <svg viewBox="0 0 100 150" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* white card stock, coloured face inset */}
      <rect x="0.5" y="0.5" width="99" height="149" rx="9" fill="#fff" stroke="rgba(0,0,0,0.35)" strokeWidth="1" />
      <rect x="6" y="6" width="88" height="138" rx="6" fill={ink} />
      {/* the modern UNO ellipse: a white outline, tilted */}
      {!isWild ? (
        <ellipse cx="50" cy="75" rx="30" ry="44" fill="none" stroke="#fff" strokeWidth="4.5" transform="rotate(-32 50 75)" />
      ) : null}
      <CentreGlyph card={card} ink={ink} />
      <text x="11" y="11" {...cornerProps}>
        {corner}
      </text>
      <text x="89" y="139" {...cornerProps} transform="rotate(180 89 146)">
        {corner}
      </text>
    </svg>
  );
}

function CardBack() {
  return (
    <svg viewBox="0 0 100 150" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="0.5" y="0.5" width="99" height="149" rx="9" fill="#fff" stroke="rgba(0,0,0,0.35)" strokeWidth="1" />
      <rect x="6" y="6" width="88" height="138" rx="6" fill={DARK} />
      <ellipse cx="50" cy="75" rx="31" ry="45" fill={INK.Red} transform="rotate(-32 50 75)" />
      <text
        x="50"
        y="75"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily={FONT}
        fontWeight="800"
        fontSize="30"
        fill={INK.Yellow}
        stroke={DARK}
        strokeWidth="1.5"
        paintOrder="stroke fill"
        transform="rotate(-14 50 75)"
        style={{ letterSpacing: "-0.04em" }}
      >
        UNO
      </text>
    </svg>
  );
}

/* ---- public component --------------------------------------------- */

function CardSprite({ card, className = "", showBack = false, dim = false, selected = false }) {
  if (showBack || !card) {
    return (
      <div className={`card card-back ${className}`} aria-hidden="true">
        <CardBack />
      </div>
    );
  }
  return (
    <div
      className={`card card-front ${dim ? "card-dim" : ""} ${selected ? "card-selected" : ""} ${className}`}
      role="img"
      aria-label={cardLabel(card)}
    >
      <CardFront card={card} />
    </div>
  );
}

export function cardLabel(card) {
  if (!card) return "";
  const v = card.value;
  if (v === ACTIONS.WILD) return "Wild";
  if (v === ACTIONS.WILD_DRAW_FOUR) return "Wild draw four";
  if (v === ACTIONS.DRAW_TWO) return `${card.color} draw two`;
  return `${card.color} ${v}`;
}

export default memo(CardSprite);

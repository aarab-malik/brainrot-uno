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

const SHADOW = "rgba(23,24,28,0.9)";

/* every centre glyph: a hard black offset shadow, then the glyph in the card colour */
function Shadowed({ children, dx = 2.5, dy = 2.5 }) {
  return (
    <>
      <g transform={`translate(${dx} ${dy})`} fill={SHADOW} stroke={SHADOW} style={{ color: SHADOW }}>
        {children(SHADOW)}
      </g>
      {children(null)}
    </>
  );
}

function Numeral({ value, ink }) {
  const underline = value === 6 || value === 9;
  const common = {
    x: 50,
    y: 75,
    textAnchor: "middle",
    dominantBaseline: "central",
    fontFamily: FONT,
    fontWeight: 800,
    fontSize: 78,
    style: { letterSpacing: "-0.04em" },
  };
  return (
    <Shadowed dx={3} dy={3}>
      {(sh) => (
        <>
          <text {...common} fill={sh ?? ink} stroke={sh ?? DARK} strokeWidth={sh ? 2 : 1.5} paintOrder="stroke fill">
            {value}
          </text>
          {underline ? <rect x="36" y="110" width="28" height="5" rx="2" fill={sh ?? ink} stroke={sh ?? DARK} strokeWidth="1.2" /> : null}
        </>
      )}
    </Shadowed>
  );
}

function SkipGlyph({ ink }) {
  return (
    <Shadowed>
      {(sh) => (
        <g fill="none" strokeLinecap="butt">
          <g stroke={sh ?? DARK} strokeWidth="14">
            <circle cx="50" cy="75" r="22" />
            <line x1="35" y1="60" x2="65" y2="90" />
          </g>
          {sh ? null : (
            <g stroke={ink} strokeWidth="10">
              <circle cx="50" cy="75" r="22" />
              <line x1="35" y1="60" x2="65" y2="90" />
            </g>
          )}
        </g>
      )}
    </Shadowed>
  );
}

function ReverseGlyph({ ink }) {
  const d1 = "M30 60 h28 l-7 -10 h11 l13 17 -13 17 h-11 l7 -10 h-28 z";
  const d2 = "M70 90 h-28 l7 10 h-11 l-13 -17 13 -17 h11 l-7 10 h28 z";
  return (
    <Shadowed dx={3} dy={3}>
      {(sh) => (
        <g fill={sh ?? ink} stroke={sh ?? DARK} strokeWidth="1.8" strokeLinejoin="round" paintOrder="stroke fill">
          <path d={d1} />
          <path d={d2} />
        </g>
      )}
    </Shadowed>
  );
}

function MiniCard({ x, y, r, fill, sh }) {
  return (
    <rect
      x={x}
      y={y}
      width="20"
      height="30"
      rx="2.5"
      fill={sh ?? fill}
      stroke={sh ?? DARK}
      strokeWidth={sh ? 4 : 1.8}
      transform={`rotate(${r} ${x + 10} ${y + 15})`}
    />
  );
}

function DrawTwoGlyph({ ink }) {
  return (
    <Shadowed>
      {(sh) => (
        <g>
          <MiniCard x={33} y={54} r={-18} fill={ink} sh={sh} />
          <MiniCard x={47} y={66} r={-18} fill={ink} sh={sh} />
        </g>
      )}
    </Shadowed>
  );
}

function WildGlyph() {
  // the four-colour ellipse sits inside the white one on a black card
  const clipId = useId();
  return (
    <g transform="rotate(-32 50 75)">
      <ellipse cx="50" cy="75" rx="27" ry="40" fill={SHADOW} transform="translate(2 2)" />
      <clipPath id={clipId}>
        <ellipse cx="50" cy="75" rx="27" ry="40" />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        <rect x="20" y="33" width="30" height="42" fill={INK.Red} />
        <rect x="50" y="33" width="30" height="42" fill={INK.Blue} />
        <rect x="20" y="75" width="30" height="42" fill={INK.Yellow} />
        <rect x="50" y="75" width="30" height="42" fill={INK.Green} />
      </g>
    </g>
  );
}

function WildDrawFourGlyph() {
  return (
    <Shadowed>
      {(sh) => (
        <g>
          <MiniCard x={26} y={56} r={-18} fill={INK.Blue} sh={sh} />
          <MiniCard x={42} y={50} r={-18} fill={INK.Green} sh={sh} />
          <MiniCard x={36} y={72} r={-18} fill={INK.Red} sh={sh} />
          <MiniCard x={52} y={66} r={-18} fill={INK.Yellow} sh={sh} />
        </g>
      )}
    </Shadowed>
  );
}

function CornerWildDot({ x, y }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(-32)`}>
      <ellipse cx="0" cy="0" rx="5.5" ry="7.5" fill="#fff" />
      <path d="M0 -7.5 A5.5 7.5 0 0 0 -5.5 0 L0 0 Z" fill={INK.Red} />
      <path d="M0 -7.5 A5.5 7.5 0 0 1 5.5 0 L0 0 Z" fill={INK.Blue} />
      <path d="M-5.5 0 A5.5 7.5 0 0 0 0 7.5 L0 0 Z" fill={INK.Yellow} />
      <path d="M5.5 0 A5.5 7.5 0 0 1 0 7.5 L0 0 Z" fill={INK.Green} />
    </g>
  );
}

function CentreGlyph({ card, ink }) {
  const v = card.value;
  if (v === ACTIONS.WILD) return <WildGlyph />;
  if (v === ACTIONS.WILD_DRAW_FOUR) return <WildDrawFourGlyph />;
  if (typeof v === "number") return <Numeral value={v} ink={ink} />;
  if (v === ACTIONS.SKIP) return <SkipGlyph ink={ink} />;
  if (v === ACTIONS.REVERSE) return <ReverseGlyph ink={ink} />;
  if (v === ACTIONS.DRAW_TWO) return <DrawTwoGlyph ink={ink} />;
  return null;
}

/* ---- faces --------------------------------------------------------- */

function CardFront({ card }) {
  const ink = inkFor(card);
  const isWild = card.value === ACTIONS.WILD;
  const corner = cornerText(card);
  const cornerSize = corner.length > 1 ? 15 : 19;
  const cornerProps = {
    fontFamily: FONT,
    fontWeight: 800,
    fontSize: cornerSize,
    fill: "#fff",
    stroke: DARK,
    strokeWidth: 1.2,
    paintOrder: "stroke fill",
    dominantBaseline: "hanging",
  };

  return (
    <svg viewBox="0 0 100 150" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* white card stock, coloured face inset, big white ellipse like the printed deck */}
      <rect x="0.5" y="0.5" width="99" height="149" rx="9" fill="#fff" stroke="rgba(0,0,0,0.35)" strokeWidth="1" />
      <rect x="6" y="6" width="88" height="138" rx="6" fill={ink} />
      <ellipse cx="50" cy="75" rx="33" ry="51" fill="#fff" transform="rotate(-32 50 75)" />
      <CentreGlyph card={card} ink={ink} />
      {isWild ? (
        <>
          <CornerWildDot x={17} y={19} />
          <CornerWildDot x={83} y={131} />
        </>
      ) : (
        <>
          <text x="11" y="10" {...cornerProps}>
            {corner}
          </text>
          <text x="89" y="140" {...cornerProps} transform="rotate(180 89 147)">
            {corner}
          </text>
        </>
      )}
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

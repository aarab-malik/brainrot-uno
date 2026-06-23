import { useEffect, useMemo, useState } from "react";
import { spriteCandidates } from "@shared/gameLogic.js";
import {
  firstUsableCandidateIndex,
  markSpriteFailed,
  markSpriteLoaded,
  preloadSpriteCandidates,
  toSpriteUrl,
} from "../utils/spriteCache";

export default function CardSprite({
  card,
  className = "",
  showBack = false,
  dim = false,
  selected = false,
}) {
  const [candidateIndex, setCandidateIndex] = useState(0);
  const candidates = useMemo(() => (card ? spriteCandidates(card) : []), [card]);

  useEffect(() => {
    if (showBack) return;
    setCandidateIndex(firstUsableCandidateIndex(candidates, 0));
    preloadSpriteCandidates(candidates, 4);
  }, [candidates, card?.id, showBack]);

  if (showBack) {
    return (
      <div className={`card card-back ${className}`} aria-hidden>
        <div className="back-ribbon" />
        <div className="back-uno">UNO</div>
      </div>
    );
  }

  const src = candidateIndex >= 0 && candidates[candidateIndex] ? toSpriteUrl(candidates[candidateIndex]) : null;
  return (
    <div
      className={`card card-front ${dim ? "card-dim" : ""} ${selected ? "card-selected" : ""} ${className}`}
    >
      {src ? (
        <img
          src={src}
          alt={card ? `${card.color} ${card.value}` : ""}
          draggable={false}
          decoding="async"
          onLoad={() => {
            markSpriteLoaded(src);
          }}
          onError={() => {
            markSpriteFailed(src);
            setCandidateIndex((prev) => firstUsableCandidateIndex(candidates, Math.max(prev + 1, 0)));
          }}
        />
      ) : (
        <div className="card-fallback">{String(card?.value ?? "")}</div>
      )}
      {card && typeof card.value === "number" && (card.value === 6 || card.value === 9) ? (
        <div className="digit-marker">{card.value === 6 ? "6_" : "9."}</div>
      ) : null}
    </div>
  );
}

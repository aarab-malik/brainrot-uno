import { useEffect, useRef } from "react";
import { COLORS } from "@shared/gameLogic.js";

export default function WildColorDpad({ onPick, onCancel }) {
  const firstRef = useRef(null);

  useEffect(() => {
    firstRef.current?.focus();
    if (!onCancel) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="wild-dpad-overlay" onClick={onCancel}>
      <div
        className="wild-dpad-menu"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wild-color-title"
        onClick={(e) => e.stopPropagation()}
      >
        <p id="wild-color-title" className="wild-dpad-title">
          Pick the next color
        </p>
        <div className="wild-grid">
          {COLORS.map((color, i) => (
            <button
              key={color}
              ref={i === 0 ? firstRef : null}
              type="button"
              className={`wild-swatch ${color.toLowerCase()}`}
              onClick={() => onPick(color)}
            >
              <span>{color}</span>
            </button>
          ))}
        </div>
        {onCancel ? (
          <button type="button" className="party-btn party-btn-ghost" style={{ marginTop: "0.9rem" }} onClick={onCancel}>
            Keep the card
          </button>
        ) : null}
      </div>
    </div>
  );
}

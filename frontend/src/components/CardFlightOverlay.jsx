import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import CardSprite from "./CardSprite";
import { DRAW_FLY_MS, FLIP_MS, FLY_MS, getFlightCardSize } from "../utils/cardAnimation";

export default function CardFlightOverlay({ flight, tableRef, onComplete }) {
  const [pos, setPos] = useState(null);
  const [showFront, setShowFront] = useState(false);
  const [flipping, setFlipping] = useState(false);

  useEffect(() => {
    if (!flight) {
      return undefined;
    }
    if (!tableRef?.current) {
      onComplete();
      return undefined;
    }

    const { from, to } = flight;
    if (!from || !to) {
      onComplete();
      return undefined;
    }

    const duration = flight.duration ?? FLY_MS;
    const startFaceFront = flight.startFaceFront ?? false;
    const flipDuringFlight = flight.flipDuringFlight ?? false;
    const flipAtEnd = flight.flipAtEnd ?? false;

    setShowFront(startFaceFront);
    setFlipping(false);
    const { w: cardW, h: cardH } = getFlightCardSize(tableRef?.current);

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const travelDeg = Math.atan2(dy, dx) * (180 / Math.PI);
    const lift = Math.min(48, Math.hypot(dx, dy) * 0.12);

    setPos({
      left: from.x - cardW / 2,
      top: from.y - cardH / 2,
      width: cardW,
      height: cardH,
      rotate: travelDeg * 0.08,
      scale: 0.88,
      lift: 0,
      transition: "none",
    });

    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setPos({
          left: to.x - cardW / 2,
          top: to.y - cardH / 2 - lift * 0.35,
          width: cardW,
          height: cardH,
          rotate: travelDeg * 0.04,
          scale: 1,
          lift,
          transition: `left ${duration}ms cubic-bezier(0.2, 0.85, 0.25, 1), top ${duration}ms cubic-bezier(0.2, 0.85, 0.25, 1), transform ${duration}ms cubic-bezier(0.2, 0.85, 0.25, 1)`,
        });
      });
    });

    const timers = [];

    if (flipDuringFlight) {
      timers.push(
        setTimeout(() => {
          setFlipping(true);
          setShowFront(true);
        }, duration * 0.52)
      );
    }

    if (flipAtEnd) {
      timers.push(
        setTimeout(() => {
          setFlipping(true);
          setShowFront(true);
        }, duration)
      );
    }

    const flipExtra = flipDuringFlight || flipAtEnd ? FLIP_MS : 0;
    timers.push(
      setTimeout(() => {
        onComplete();
      }, duration + flipExtra + 40)
    );

    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
    };
  }, [flight, tableRef, onComplete]);

  if (!flight || !pos) return null;

  const displayCard =
    flight.chosenColor && flight.card
      ? { ...flight.card, color: flight.chosenColor }
      : flight.card;

  return createPortal(
    <div className="card-flight-layer" aria-hidden>
      <div
        className="card-flight-piece"
        style={{
          left: pos.left,
          top: pos.top,
          width: pos.width,
          height: pos.height,
          transition: pos.transition,
          filter: `drop-shadow(0 ${8 + (pos.lift ?? 0) * 0.3}px ${22 + (pos.lift ?? 0)}px rgba(0, 0, 0, 0.55))`,
        }}
      >
        <div
          className={`card-flight-motion ${flipping ? "is-flipping" : ""} ${showFront ? "show-front" : "show-back"}`}
          style={{
            width: "100%",
            height: "100%",
            transform: `rotate(${pos.rotate ?? 0}deg) scale(${pos.scale ?? 1})`,
            transition: `transform ${(flight.duration ?? FLY_MS) * 0.9}ms cubic-bezier(0.2, 0.85, 0.25, 1)`,
          }}
        >
        <div className="card-flight-3d">
          <div className="card-flight-face card-flight-face-back">
            <CardSprite showBack className="card-flight-inner" />
          </div>
          <div className="card-flight-face card-flight-face-front">
            {displayCard ? (
              <CardSprite card={displayCard} className="card-flight-inner" />
            ) : (
              <CardSprite showBack className="card-flight-inner" />
            )}
          </div>
        </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

import { useCallback, useRef, useState } from "react";
import {
  DRAW_FLY_MS,
  FLY_MS,
  humanCardAnchor,
  measureAnchor,
  opponentAnchor,
} from "../utils/cardAnimation";

export function useCardFlight(tableRef) {
  const [flight, setFlight] = useState(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [hidden, setHidden] = useState(null);
  const resolveRef = useRef(null);

  const animHoldRef = useRef(0);

  const releaseAnimHold = useCallback(() => {
    animHoldRef.current = Math.max(0, animHoldRef.current - 1);
    if (animHoldRef.current === 0) {
      setIsAnimating(false);
    }
  }, []);

  const acquireAnimHold = useCallback(() => {
    animHoldRef.current += 1;
    setIsAnimating(true);
  }, []);

  const onFlightComplete = useCallback(() => {
    setFlight(null);
    setHidden(null);
    releaseAnimHold();
    resolveRef.current?.();
    resolveRef.current = null;
  }, [releaseAnimHold]);

  const runAnimationSequence = useCallback(
    async (fn) => {
      acquireAnimHold();
      try {
        await fn();
      } finally {
        if (animHoldRef.current > 0) {
          animHoldRef.current = 0;
          setIsAnimating(false);
        }
      }
    },
    [acquireAnimHold]
  );

  const runFlight = useCallback(
    (config) =>
      new Promise((resolve) => {
        const root = tableRef.current;
        const from = measureAnchor(root, config.fromAnchor);
        const to = measureAnchor(root, config.toAnchor);
        if (!from || !to) {
          resolve();
          return;
        }
        resolveRef.current = resolve;
        acquireAnimHold();
        if (config.hideSource) {
          setHidden(config.hideSource);
        }
        setFlight({
          ...config,
          from,
          to,
        });
      }),
    [tableRef, acquireAnimHold]
  );

  const animatePlayToDiscard = useCallback(
    (playerIndex, humanPlayer, cardIndex, card, chosenColor) => {
      const isHuman = humanPlayer >= 0 && playerIndex === humanPlayer;
      return runFlight({
        card,
        chosenColor,
        fromAnchor: isHuman ? humanCardAnchor(cardIndex) : opponentAnchor(playerIndex),
        toAnchor: "discard-pile",
        duration: FLY_MS,
        startFaceFront: isHuman,
        flipDuringFlight: !isHuman,
        hideSource: isHuman ? { type: "human-card", index: cardIndex } : { type: "opponent", playerIndex },
      });
    },
    [runFlight]
  );

  const animateDrawFromPile = useCallback(
    (playerIndex, humanPlayer, drawnCard, chosenColor = null) => {
      const isHuman = humanPlayer >= 0 && playerIndex === humanPlayer;
      return runFlight({
        card: isHuman ? drawnCard : null,
        chosenColor,
        fromAnchor: "draw-pile",
        toAnchor: isHuman ? "human-hand" : opponentAnchor(playerIndex),
        duration: DRAW_FLY_MS,
        startFaceFront: false,
        flipAtEnd: isHuman && !!drawnCard,
      });
    },
    [runFlight]
  );

  return {
    flight,
    isAnimating,
    hidden,
    onFlightComplete,
    animatePlayToDiscard,
    animateDrawFromPile,
    runAnimationSequence,
  };
}

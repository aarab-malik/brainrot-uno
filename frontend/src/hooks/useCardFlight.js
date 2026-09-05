import { useCallback, useEffect, useRef, useState } from "react";
import {
  DRAW_FLY_MS,
  FLY_MS,
  humanCardAnchor,
  measureAnchor,
  opponentAnchor,
} from "../utils/cardAnimation";

const SAFETY_EXTRA_MS = 1500;

function prefersReducedMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function useCardFlight(tableRef) {
  const [flight, setFlight] = useState(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [hidden, setHidden] = useState(null);
  /** id -> { resolve, timer } for every flight that has not settled yet. */
  const pendingRef = useRef(new Map());
  const currentIdRef = useRef(null);
  const nextIdRef = useRef(0);

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

  /** Resolve one flight's promise, release its hold, and clear the visual if it is the live one. */
  const settleFlight = useCallback(
    (id) => {
      const entry = pendingRef.current.get(id);
      if (!entry) return;
      pendingRef.current.delete(id);
      clearTimeout(entry.timer);
      if (currentIdRef.current === id) {
        currentIdRef.current = null;
        setFlight(null);
        setHidden(null);
      }
      releaseAnimHold();
      entry.resolve();
    },
    [releaseAnimHold]
  );

  const onFlightComplete = useCallback(() => {
    if (currentIdRef.current != null) {
      settleFlight(currentIdRef.current);
      return;
    }
    setFlight(null);
    setHidden(null);
  }, [settleFlight]);

  useEffect(
    () => () => {
      for (const id of Array.from(pendingRef.current.keys())) {
        const entry = pendingRef.current.get(id);
        pendingRef.current.delete(id);
        clearTimeout(entry.timer);
        entry.resolve();
      }
    },
    []
  );

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
        if (prefersReducedMotion()) {
          resolve();
          return;
        }
        const root = tableRef.current;
        const from = measureAnchor(root, config.fromAnchor);
        const to = measureAnchor(root, config.toAnchor);
        if (!from || !to) {
          resolve();
          return;
        }
        // A new flight supersedes any still-pending one: settle it so its awaiter never hangs.
        for (const id of Array.from(pendingRef.current.keys())) {
          settleFlight(id);
        }
        nextIdRef.current += 1;
        const id = nextIdRef.current;
        const duration = config.duration ?? FLY_MS;
        const timer = setTimeout(() => settleFlight(id), duration + SAFETY_EXTRA_MS);
        pendingRef.current.set(id, { resolve, timer });
        currentIdRef.current = id;
        acquireAnimHold();
        if (config.hideSource) {
          setHidden(config.hideSource);
        }
        setFlight({
          ...config,
          id,
          from,
          to,
        });
      }),
    [tableRef, acquireAnimHold, settleFlight]
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

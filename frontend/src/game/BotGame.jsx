import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ACTIONS,
  applyCallUno,
  applyDraw,
  applyPassTurn,
  applyPlay,
  needsUnoCall,
  autoChooseColor,
  chooseAIMove,
  getValidMoves,
  makeInitialGameState,
  canDrawAtLeast,
} from "@shared/gameLogic.js";
import { defaultHumanSlot } from "../utils/seatLayout";
import { useCardFlight } from "../hooks/useCardFlight";
import GameTable from "./GameTable";

export default function BotGame({ playerCount, startingHandSize = 8, onExit, onChangeRules }) {
  const humanPlayer = defaultHumanSlot(playerCount);
  const [state, setState] = useState(() => makeInitialGameState(playerCount, startingHandSize));
  const [hoveredCardIndex, setHoveredCardIndex] = useState(null);
  const [hoverDeck, setHoverDeck] = useState(false);
  const [colorPicker, setColorPicker] = useState(null);
  const tableRef = useRef(null);

  const playerNames = useMemo(
    () =>
      Array.from({ length: playerCount }, (_, i) =>
        i === humanPlayer ? "You" : `Bot ${i + 1}`
      ),
    [playerCount, humanPlayer]
  );

  const {
    flight,
    isAnimating,
    hidden,
    onFlightComplete,
    animatePlayToDiscard,
    animateDrawFromPile,
    runAnimationSequence,
  } = useCardFlight(tableRef);

  const aiTurnHandledRef = useRef("");
  const aiRunningRef = useRef(false);

  const validMoves = useMemo(() => getValidMoves(state, humanPlayer), [state, humanPlayer]);
  const playableIndices = useMemo(
    () => new Set(validMoves.filter((m) => m.type === "play").map((m) => m.cardIndex)),
    [validMoves]
  );
  const drawMove = useMemo(() => validMoves.find((m) => m.type === "draw"), [validMoves]);
  const canHumanDraw = useMemo(
    () => !!drawMove && state.currentPlayer === humanPlayer && state.winner === null,
    [drawMove, state.currentPlayer, state.winner, humanPlayer]
  );
  const penaltyDrawAmount =
    state.pendingDraw > 0 ? (drawMove?.amount ?? state.pendingDraw) : 0;
  const canPenaltyDraw =
    state.pendingDraw > 0 &&
    state.currentPlayer === humanPlayer &&
    state.winner === null &&
    (!!drawMove || penaltyDrawAmount > 0);
  const showPenaltyDrawBtn = canPenaltyDraw;
  const showEndTurnBtn =
    state.mayPassAfterDraw && state.currentPlayer === humanPlayer && state.winner === null;
  const blockDrawPile =
    showEndTurnBtn || (state.mayPassAfterDraw && !canHumanDraw && state.pendingDraw <= 0);

  const wildColorOnPile = useMemo(() => {
    const top = state.topCard;
    if (!top) return null;
    if (top.value === ACTIONS.WILD || top.value === ACTIONS.WILD_DRAW_FOUR) {
      return top.color;
    }
    return null;
  }, [state.topCard]);

  const hasDrawSupply = useMemo(
    () => state.drawPile.length > 0 || canDrawAtLeast(state, 1),
    [state]
  );

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const runAnimatedDraws = useCallback(
    async (playerIndex, amount) => {
      const prev = stateRef.current;
      const beforeLen = prev.hands[playerIndex].length;
      const final = applyDraw(prev, playerIndex, amount);
      const finalHand = final.hands[playerIndex];
      const newCards = finalHand.slice(beforeLen);

      const startPileLen = prev.drawPile.length;
      const endPileLen = final.drawPile.length;

      await runAnimationSequence(async () => {
        for (let i = 0; i < newCards.length; i += 1) {
          await animateDrawFromPile(playerIndex, humanPlayer, newCards[i]);
          const revealCount = Math.min(finalHand.length, beforeLen + i + 1);
          const pileLen = Math.max(endPileLen, startPileLen - (i + 1));
          setState((current) => {
            const revealState = {
              ...current,
              drawPile:
                current.drawPile.length > pileLen
                  ? current.drawPile.slice(0, pileLen)
                  : current.drawPile,
              hands: current.hands.map((hand, idx) =>
                idx === playerIndex ? finalHand.slice(0, revealCount) : hand
              ),
            };
            stateRef.current = revealState;
            return revealState;
          });
        }
      });

      setState(final);
      stateRef.current = final;
      return final;
    },
    [animateDrawFromPile, humanPlayer, runAnimationSequence]
  );

  useEffect(() => {
    if (state.winner !== null || colorPicker) return;
    if (state.currentPlayer === humanPlayer) return;
    if (aiRunningRef.current) return;

    const turnKey = `${state.turnCount}-${state.currentPlayer}`;
    if (aiTurnHandledRef.current === turnKey) return;

    let cancelled = false;

    const runAiTurn = async () => {
      if (cancelled || aiRunningRef.current) return;

      const prev = stateRef.current;
      if (prev.winner !== null || prev.currentPlayer === humanPlayer) return;

      const activeKey = `${prev.turnCount}-${prev.currentPlayer}`;
      if (aiTurnHandledRef.current === activeKey) return;

      aiTurnHandledRef.current = activeKey;
      aiRunningRef.current = true;

      try {
        const move = chooseAIMove(prev, prev.currentPlayer);
        const player = prev.currentPlayer;

        if (move.type === "draw") {
          await runAnimatedDraws(player, move.amount);
          return;
        }

        let turnState = prev;
        if (needsUnoCall(turnState, player)) {
          turnState = applyCallUno(turnState, player);
          setState(turnState);
          stateRef.current = turnState;
        }

        const card = turnState.hands[player][move.cardIndex];
        const color =
          card.value === ACTIONS.WILD || card.value === ACTIONS.WILD_DRAW_FOUR
            ? autoChooseColor(turnState.hands[player])
            : null;

        await animatePlayToDiscard(player, humanPlayer, move.cardIndex, card, color);

        const latest = stateRef.current;
        if (latest.winner !== null || latest.currentPlayer !== player) {
          // nothing changed for this turn, so let the effect try again
          aiTurnHandledRef.current = "";
          return;
        }

        const next = applyPlay(turnState, player, move.cardIndex, color);
        setState(next);
        stateRef.current = next;
      } catch (err) {
        // a thrown move must not freeze the match: clear the handled marker and fall
        // back to a plain draw so the turn always advances
        aiTurnHandledRef.current = "";
        console.error("AI turn failed", err);
        const fallback = stateRef.current;
        if (fallback.winner === null && fallback.currentPlayer !== humanPlayer) {
          const next = applyDraw(fallback, fallback.currentPlayer, 1);
          setState(next);
          stateRef.current = next;
        }
      } finally {
        aiRunningRef.current = false;
      }
    };

    const timer = setTimeout(runAiTurn, 650);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    state.currentPlayer,
    state.turnCount,
    state.winner,
    state.mayPassAfterDraw,
    colorPicker,
    humanPlayer,
    animatePlayToDiscard,
    runAnimatedDraws,
  ]);

  async function handleCardClick(index) {
    if (isAnimating || state.currentPlayer !== humanPlayer || state.winner !== null) return;
    if (!playableIndices.has(index)) return;
    const card = state.hands[humanPlayer][index];

    if (card.value === ACTIONS.WILD || card.value === ACTIONS.WILD_DRAW_FOUR) {
      setColorPicker({ cardIndex: index });
      return;
    }

    await animatePlayToDiscard(humanPlayer, humanPlayer, index, card, null);
    setState((prev) => applyPlay(prev, humanPlayer, index, null));
  }

  async function handleColorChoice(color) {
    if (!colorPicker || isAnimating) return;
    const { cardIndex } = colorPicker;
    const card = state.hands[humanPlayer][cardIndex];
    setColorPicker(null);
    await animatePlayToDiscard(humanPlayer, humanPlayer, cardIndex, card, color);
    setState((prev) => applyPlay(prev, humanPlayer, cardIndex, color));
  }

  async function handleDraw() {
    if (isAnimating || state.winner !== null || state.currentPlayer !== humanPlayer) return;
    const amount =
      state.pendingDraw > 0
        ? (drawMove?.amount ?? state.pendingDraw)
        : drawMove?.amount;
    if (!amount || amount < 1) return;
    if (state.pendingDraw <= 0 && (!canHumanDraw || !drawMove)) return;
    await runAnimatedDraws(humanPlayer, amount);
  }

  function handlePenaltyDraw() {
    handleDraw();
  }

  function handleEndTurn() {
    if (isAnimating || !showEndTurnBtn) return;
    setState((prev) => applyPassTurn(prev, humanPlayer));
  }

  function handleCallUno() {
    if (isAnimating || state.winner !== null) return;
    setState((prev) => applyCallUno(prev, humanPlayer));
  }

  function resetGame() {
    setState(makeInitialGameState(playerCount, startingHandSize));
    setHoveredCardIndex(null);
    setHoverDeck(false);
    setColorPicker(null);
    aiTurnHandledRef.current = "";
    aiRunningRef.current = false;
  }

  return (
    <GameTable
      state={state}
      humanPlayer={humanPlayer}
      playerNames={playerNames}
      tableRef={tableRef}
      isAnimating={isAnimating}
      isMyTurn={state.currentPlayer === humanPlayer && state.winner === null}
      hoveredCardIndex={hoveredCardIndex}
      setHoveredCardIndex={setHoveredCardIndex}
      hoverDeck={hoverDeck}
      setHoverDeck={setHoverDeck}
      colorPicker={colorPicker}
      flight={flight}
      hidden={hidden}
      onFlightComplete={onFlightComplete}
      playableIndices={playableIndices}
      canHumanDraw={canHumanDraw}
      canPenaltyDraw={canPenaltyDraw}
      blockDrawPile={blockDrawPile}
      showPenaltyDrawBtn={showPenaltyDrawBtn}
      onPenaltyDraw={handlePenaltyDraw}
      showEndTurnBtn={showEndTurnBtn}
      penaltyDrawAmount={penaltyDrawAmount}
      wildColorOnPile={wildColorOnPile}
      hasDrawSupply={hasDrawSupply}
      onDraw={handleDraw}
      onEndTurn={handleEndTurn}
      onCardClick={handleCardClick}
      onColorChoice={handleColorChoice}
      onColorCancel={() => setColorPicker(null)}
      onCallUno={handleCallUno}
      onNewGame={onExit ?? resetGame}
      onPlayAgain={resetGame}
      onRestartSameRules={resetGame}
      onChangeRules={onChangeRules ?? onExit}
      newGameLabel={onExit ? "Leave table" : "New game"}
      showWinnerModal
    />
  );
}

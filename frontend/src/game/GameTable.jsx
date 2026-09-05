import { useEffect, useMemo, useRef, useState } from "react";
import CardFlightOverlay from "../components/CardFlightOverlay";
import CardSprite, { cardLabel } from "../components/CardSprite";
import WildColorDpad from "../components/WildColorDpad";
import OpponentSeat, { PlayerTag } from "./OpponentSeat";
import DiscardPileStack from "./DiscardPileStack";
import { handCount } from "../utils/hand";
import {
  ACTIONS,
  getEffectiveTurnDirection,
  getPlayerCount,
  getTurnCycle,
  isPlayable,
  needsUnoCall,
} from "@shared/gameLogic.js";
import {
  getOpponentSeatAngles,
  getOpponentSlotsInTableOrder,
  opponentSeatRadius,
  seatPositionStyle,
} from "../utils/seatLayout";

const COLOR_VAR = {
  Red: "var(--red)",
  Blue: "var(--blue)",
  Green: "var(--green)",
  Yellow: "var(--yellow)",
};

function currentColor(state, wildColorOnPile) {
  if (wildColorOnPile) return wildColorOnPile;
  const top = state.topCard;
  if (!top) return null;
  if (top.value === ACTIONS.WILD || top.value === ACTIONS.WILD_DRAW_FOUR) return top.color in COLOR_VAR ? top.color : null;
  return top.color;
}

function DirectionRing({ direction }) {
  return (
    <svg
      className={`direction-ring ${direction < 0 ? "ccw" : "cw"}`}
      viewBox="0 0 200 200"
      aria-hidden="true"
    >
      <defs>
        <marker id="dir-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
        </marker>
      </defs>
      <path d="M 100 20 A 80 80 0 0 1 180 100" fill="none" stroke="currentColor" strokeWidth="9" markerEnd="url(#dir-arrow)" />
      <path d="M 100 180 A 80 80 0 0 1 20 100" fill="none" stroke="currentColor" strokeWidth="9" markerEnd="url(#dir-arrow)" />
    </svg>
  );
}

export default function GameTable({
  state,
  humanPlayer,
  playerNames,
  tableRef,
  isAnimating,
  isMyTurn = false,
  hoveredCardIndex,
  setHoveredCardIndex,
  hoverDeck,
  setHoverDeck,
  colorPicker,
  flight,
  hidden,
  onFlightComplete,
  playableIndices,
  canHumanDraw,
  canPenaltyDraw,
  blockDrawPile,
  showPenaltyDrawBtn,
  showEndTurnBtn,
  penaltyDrawAmount,
  wildColorOnPile,
  hasDrawSupply,
  onDraw,
  onPenaltyDraw,
  onEndTurn,
  onCardClick,
  onColorChoice,
  onColorCancel,
  onNewGame,
  onPlayAgain,
  onRestartSameRules,
  onChangeRules,
  onCallUno,
  newGameLabel = "Leave table",
  canManageGameEnd = true,
  showWinnerModal = true,
  isSpectator = false,
}) {
  const handlePlayAgain = onPlayAgain ?? onNewGame;
  const handleRestartSameRules = onRestartSameRules ?? handlePlayAgain;
  const isHumanCardHidden = (index) => hidden?.type === "human-card" && hidden.index === index;
  const isOpponentHidden = (playerIndex) => hidden?.type === "opponent" && hidden.playerIndex === playerIndex;

  const humanHand = isSpectator ? [] : state.hands[humanPlayer];
  const humanCards = Array.isArray(humanHand) ? humanHand : [];
  const humanName = isSpectator ? "Spectating" : playerNames[humanPlayer] ?? "You";

  const playerCount = getPlayerCount(state);
  const tableTurnCycle = useMemo(() => getTurnCycle(state), [state]);
  const direction = getEffectiveTurnDirection(state);

  const opponentSlots = useMemo(
    () => getOpponentSlotsInTableOrder(tableTurnCycle, humanPlayer, isSpectator),
    [tableTurnCycle, humanPlayer, isSpectator]
  );
  const opponentAngles = getOpponentSeatAngles(opponentSlots.length);
  const radius = opponentSeatRadius(playerCount);

  const activeColor = currentColor(state, wildColorOnPile);
  const glow = activeColor ? COLOR_VAR[activeColor] : "var(--yellow)";

  const showUnoBtn =
    !isSpectator &&
    state.winner === null &&
    isMyTurn &&
    humanCards.length === 2 &&
    needsUnoCall(state, humanPlayer) &&
    typeof onCallUno === "function";

  const [turnToast, setTurnToast] = useState(false);
  const [unoShout, setUnoShout] = useState(null);
  const lastTurnKeyRef = useRef("");
  const lastUnoKeyRef = useRef("");

  useEffect(() => {
    if (!isMyTurn || state.winner !== null) {
      setTurnToast(false);
      return;
    }
    const key = `${state.turnCount}-${state.currentPlayer}`;
    if (key === lastTurnKeyRef.current) return;
    lastTurnKeyRef.current = key;
    setTurnToast(true);
    const timer = setTimeout(() => setTurnToast(false), 3000);
    return () => clearTimeout(timer);
  }, [isMyTurn, state.turnCount, state.currentPlayer, state.winner]);

  useEffect(() => {
    const move = state.lastMove;
    if (move?.type !== "uno" || move.playerIndex == null) return undefined;
    const key = `${state.turnCount}-${move.playerIndex}-uno`;
    if (key === lastUnoKeyRef.current) return undefined;
    lastUnoKeyRef.current = key;
    setUnoShout({ playerIndex: move.playerIndex });
    const timer = setTimeout(() => setUnoShout(null), 3200);
    return () => clearTimeout(timer);
  }, [state.lastMove, state.turnCount]);

  const handleDeckClick = () => {
    if (showPenaltyDrawBtn && onPenaltyDraw) {
      onPenaltyDraw();
      return;
    }
    if (!blockDrawPile) onDraw();
  };

  const drawDisabled = (!canHumanDraw && !showPenaltyDrawBtn) || blockDrawPile;
  const handSizeClass = humanCards.length > 12 ? "many" : humanCards.length > 8 ? "some" : "";

  return (
    <div className={`game-page ${isAnimating ? "is-animating" : ""}`} style={{ "--glow": glow }}>
      <div className="game-notices" aria-live="polite">
        {state.pendingDraw > 0 ? (
          <div className="notice notice-stack" role="status">
            <span className="notice-icon" aria-hidden="true">
              +{state.pendingDraw}
            </span>
            <span>
              Draw stack is <b>{state.pendingDraw}</b>. Stack or take it.
            </span>
          </div>
        ) : null}
        {turnToast ? (
          <div className="notice notice-turn" role="status">
            <span className="notice-icon" aria-hidden="true">
              ▶
            </span>
            <span>Your turn. Play a card or draw.</span>
          </div>
        ) : null}
      </div>

      <div className="game-corner-actions">
        <button type="button" className="game-btn game-btn-ghost" onClick={onNewGame} disabled={isAnimating}>
          {newGameLabel}
        </button>
      </div>

      <div className={`table-arena players-${playerCount}`} ref={tableRef}>
        <div className="table" aria-hidden={false}>
          <div className="table-ring" aria-hidden="true" />
          <div className="table-glow" aria-hidden="true" />

          {opponentSlots.map((playerIndex, idx) => (
            <OpponentSeat
              key={playerIndex}
              className="opponent-seat-radial"
              style={seatPositionStyle(opponentAngles[idx] ?? 270, radius)}
              name={playerNames[playerIndex] ?? `Player ${playerIndex + 1}`}
              cardCount={handCount(state.hands[playerIndex])}
              isActive={state.currentPlayer === playerIndex && state.winner === null}
              playerIndex={playerIndex}
              hidden={isOpponentHidden(playerIndex)}
              compact={playerCount >= 6}
              extraCompact={playerCount >= 11}
              showUnoShout={unoShout?.playerIndex === playerIndex}
            />
          ))}

          <div className="center-zone">
            <DirectionRing direction={direction} />
            <div className="discard-pile-wrap">
              <DiscardPileStack discardPile={state.discardPile} topCard={state.topCard} />
            </div>
            {wildColorOnPile ? (
              <div className={`wild-color-chip ${wildColorOnPile.toLowerCase()}`} role="status">
                {wildColorOnPile}
              </div>
            ) : null}
          </div>

          {!isSpectator ? (
            <div className="draw-zone">
              <div
                className={`draw-pile ${hoverDeck ? "hovered" : ""} ${drawDisabled ? "disabled" : ""} ${
                  showPenaltyDrawBtn ? "penalty-mode" : ""
                }`}
                data-anchor="draw-pile"
                onMouseEnter={() => setHoverDeck(true)}
                onMouseLeave={() => setHoverDeck(false)}
                onClick={handleDeckClick}
                role="button"
                tabIndex={0}
                aria-label={showPenaltyDrawBtn ? `Draw ${penaltyDrawAmount} penalty cards` : "Draw a card"}
                aria-disabled={drawDisabled}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleDeckClick();
                  }
                }}
              >
                {hasDrawSupply ? (
                  <CardSprite showBack className="draw-pile-card" />
                ) : (
                  <div className="empty-deck">Empty</div>
                )}
              </div>
              <span className="draw-count-label">{state.drawPile.length}</span>
            </div>
          ) : (
            <div className="draw-zone" data-anchor="draw-pile" aria-hidden="true">
              <div className="draw-pile disabled">
                <CardSprite showBack className="draw-pile-card" />
              </div>
            </div>
          )}
        </div>

        <div className={`human-dock ${isSpectator ? "is-spectator" : ""}`}>
          {isSpectator ? (
            <div className="spectator-panel" role="status">
              <p className="spectator-title">Spectating</p>
              <p className="spectator-hint">
                Rejoin with the same name and room code within 60 seconds of disconnecting to get your hand back.
              </p>
            </div>
          ) : (
            <>
              <div className="human-seat">
                <PlayerTag
                  name={humanName}
                  count={humanCards.length}
                  isActive={isMyTurn}
                  playerIndex={humanPlayer}
                  isYou
                  className="player-tag-human"
                />
              </div>

              <div className="human-hand-wrap">
                {unoShout?.playerIndex === humanPlayer ? (
                  <div className="uno-shout-burst" aria-live="polite">
                    UNO!
                  </div>
                ) : null}
                <div className={`human-hand ${handSizeClass}`} data-anchor="human-hand" style={{ "--n": humanCards.length }}>
                  {humanCards.map((card, index) => {
                    const canPlay = isMyTurn && isPlayable(card, state, humanPlayer);
                    const playable = playableIndices.has(index) || canPlay;
                    const hovered = hoveredCardIndex === index;
                    const cardHidden = isHumanCardHidden(index);
                    return (
                      <button
                        type="button"
                        key={card.id}
                        data-anchor={`human-card-${index}`}
                        className={`human-card-wrap ${canPlay ? "can-play" : ""} ${hovered ? "hovered" : ""} ${
                          hovered && playable ? "playable-hover" : ""
                        } ${hovered && !playable ? "blocked-hover" : ""} ${cardHidden ? "anchor-hidden" : ""}`}
                        style={{ "--i": index, "--n": humanCards.length }}
                        aria-label={`${cardLabel(card)}${canPlay ? ", playable" : ""}`}
                        aria-disabled={!canPlay}
                        onMouseEnter={() => !isAnimating && setHoveredCardIndex(index)}
                        onMouseLeave={() => setHoveredCardIndex(null)}
                        onFocus={() => !isAnimating && setHoveredCardIndex(index)}
                        onBlur={() => setHoveredCardIndex(null)}
                        onClick={() => onCardClick(index)}
                      >
                        <CardSprite card={card} dim={isMyTurn && !canPlay} selected={hovered && playable} />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="human-actions">
                {showUnoBtn ? (
                  <button type="button" className="game-btn game-btn-uno" onClick={onCallUno} disabled={isAnimating}>
                    UNO!
                  </button>
                ) : null}
                {showPenaltyDrawBtn ? (
                  <button
                    type="button"
                    className="game-btn game-btn-danger"
                    onClick={() => onPenaltyDraw?.()}
                    disabled={isAnimating || !canPenaltyDraw}
                  >
                    Draw +{penaltyDrawAmount}
                  </button>
                ) : null}
                {showEndTurnBtn ? (
                  <button type="button" className="game-btn game-btn-primary" onClick={onEndTurn} disabled={isAnimating}>
                    End turn
                  </button>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>

      <CardFlightOverlay flight={flight} tableRef={tableRef} onComplete={onFlightComplete} />

      {colorPicker ? <WildColorDpad onPick={onColorChoice} onCancel={onColorCancel} /> : null}

      {showWinnerModal && state.winner !== null ? (
        <div className="modal-backdrop winner-backdrop">
          <div className="modal winner-modal" role="dialog" aria-modal="true" aria-labelledby="winner-title">
            <p className="winner-kicker">Match end</p>
            <h2 id="winner-title">
              {state.winner === humanPlayer && !isSpectator
                ? "You win."
                : `${playerNames[state.winner] ?? `Player ${state.winner + 1}`} wins.`}
            </h2>
            <div className="winner-actions">
              <button
                type="button"
                className="game-btn game-btn-primary"
                onClick={handleRestartSameRules}
                disabled={!canManageGameEnd}
              >
                Play again
              </button>
              {onChangeRules ? (
                <button type="button" className="game-btn" onClick={onChangeRules} disabled={!canManageGameEnd}>
                  Change the rules
                </button>
              ) : null}
              <button type="button" className="game-btn game-btn-ghost" onClick={onNewGame}>
                Back to menu
              </button>
            </div>
            {!canManageGameEnd ? (
              <p className="winner-action-hint">Waiting for the host to restart or change rules.</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

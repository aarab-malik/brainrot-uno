import { useEffect, useMemo, useRef, useState } from "react";
import CardFlightOverlay from "../components/CardFlightOverlay";
import CardSprite from "../components/CardSprite";
import WildColorDpad from "../components/WildColorDpad";
import OpponentSeat from "./OpponentSeat";
import DiscardPileStack from "./DiscardPileStack";
import { handCount } from "../utils/hand";
import { getDisplayTurnCycle, getPlayerCount, getTurnCycle, isPlayable, needsUnoCall } from "@shared/gameLogic.js";
import { getOpponentSeatAngles, getOpponentSlotsInTableOrder, opponentSeatRadius, seatPositionStyle } from "../utils/seatLayout";

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
  onNewGame,
  onPlayAgain,
  onRestartSameRules,
  onChangeRules,
  onCallUno,
  newGameLabel = "New Game",
  canManageGameEnd = true,
  showWinnerModal = true,
  isSpectator = false,
}) {
  const handlePlayAgain = onPlayAgain ?? onNewGame;
  const handleRestartSameRules = onRestartSameRules ?? handlePlayAgain;
  const isHumanCardHidden = (index) =>
    hidden?.type === "human-card" && hidden.index === index;

  const isOpponentHidden = (playerIndex) =>
    hidden?.type === "opponent" && hidden.playerIndex === playerIndex;

  const humanHand = isSpectator ? [] : state.hands[humanPlayer];
  const humanCards = Array.isArray(humanHand) ? humanHand : [];
  const humanName = isSpectator ? "Spectating" : (playerNames[humanPlayer] ?? "You");

  const playerCount = getPlayerCount(state);
  const turnCycle = useMemo(() => getDisplayTurnCycle(state), [state]);
  const tableTurnCycle = useMemo(() => getTurnCycle(state), [state]);

  const opponentSlots = useMemo(
    () => getOpponentSlotsInTableOrder(tableTurnCycle, humanPlayer, isSpectator),
    [tableTurnCycle, humanPlayer, isSpectator]
  );
  const opponentAngles = getOpponentSeatAngles(opponentSlots.length);
  const radius = opponentSeatRadius(playerCount);

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
    const timer = setTimeout(() => setTurnToast(false), 3500);
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

  return (
    <div className={`page game-page ${isAnimating ? "is-animating" : ""}`}>
      {turnToast ? (
        <div className="game-toast game-toast-turn" role="status">
          Your turn — play a card or draw
        </div>
      ) : null}

      <header className="hud game-hud">
        <div className="title-wrap">
          <p className="game-kicker">Tabletop card room</p>
          <h1>
            Brainrot <span>UNO</span>
          </h1>
          {state.pendingDraw > 0 ? (
            <div className="sub">
              Draw stack: {state.pendingDraw} ({state.drawStackType})
            </div>
          ) : null}
          <div className="player-name-rail" aria-label="Turn order">
            {turnCycle.map((slot, idx) => (
              <span key={slot} className="turn-rail-segment">
                {idx > 0 ? (
                  <span className="turn-rail-arrow" aria-hidden>
                    →
                  </span>
                ) : null}
                <span
                  className={`player-name-chip ${state.currentPlayer === slot && state.winner === null ? "active" : ""} ${slot === humanPlayer ? "you" : ""}`}
                >
                  <span className="turn-rail-order">{idx + 1}</span>
                  {playerNames[slot] ?? `Player ${slot + 1}`}
                </span>
              </span>
            ))}
          </div>
        </div>
        <div className="hud-right">
          <div className="hud-actions">
            <button type="button" onClick={onNewGame} disabled={isAnimating}>
              {newGameLabel}
            </button>
          </div>
        </div>
      </header>

      <main className="table-shell">
        <div className="cozy-bedroom" aria-hidden />
        <div className={`table-arena players-${playerCount}`} ref={tableRef}>
          <div className="table-felt-wrap">
            <div className="table table-felt">
              <div className="table-rail" aria-hidden="true" />
              <div className="table-felt-pattern" aria-hidden />
              <div className="table-inner-ring" aria-hidden />

              {opponentSlots.map((playerIndex, idx) => {
                const angle = opponentAngles[idx] ?? 270;
                const nameOnTop = angle > 160 && angle < 380;
                return (
                  <OpponentSeat
                    key={playerIndex}
                    className="opponent-seat-radial"
                    style={seatPositionStyle(angle, radius)}
                    name={playerNames[playerIndex] ?? `Player ${playerIndex + 1}`}
                    cardCount={handCount(state.hands[playerIndex])}
                    isActive={state.currentPlayer === playerIndex && state.winner === null}
                    playerIndex={playerIndex}
                    hidden={isOpponentHidden(playerIndex)}
                    compact={playerCount >= 5}
                    extraCompact={playerCount >= 10}
                    nameOnTop={nameOnTop}
                    showUnoShout={unoShout?.playerIndex === playerIndex}
                  />
                );
              })}

              <section className="center-zone center-zone-pile">
                <div className="discard-column">
                  <div className="discard-pile-wrap">
                    <DiscardPileStack discardPile={state.discardPile} topCard={state.topCard} />
                    {wildColorOnPile ? (
                      <div className={`wild-color-chip ${wildColorOnPile.toLowerCase()}`}>
                        {wildColorOnPile}
                      </div>
                    ) : null}
                  </div>
                  <div className="pile-label">Center pile</div>
                </div>
              </section>
            </div>
          </div>

          <div className={`human-dock ${isSpectator ? "is-spectator" : ""}`}>
            {isSpectator ? (
              <div className="spectator-hand-zone" role="status">
                <div className="spectator-panel">
                  <p className="spectator-title">Spectating</p>
                  <p className="spectator-lead">You are watching this match — no cards to play.</p>
                  <p className="spectator-hint">
                    Rejoin with the <strong>same name</strong> and <strong>room code</strong> within 60 seconds
                    after disconnect to reclaim your hand.
                  </p>
                </div>
              </div>
            ) : (
            <>
            <div className={`human-name-badge ${isMyTurn ? "your-turn" : ""}`}>
              {humanName}
              {isMyTurn ? <span className="turn-pip"> · Your turn</span> : null}
            </div>
            {showEndTurnBtn ? (
              <div className="human-end-turn-wrap">
                <button
                  type="button"
                  className="end-turn-btn end-turn-btn-prominent"
                  onClick={onEndTurn}
                  disabled={isAnimating}
                >
                  End Turn
                </button>
              </div>
            ) : null}
            <div className="human-play-row">
              {showUnoBtn ? (
                <button
                  type="button"
                  className="uno-call-btn uno-call-btn-hand"
                  onClick={onCallUno}
                  disabled={isAnimating}
                >
                  UNO!
                </button>
              ) : null}
              <div className="human-draw-stack">
                <div
                  className={`draw-pile human-draw-pile ${hoverDeck ? "hovered" : ""} ${
                    (!canHumanDraw && !showPenaltyDrawBtn) || blockDrawPile ? "disabled" : ""
                  } ${showPenaltyDrawBtn ? "penalty-mode" : ""}`}
                  data-anchor="draw-pile"
                  onMouseEnter={() => setHoverDeck(true)}
                  onMouseLeave={() => setHoverDeck(false)}
                  onClick={handleDeckClick}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") handleDeckClick();
                  }}
                >
                  {hasDrawSupply ? (
                    <CardSprite showBack className="draw-pile-card" />
                  ) : (
                    <div className="empty-deck">EMPTY</div>
                  )}
                </div>
                {showPenaltyDrawBtn ? (
                  <button
                    type="button"
                    className="penalty-draw-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPenaltyDraw?.();
                    }}
                    disabled={isAnimating || !canPenaltyDraw}
                  >
                    Draw +{penaltyDrawAmount}
                  </button>
                ) : null}
                <span className="draw-count-label">Draw · {state.drawPile.length}</span>
              </div>

              <div className="human-hand-wrap">
                {unoShout?.playerIndex === humanPlayer ? (
                  <div className="uno-shout-burst" aria-live="polite">
                    UNO!
                  </div>
                ) : null}
              <div className="human-hand" data-anchor="human-hand">
                {humanCards.map((card, index) => {
                  const canPlay = isMyTurn && isPlayable(card, state, humanPlayer);
                  const playable = playableIndices.has(index) || canPlay;
                  const hovered = hoveredCardIndex === index;
                  const cardHidden = isHumanCardHidden(index);
                  return (
                    <div
                      key={card.id}
                      data-anchor={`human-card-${index}`}
                      className={`human-card-wrap ${canPlay ? "can-play" : ""} ${hovered ? "hovered" : ""} ${
                        hovered && playable ? "playable-hover" : ""
                      } ${hovered && !playable ? "blocked-hover" : ""} ${cardHidden ? "anchor-hidden" : ""}`}
                      onMouseEnter={() => !isAnimating && setHoveredCardIndex(index)}
                      onMouseLeave={() => setHoveredCardIndex(null)}
                      onClick={() => onCardClick(index)}
                    >
                      <CardSprite
                        card={card}
                        dim={hovered && !playable}
                        selected={hovered && playable}
                      />
                    </div>
                  );
                })}
              </div>
              </div>
            </div>
            <div className="human-card-count">{humanCards.length} cards in hand</div>
            </>
            )}
          </div>
        </div>
      </main>

      <CardFlightOverlay flight={flight} tableRef={tableRef} onComplete={onFlightComplete} />

      {colorPicker ? <WildColorDpad onPick={onColorChoice} /> : null}

      {showWinnerModal && state.winner !== null ? (
        <div className="modal-backdrop winner-backdrop">
          <div className="modal winner-modal">
            <p className="winner-kicker">Game over</p>
            <h2>{playerNames[state.winner] ?? `Player ${state.winner + 1}`} wins!</h2>
            <div className="winner-actions">
              <button
                type="button"
                className="winner-play-again-btn winner-primary-action"
                onClick={handleRestartSameRules}
                disabled={!canManageGameEnd}
              >
                Restart Same Rules
              </button>
              {onChangeRules ? (
                <button
                  type="button"
                  className="winner-play-again-btn winner-secondary-action"
                  onClick={onChangeRules}
                  disabled={!canManageGameEnd}
                >
                  Same Lobby, Change Rules
                </button>
              ) : null}
              <button type="button" className="winner-menu-action" onClick={onNewGame}>
                Main Menu
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACTIONS, getValidMoves, isPlayable } from "@shared/gameLogic.js";
import { getDrawAnimationInfo } from "../utils/drawAnimation";
import { getHandCards, handCount } from "../utils/hand";
import { useCardFlight } from "../hooks/useCardFlight";
import GameTable from "./GameTable";
import PlayerModeration from "./PlayerModeration";

export default function OnlineGame({
  socketRef,
  mySlot,
  myPlayerId,
  playerNames,
  initialState,
  gamePayload,
  isSpectator = false,
  onExit,
}) {
  const [state, setState] = useState(initialState);
  const [roster, setRoster] = useState(gamePayload?.roster ?? []);
  const [voteKick, setVoteKick] = useState(gamePayload?.voteKick ?? null);
  const [hostId, setHostId] = useState(gamePayload?.hostId ?? null);
  const [info, setInfo] = useState(gamePayload?.message ?? null);
  const [hoveredCardIndex, setHoveredCardIndex] = useState(null);
  const [hoverDeck, setHoverDeck] = useState(false);
  const [colorPicker, setColorPicker] = useState(null);
  const [error, setError] = useState(null);
  const tableRef = useRef(null);
  const stateRef = useRef(initialState);
  const localDrawAnimatingRef = useRef(false);
  const droppedPayloadRef = useRef(null);
  const payloadQueueRef = useRef(Promise.resolve());
  const applyMetaRef = useRef(null);
  const enqueueRef = useRef(null);

  const {
    flight,
    isAnimating,
    hidden,
    onFlightComplete,
    animatePlayToDiscard,
    animateDrawFromPile,
    runAnimationSequence,
  } = useCardFlight(tableRef);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const applyMeta = useCallback((payload) => {
    if (!payload) return;
    if (payload.roster) setRoster(payload.roster);
    if (payload.voteKick !== undefined) setVoteKick(payload.voteKick);
    if (payload.hostId) setHostId(payload.hostId);
    setError(null);
  }, []);

  const processServerPayload = useCallback(
    async (payload) => {
      if (!payload) return;
      applyMeta(payload);

      if (!payload.state) return;

      const next = payload.state;
      const prev = stateRef.current;
      // only animate a draw that is the very next turn; after a reconnect the
      // gap can span many turns and would otherwise replay every missed card
      const adjacentTurn = next.turnCount === (prev?.turnCount ?? -1) + 1;
      const drawInfo = adjacentTurn ? getDrawAnimationInfo(prev, next) : null;
      const viewerSlot = isSpectator ? -1 : mySlot;
      const isLocalDrawer =
        drawInfo && !isSpectator && mySlot != null && drawInfo.playerIndex === mySlot;

      if (isLocalDrawer && localDrawAnimatingRef.current) {
        // my own draw is being animated from the ack; keep the broadcast in case the ack fails
        droppedPayloadRef.current = payload;
        return;
      }

      if (drawInfo && !isLocalDrawer) {
        const { playerIndex, count } = drawInfo;
        const beforeCount = handCount(prev?.hands?.[playerIndex]);
        const startPileLen = prev?.drawPile?.length ?? 0;
        const endPileLen = next.drawPile.length;

        await runAnimationSequence(async () => {
          for (let i = 0; i < count; i += 1) {
            await animateDrawFromPile(playerIndex, viewerSlot, null);
            const pileLen = Math.max(endPileLen, startPileLen - (i + 1));
            setState((current) => ({
              ...current,
              drawPile:
                current.drawPile.length > pileLen
                  ? current.drawPile.slice(0, pileLen)
                  : current.drawPile,
              hands: current.hands.map((hand, idx) =>
                idx === playerIndex ? { hidden: true, count: beforeCount + i + 1 } : hand
              ),
            }));
          }
        });
        setState(next);
        return;
      }

      setState(next);
    },
    [applyMeta, isSpectator, mySlot, runAnimationSequence, animateDrawFromPile]
  );

  const enqueueServerPayload = useCallback(
    (payload) => {
      payloadQueueRef.current = payloadQueueRef.current
        .then(() => processServerPayload(payload))
        .catch(() => {});
    },
    [processServerPayload]
  );

  useEffect(() => {
    applyMetaRef.current = applyMeta;
    enqueueRef.current = enqueueServerPayload;
  }, [applyMeta, enqueueServerPayload]);

  useEffect(() => {
    if (!info) return undefined;
    const timer = setTimeout(() => setInfo(null), 5000);
    return () => clearTimeout(timer);
  }, [info]);

  useEffect(() => {
    if (gamePayload?.state) {
      enqueueRef.current?.(gamePayload);
    } else {
      applyMetaRef.current?.(gamePayload);
    }
    if (gamePayload?.message) setInfo(gamePayload.message);
  }, [gamePayload]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return undefined;

    const onAway = (data) => setInfo(data?.message ?? "Disconnected — rejoin with same name and code within 60s.");
    const onKicked = (data) =>
      setInfo(data?.message ?? "Kicked — rejoin with same name and code within 60s to keep your cards.");
    const onFolded = (data) => setInfo(data?.message ?? "A player was removed from the game.");

    socket.on("player-away", onAway);
    socket.on("player-kicked", onKicked);
    socket.on("player-folded", onFolded);
    return () => {
      socket.off("player-away", onAway);
      socket.off("player-kicked", onKicked);
      socket.off("player-folded", onFolded);
    };
  }, [socketRef]);

  const emitAction = useCallback(
    (action, { applyState = true } = {}) =>
      new Promise((resolve) => {
        const socket = socketRef.current;
        if (!socket) {
          resolve({ ok: false, error: "Disconnected" });
          return;
        }
        socket.timeout(5000).emit("game-action", action, (err, ackRes) => {
          const res = err ? { ok: false, error: "No response from server" } : ackRes;
          if (res?.ok && res.state) {
            const meta = { roster: res.roster, voteKick: res.voteKick, hostId: res.hostId };
            if (applyState) {
              // Same serialized queue as broadcasts, so there is a single state writer.
              enqueueServerPayload({ state: res.state, ...meta });
            } else {
              applyMeta(meta);
            }
          } else if (!res?.ok) {
            setError(res?.error ?? "Move failed");
          }
          resolve(res);
        });
      }),
    [socketRef, enqueueServerPayload, applyMeta]
  );

  const isMyTurn =
    !isSpectator && mySlot != null && state.currentPlayer === mySlot && state.winner === null;

  const validMoves = useMemo(
    () => (isSpectator || mySlot == null ? [] : getValidMoves(state, mySlot)),
    [state, mySlot, isSpectator]
  );
  const playableIndices = useMemo(
    () => new Set(validMoves.filter((m) => m.type === "play").map((m) => m.cardIndex)),
    [validMoves]
  );
  const drawMove = useMemo(() => validMoves.find((m) => m.type === "draw"), [validMoves]);
  const canHumanDraw = useMemo(() => !!drawMove && isMyTurn, [drawMove, isMyTurn]);
  const penaltyDrawAmount =
    state.pendingDraw > 0 ? (drawMove?.amount ?? state.pendingDraw) : 0;
  const canPenaltyDraw =
    state.pendingDraw > 0 && isMyTurn && (!!drawMove || penaltyDrawAmount > 0);
  const showPenaltyDrawBtn = canPenaltyDraw;
  const showEndTurnBtn = state.mayPassAfterDraw && isMyTurn;
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
    () => state.drawPile.length > 0 || state.pendingDraw > 0,
    [state.drawPile.length, state.pendingDraw]
  );

  const handleVoteKick = useCallback(
    (targetSlot) => {
      socketRef.current?.emit("vote-kick", targetSlot, (res) => {
        if (!res?.ok) setError(res?.error ?? "Vote failed");
        else if (res.voteKick) setVoteKick(res.voteKick);
      });
    },
    [socketRef]
  );

  const handleHostKick = useCallback(
    (targetSlot) => {
      socketRef.current?.emit("host-kick", targetSlot, (res) => {
        if (!res?.ok) setError(res?.error ?? "Kick failed");
      });
    },
    [socketRef]
  );

  async function handleCardClick(index) {
    if (isSpectator || isAnimating) return;
    if (!isMyTurn) {
      setError("Wait for your turn");
      return;
    }
    const hand = getHandCards(state.hands[mySlot]);
    const card = hand[index];
    if (!card) return;

    if (!isPlayable(card, state, mySlot)) {
      setError("This card can't be played on the pile");
      return;
    }

    if (card.value === ACTIONS.WILD || card.value === ACTIONS.WILD_DRAW_FOUR) {
      setColorPicker({ cardIndex: index });
      return;
    }

    await runAnimationSequence(async () => {
      await animatePlayToDiscard(mySlot, mySlot, index, card, null);
      const res = await emitAction({ type: "play", cardIndex: index, cardId: card.id }, { applyState: false });
      if (res?.ok && res.state) setState(res.state);
    });
  }

  async function handleColorChoice(color) {
    if (!colorPicker || isSpectator) return;
    const { cardIndex } = colorPicker;
    const hand = getHandCards(state.hands[mySlot]);
    const card = hand[cardIndex];
    setColorPicker(null);
    if (!card) return;

    await runAnimationSequence(async () => {
      await animatePlayToDiscard(mySlot, mySlot, cardIndex, card, color);
      const res = await emitAction(
        { type: "play", cardIndex, cardId: card.id, chosenColor: color },
        { applyState: false }
      );
      if (res?.ok && res.state) setState(res.state);
    });
  }

  async function runDrawAnimation() {
    if (localDrawAnimatingRef.current) return null;
    const beforeHand = getHandCards(state.hands[mySlot]);
    const beforeLen = beforeHand.length;
    localDrawAnimatingRef.current = true;
    droppedPayloadRef.current = null;
    let res;
    // the whole round-trip is one animation hold, so a second click during the
    // server wait is blocked by isAnimating as well as by the ref above
    await runAnimationSequence(async () => {
      res = await emitAction({ type: "draw" }, { applyState: false });
      if (!res?.ok || !res.state) return;

      const targetState = res.state;
      const finalHand = getHandCards(targetState.hands[mySlot]);
      const drawn = finalHand.slice(beforeLen);

      if (drawn.length === 0) {
        setState(targetState);
        return;
      }

      const startPileLen = stateRef.current.drawPile.length;
      const endPileLen = targetState.drawPile.length;

      for (let i = 0; i < drawn.length; i += 1) {
        await animateDrawFromPile(mySlot, mySlot, drawn[i]);
        const visibleCount = Math.min(finalHand.length, beforeLen + i + 1);
        const revealHand = finalHand.slice(0, visibleCount);
        const pileLen = Math.max(endPileLen, startPileLen - (i + 1));
        setState((prev) => ({
          ...prev,
          drawPile:
            prev.drawPile.length > pileLen ? prev.drawPile.slice(0, pileLen) : prev.drawPile,
          hands: prev.hands.map((hand, idx) => (idx === mySlot ? revealHand : hand)),
        }));
      }
      setState(targetState);
    }).finally(() => {
      localDrawAnimatingRef.current = false;
      // if the ack failed but the broadcast for this draw arrived meanwhile, apply it now
      const dropped = droppedPayloadRef.current;
      droppedPayloadRef.current = null;
      if (!res?.ok && dropped) enqueueServerPayload(dropped);
    });
    return res;
  }

  async function handleDraw() {
    if (isSpectator || !isMyTurn || state.winner !== null || isAnimating) return;
    if (localDrawAnimatingRef.current) return;
    if (state.pendingDraw > 0) {
      const amount = drawMove?.amount ?? state.pendingDraw;
      await runDrawAnimation(amount);
      return;
    }
    if (!canHumanDraw || !drawMove) return;
    await runDrawAnimation(drawMove.amount ?? 1);
  }

  async function handlePenaltyDraw() {
    if (isSpectator || !canPenaltyDraw || isAnimating) return;
    if (localDrawAnimatingRef.current) return;
    const amount = drawMove?.amount ?? penaltyDrawAmount;
    await runDrawAnimation(amount);
  }

  async function handleEndTurn() {
    if (isSpectator || !showEndTurnBtn || isAnimating) return;
    await emitAction({ type: "pass" });
  }

  async function handleCallUno() {
    if (isSpectator || isAnimating) return;
    await emitAction({ type: "uno" });
  }

  function handleLeave() {
    socketRef.current?.emit("leave-room");
    onExit();
  }

  function handleRestartSameRules() {
    if (isAnimating) return;
    socketRef.current?.emit("restart-game", (res) => {
      if (!res?.ok) setError(res?.error ?? "Could not restart game");
    });
  }

  function handleChangeRules() {
    if (isAnimating) return;
    socketRef.current?.emit("return-lobby", (res) => {
      if (!res?.ok) setError(res?.error ?? "Could not return to lobby");
    });
  }

  const displayHumanPlayer = isSpectator ? Math.max(0, (state.playerCount ?? playerNames.length) - 1) : mySlot;

  return (
    <>
      {info ? (
        <div className="game-toast game-toast-info" role="status">
          {info}
          <button type="button" onClick={() => setInfo(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ) : null}
      {error ? (
        <div className="game-toast" role="alert">
          {error}
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ) : null}
      <PlayerModeration
        roster={roster}
        voteKick={voteKick}
        hostId={hostId}
        myPlayerId={myPlayerId}
        mySlot={mySlot}
        isSpectator={isSpectator}
        onVoteKick={handleVoteKick}
        onHostKick={handleHostKick}
      />
      <GameTable
        state={state}
        humanPlayer={displayHumanPlayer}
        playerNames={playerNames}
        tableRef={tableRef}
        isAnimating={isAnimating}
        isMyTurn={isMyTurn}
        isSpectator={isSpectator}
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
        onNewGame={handleLeave}
        onRestartSameRules={handleRestartSameRules}
        onChangeRules={handleChangeRules}
        canManageGameEnd={myPlayerId === hostId}
        newGameLabel="Leave table"
        showWinnerModal
      />
    </>
  );
}

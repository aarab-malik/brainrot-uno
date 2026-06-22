import { useEffect, useMemo, useState } from "react";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  MIN_STARTING_HAND,
  STARTING_HAND_SIZE,
  maxStartingHandForPlayers,
} from "@shared/gameLogic.js";

export default function OnlineScreen({
  connected,
  connectError,
  onBack,
  onHost,
  onJoin,
  lobby,
  myPlayerId,
  error,
  onStartGame,
  onSetMaxPlayers,
  onSetStartingHandSize,
  onLeaveLobby,
  onEnterGame,
  gamePayload,
}) {
  const [name, setName] = useState(() => localStorage.getItem("uno-name") || "");
  const [joinCode, setJoinCode] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [startingHandSize, setStartingHandSize] = useState(STARTING_HAND_SIZE);
  const [publicUrl, setPublicUrl] = useState(null);
  const [view, setView] = useState("pick");
  const [busy, setBusy] = useState(false);

  const hostMaxHand = useMemo(() => maxStartingHandForPlayers(maxPlayers), [maxPlayers]);

  useEffect(() => {
    if (gamePayload) onEnterGame(gamePayload);
  }, [gamePayload, onEnterGame]);

  useEffect(() => {
    if (lobby) {
      setView("lobby");
      if (lobby.maxPlayers) setMaxPlayers(lobby.maxPlayers);
      if (lobby.startingHandSize) setStartingHandSize(lobby.startingHandSize);
    }
  }, [lobby]);

  useEffect(() => {
    setStartingHandSize((h) => Math.min(hostMaxHand, Math.max(MIN_STARTING_HAND, h)));
  }, [hostMaxHand]);

  useEffect(() => {
    if (!lobby || lobby.hostId !== myPlayerId) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/__ngrok_url");
        const data = await res.json();
        if (!cancelled && data.url) setPublicUrl(data.url);
      } catch {
        if (!cancelled) setPublicUrl(null);
      }
    };
    load();
    const timer = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [lobby, myPlayerId]);

  async function submitHost() {
    const trimmed = name.trim();
    if (!trimmed) return;
    localStorage.setItem("uno-name", trimmed);
    setBusy(true);
    await onHost(trimmed, maxPlayers, startingHandSize);
    setBusy(false);
  }

  async function submitJoin() {
    const trimmed = name.trim();
    const code = joinCode.trim().toUpperCase();
    if (!trimmed || code.length < 4) return;
    localStorage.setItem("uno-name", trimmed);
    setBusy(true);
    await onJoin(code, trimmed);
    setBusy(false);
  }

  async function changeRoomSize(next) {
    const n = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, next));
    setMaxPlayers(n);
    if (lobby && lobby.hostId === myPlayerId) {
      await onSetMaxPlayers(n);
    }
  }

  async function changeStartingHand(next) {
    const cap = lobby?.maxStartingHand ?? maxStartingHandForPlayers(maxPlayers);
    const n = Math.min(cap, Math.max(MIN_STARTING_HAND, next));
    setStartingHandSize(n);
    if (lobby && lobby.hostId === myPlayerId) {
      await onSetStartingHandSize(n);
    }
  }

  if (lobby) {
    const isHost = lobby.hostId === myPlayerId;
    const filled = lobby.players.length;
    const cap = lobby.maxPlayers ?? MAX_PLAYERS;
    const handCap = lobby.maxStartingHand ?? maxStartingHandForPlayers(cap);
    const handSize = lobby.startingHandSize ?? startingHandSize;
    const canStart = filled >= MIN_PLAYERS;
    const sortedPlayers = [...lobby.players].sort((a, b) => a.slot - b.slot);

    return (
      <div className="party-screen lobby-screen">
        <button type="button" className="party-back" onClick={onLeaveLobby}>
          ← Leave room
        </button>

        <div className="party-stage lobby-stage">
        <div className="lobby-card lobby-card-wide">
          <p className="party-kicker">Room lobby</p>
          <h2 className="lobby-heading">Share this code</h2>

          <div className="room-code-display">
            <span className="room-code">{lobby.code}</span>
            <button
              type="button"
              className="party-btn party-btn-ghost party-btn-sm"
              onClick={() => navigator.clipboard?.writeText(lobby.code)}
            >
              Copy code
            </button>
          </div>

          {isHost ? (
            <div className="public-link-box">
              <p className="public-link-label">Play over the internet (ngrok)</p>
              {publicUrl ? (
                <>
                  <div className="public-link-row">
                    <code className="public-link-url">{publicUrl}</code>
                    <button
                      type="button"
                      className="party-btn party-btn-ghost party-btn-sm"
                      onClick={() => navigator.clipboard?.writeText(publicUrl)}
                    >
                      Copy link
                    </button>
                  </div>
                  <p className="party-hint public-link-hint">
                    Send this link to friends so they can join your room.
                  </p>
                </>
              ) : (
                <p className="party-hint public-link-hint">
                  Share link will appear here shortly.
                </p>
              )}
            </div>
          ) : publicUrl ? (
            <p className="party-hint">Join at: {publicUrl}</p>
          ) : null}

          <p className="lobby-hint">
            {filled}/{cap} players · {handSize} cards each · min {MIN_PLAYERS} to start
            {isHost ? " · You are the host" : " · Waiting for host"}
          </p>

          {isHost ? (
            <div className="lobby-host-settings">
              <div className="party-field lobby-size-field">
                <span id="lobby-max-players-label">Max players</span>
                <div
                  className="player-count-picker compact-picker"
                  role="group"
                  aria-labelledby="lobby-max-players-label"
                >
                  <button
                    type="button"
                    className="count-step count-step-minus"
                    disabled={maxPlayers <= Math.max(MIN_PLAYERS, filled)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      changeRoomSize(maxPlayers - 1);
                      e.currentTarget.blur();
                    }}
                  >
                    −
                  </button>
                  <span className="count-display-inline">{maxPlayers}</span>
                  <button
                    type="button"
                    className="count-step count-step-plus"
                    disabled={maxPlayers >= MAX_PLAYERS}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      changeRoomSize(maxPlayers + 1);
                      e.currentTarget.blur();
                    }}
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="party-field lobby-size-field">
                <span id="lobby-hand-size-label">
                  Starting cards each ({MIN_STARTING_HAND}–{handCap}, {20} left in draw pile)
                </span>
                <div
                  className="player-count-picker compact-picker"
                  role="group"
                  aria-labelledby="lobby-hand-size-label"
                >
                  <button
                    type="button"
                    className="count-step count-step-minus"
                    disabled={handSize <= MIN_STARTING_HAND}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      changeStartingHand(handSize - 1);
                      e.currentTarget.blur();
                    }}
                  >
                    −
                  </button>
                  <span className="count-display-inline">{handSize}</span>
                  <button
                    type="button"
                    className="count-step count-step-plus"
                    disabled={handSize >= handCap}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      changeStartingHand(handSize + 1);
                      e.currentTarget.blur();
                    }}
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <p className="lobby-hint lobby-hand-hint">
              Starting hand: <strong>{handSize}</strong> cards per player
            </p>
          )}

          <h3 className="lobby-players-heading">In this room</h3>
          <ul className="lobby-players">
            {sortedPlayers.map((player) => (
              <li key={player.id} className="lobby-slot filled">
                <span className="slot-num">#{player.slot + 1}</span>
                <span className="slot-name">{player.name}</span>
                <span className="slot-badges">
                  {player.id === lobby.hostId ? (
                    <span className="slot-badge">Host</span>
                  ) : null}
                  {player.id === myPlayerId ? <span className="slot-badge you">You</span> : null}
                </span>
              </li>
            ))}
          </ul>
          {filled < cap ? (
            <p className="lobby-open-seats">
              {cap - filled} open seat{cap - filled === 1 ? "" : "s"}
            </p>
          ) : null}

          {!connected ? (
            <div className="server-status-box">
              <p className="party-error">
                {connectError ? "Game server offline" : "Connecting to game server…"}
              </p>
              {connectError ? (
                <p className="party-hint server-hint">
                  On the <strong>host PC</strong>, run <code>npm run dev</code> and keep it open
                  (one port: 5173).
                </p>
              ) : null}
            </div>
          ) : null}
          {error ? <p className="party-error">{error}</p> : null}

          {isHost ? (
            <button
              type="button"
              className="party-btn party-btn-primary party-btn-wide"
              disabled={!canStart || busy}
              onClick={() => {
                setBusy(true);
                onStartGame();
                setBusy(false);
              }}
            >
              {canStart
                ? `Start with ${filled} player${filled === 1 ? "" : "s"}`
                : `Need at least ${MIN_PLAYERS} players`}
            </button>
          ) : (
            <p className="lobby-wait-host">Hang tight — host will start when ready.</p>
          )}
        </div>
        </div>
      </div>
    );
  }

  return (
    <div className="party-screen online-screen">
      <button type="button" className="party-back" onClick={onBack}>
        ← Back
      </button>

      <div className="party-stage menu-stage">
      <div className="online-panel">
        <p className="party-kicker">Online · {MIN_PLAYERS}–{MAX_PLAYERS} players</p>
        <h2 className="online-heading">
          {view === "join" ? "Join a room" : "Multiplayer"}
        </h2>

        <label className="party-field">
          <span>Your name</span>
          <input
            type="text"
            maxLength={16}
            placeholder="Nickname"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        {view === "pick" ? (
          <div className="online-actions">
            <button
              type="button"
              className="party-btn party-btn-primary"
              disabled={!name.trim() || busy || !connected}
              onClick={submitHost}
            >
              {connected ? "Create room" : "Connecting…"}
            </button>
            <button type="button" className="party-btn party-btn-secondary" onClick={() => setView("join")}>
              Join with code
            </button>
          </div>
        ) : null}

        {view === "join" ? (
          <div className="online-actions">
            <label className="party-field">
              <span>Room code</span>
              <input
                type="text"
                maxLength={6}
                placeholder="ABCD12"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                className="code-input"
              />
            </label>
            <button
              type="button"
              className="party-btn party-btn-primary party-btn-wide"
              disabled={!name.trim() || joinCode.length < 4 || busy || !connected}
              onClick={submitJoin}
            >
              Join room
            </button>
            <button type="button" className="party-btn party-btn-ghost party-btn-wide" onClick={() => setView("pick")}>
              Back to multiplayer
            </button>
            <p className="party-hint">
              Mid-game? Use the same display name as before — you will rejoin your seat or spectate if
              the 60s window passed.
            </p>
          </div>
        ) : null}

        {error ? <p className="party-error">{error}</p> : null}
        {!connected ? (
          <div className="server-status-box">
            <p className="party-error">
              {connectError ? "Game server offline" : "Connecting to game server…"}
            </p>
            {connectError ? (
              <p className="party-hint server-hint">
                Host must run <code>npm run dev</code> in the project folder and leave it open.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      </div>
    </div>
  );
}

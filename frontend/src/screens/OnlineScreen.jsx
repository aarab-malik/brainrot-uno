import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_GAME_RULES,
  MAX_PLAYERS,
  MIN_PLAYERS,
  MIN_STARTING_HAND,
  STARTING_HAND_SIZE,
  maxStartingHandForPlayers,
  normalizeGameRules,
} from "@shared/gameLogic.js";

const RULE_TOGGLES = [
  {
    key: "allowDrawTwoOnDrawTwo",
    title: "1. Allow +2 on +2",
    detail:
      "If off, a player hit by +2 cannot counter with +2 and must draw +2.",
  },
  {
    key: "allowDrawTwoOnDrawFour",
    title: "2. Allow +2 on +4",
    detail:
      "If on, +2 can counter +4 only when its color matches the color chosen by the +4.",
  },
  {
    key: "allowDrawFourOnDrawTwo",
    title: "3. Allow +4 on +2",
    detail: "If on, +4 can counter +2 and passes +6 to the next player.",
  },
  {
    key: "allowDrawFourOnDrawFour",
    title: "4. Allow +4 on +4",
    detail: "If off, a player hit by +4 must draw and cannot counter with +4.",
  },
  {
    key: "drawTwoSkipsTurn",
    title: "5. Drawing +2 skips turn",
    detail:
      "If on, drawing a +2 penalty ends your turn immediately.",
  },
  {
    key: "drawFourSkipsTurn",
    title: "6. Drawing +4 skips turn",
    detail:
      "If on, drawing a +4 penalty ends your turn immediately.",
  },
  {
    key: "allowSkipReverseOnDrawTwo",
    title: "7. Allow Skip/Reverse on +2",
    detail:
      "If on, draw +2 can be skipped to the next player/reversed to the previous player only if their color matches the +2.",
  },
];

function rulesEqual(a, b) {
  const keys = Object.keys(DEFAULT_GAME_RULES);
  return keys.every((key) => !!a?.[key] === !!b?.[key]);
}

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
  onSetRoomRules,
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
  const [lobbyView, setLobbyView] = useState("main");
  const [busy, setBusy] = useState(false);
  const [rulesBusy, setRulesBusy] = useState(false);
  const [draftRules, setDraftRules] = useState(() => normalizeGameRules(DEFAULT_GAME_RULES));

  const hostMaxHand = useMemo(() => maxStartingHandForPlayers(maxPlayers), [maxPlayers]);

  useEffect(() => {
    if (gamePayload) onEnterGame(gamePayload);
  }, [gamePayload, onEnterGame]);

  useEffect(() => {
    if (lobby) {
      setView("lobby");
      if (lobby.maxPlayers) setMaxPlayers(lobby.maxPlayers);
      if (lobby.startingHandSize) setStartingHandSize(lobby.startingHandSize);
      setDraftRules(normalizeGameRules(lobby.rules ?? DEFAULT_GAME_RULES));
    }
  }, [lobby]);

  useEffect(() => {
    if (!lobby) {
      setLobbyView("main");
      setDraftRules(normalizeGameRules(DEFAULT_GAME_RULES));
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

  function changeRule(ruleKey, value) {
    const nextRules = normalizeGameRules({
      ...draftRules,
      [ruleKey]: value,
    });
    setDraftRules(nextRules);
  }

  async function saveRules() {
    if (!lobby || lobby.hostId !== myPlayerId || !onSetRoomRules) return;
    setRulesBusy(true);
    const res = await onSetRoomRules(draftRules);
    setRulesBusy(false);
    if (res?.rules) {
      setDraftRules(normalizeGameRules(res.rules));
    }
  }

  if (lobby) {
    const isHost = lobby.hostId === myPlayerId;
    const filled = lobby.players.length;
    const cap = lobby.maxPlayers ?? MAX_PLAYERS;
    const handCap = lobby.maxStartingHand ?? maxStartingHandForPlayers(cap);
    const handSize = lobby.startingHandSize ?? startingHandSize;
    const activeRules = normalizeGameRules(lobby.rules ?? DEFAULT_GAME_RULES);
    const isRulesDirty = !rulesEqual(draftRules, activeRules);
    const canStart = filled >= MIN_PLAYERS;
    const sortedPlayers = [...lobby.players].sort((a, b) => a.slot - b.slot);

    if (lobbyView === "rules") {
      return (
        <div className="party-screen lobby-screen">
          <button type="button" className="party-back" onClick={onLeaveLobby}>
            ← Leave room
          </button>

          <div className="party-stage lobby-stage">
            <div className="lobby-card lobby-card-wide lobby-rules-card">
              <p className="party-kicker">Room lobby</p>
              <h2 className="lobby-heading rules-heading">
                Customize Rules
                {isHost && isRulesDirty ? <span className="rules-unsaved-badge">Unsaved changes</span> : null}
              </h2>
              <p className="lobby-hint">
                {isHost
                  ? "Toggle any combination before starting the match."
                  : "Host controls the toggles. You can view current rule setup here."}
              </p>

              <ul className="rules-toggle-list">
                {RULE_TOGGLES.map((rule) => (
                  <li key={rule.key}>
                    <label className={`rule-toggle ${!isHost ? "read-only" : ""}`}>
                      <input
                        className="rule-toggle-input"
                        type="checkbox"
                        checked={!!draftRules[rule.key]}
                        disabled={!isHost || rulesBusy}
                        onChange={(e) => changeRule(rule.key, e.target.checked)}
                      />
                      <span className="rule-toggle-switch" aria-hidden />
                      <span className="rule-toggle-copy">
                        <strong>{rule.title}</strong>
                        <span>{rule.detail}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>

              {isHost ? (
                <p className="party-hint rules-saving-hint">
                  {rulesBusy
                    ? "Saving rules…"
                    : isRulesDirty
                      ? "You have unsaved rule changes."
                      : "Rules are up to date for everyone in this lobby."}
                </p>
              ) : null}

              <div className="rules-actions">
                {isHost ? (
                  <button
                    type="button"
                    className="party-btn party-btn-primary party-btn-wide"
                    disabled={rulesBusy || !isRulesDirty}
                    onClick={saveRules}
                  >
                    {rulesBusy ? "Saving…" : "Save Rules"}
                  </button>
                ) : null}

                <button
                  type="button"
                  className="party-btn party-btn-ghost party-btn-wide"
                  onClick={() => setLobbyView("main")}
                >
                  Back to room
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

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
              <p className="public-link-label">Public link</p>
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
                  Friends on your Wi-Fi can join with the code. For friends elsewhere, start the server with an
                  ngrok token and a link appears here.
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

          <button
            type="button"
            className="party-btn party-btn-ghost party-btn-wide"
            onClick={() => setLobbyView("rules")}
          >
            {isHost ? "Customize rules" : "View rules"}
          </button>

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

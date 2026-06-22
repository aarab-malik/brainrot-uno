import { useState } from "react";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  MIN_STARTING_HAND,
  STARTING_HAND_SIZE,
  maxStartingHandForPlayers,
} from "@shared/gameLogic.js";
import { getSeatAngles } from "../utils/seatLayout";

export default function BotSetupScreen({ onBack, onStart }) {
  const [playerCount, setPlayerCount] = useState(3);
  const [startingHandSize, setStartingHandSize] = useState(STARTING_HAND_SIZE);
  const maxHand = maxStartingHandForPlayers(playerCount);

  return (
    <div className="party-screen bot-setup-screen">
      <button type="button" className="party-back" onClick={onBack}>
        ← Back
      </button>

      <div className="party-stage menu-stage">
      <div className="online-panel setup-panel">
        <p className="party-kicker">Vs bots</p>
        <h2 className="online-heading">How many players?</h2>
        <p className="setup-desc">
          You sit at the bottom. Everyone else is a bot. Choose {MIN_PLAYERS}–{MAX_PLAYERS} players.
        </p>

        <div className="player-count-picker">
          <button
            type="button"
            className="count-step count-step-minus"
            disabled={playerCount <= MIN_PLAYERS}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              setPlayerCount((n) => Math.max(MIN_PLAYERS, n - 1));
              e.currentTarget.blur();
            }}
            aria-label="Fewer players"
          >
            −
          </button>
          <div className="count-display">
            <span className="count-big">{playerCount}</span>
            <span className="count-label">players</span>
          </div>
          <button
            type="button"
            className="count-step count-step-plus"
            disabled={playerCount >= MAX_PLAYERS}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              setPlayerCount((n) => Math.min(MAX_PLAYERS, n + 1));
              e.currentTarget.blur();
            }}
            aria-label="More players"
          >
            +
          </button>
        </div>

        <input
          type="range"
          className="count-slider"
          min={MIN_PLAYERS}
          max={MAX_PLAYERS}
          value={playerCount}
          onChange={(e) => {
            const n = Number(e.target.value);
            setPlayerCount(n);
            setStartingHandSize((h) => Math.min(maxStartingHandForPlayers(n), h));
          }}
        />

        <label className="party-field">
          <span>
            Starting cards each ({MIN_STARTING_HAND}–{maxHand})
          </span>
          <input
            type="range"
            className="count-slider"
            min={MIN_STARTING_HAND}
            max={maxHand}
            value={Math.min(startingHandSize, maxHand)}
            onChange={(e) => setStartingHandSize(Number(e.target.value))}
          />
          <span className="range-value">{Math.min(startingHandSize, maxHand)} cards</span>
        </label>

        <div className="seat-preview" aria-hidden>
          {getSeatAngles(playerCount, playerCount - 1).map((deg, i) => (
            <span
              key={i}
              className={`seat-dot ${i === playerCount - 1 ? "you" : "bot"}`}
              style={{
                left: `${50 + 38 * Math.cos((deg * Math.PI) / 180)}%`,
                top: `${50 + 38 * Math.sin((deg * Math.PI) / 180)}%`,
              }}
            />
          ))}
        </div>

        <button
          type="button"
          className="party-btn party-btn-primary party-btn-wide"
          onClick={() => onStart(playerCount, Math.min(startingHandSize, maxHand))}
        >
          Start game
        </button>
      </div>
      </div>
    </div>
  );
}

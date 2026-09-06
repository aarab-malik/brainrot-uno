import { useEffect, useMemo, useState } from "react";

export default function PlayerModeration({
  roster,
  voteKick,
  hostId,
  myPlayerId,
  mySlot,
  isSpectator,
  onVoteKick,
  onHostKick,
}) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // awayMs is a snapshot taken when this roster arrived; add elapsed time to keep the countdown live.
  const rosterReceivedAt = useMemo(() => Date.now(), [roster]);
  const anyAway = useMemo(
    () => !!roster?.some((entry) => !entry.folded && !entry.connected && entry.awayMs != null),
    [roster]
  );

  useEffect(() => {
    if (!anyAway) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [anyAway, roster]);

  if (!roster?.length) return null;

  const isHost = hostId === myPlayerId;
  const canVote = !isSpectator && mySlot != null;

  return (
    <div
      className={`player-moderation ${open ? "is-open" : "is-collapsed"}`}
      aria-label="Players and moderation"
    >
      <button
        type="button"
        className="player-moderation-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>Players</span>
        <span className="player-moderation-chevron" aria-hidden>
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open ? (
        <div className="player-moderation-body">
          <ul className="player-moderation-list">
            {roster.map((entry) => {
              const isMe = entry.slot === mySlot;
              const status = entry.folded
                ? "Out"
                : entry.connected
                  ? "In"
                  : entry.awayMs != null
                    ? `Away ${Math.max(
                        0,
                        60 - Math.floor((entry.awayMs + Math.max(0, now - rosterReceivedAt)) / 1000)
                      )}s`
                    : "Away";
              const voteActive = voteKick?.targetSlot === entry.slot;
              const voted = voteActive && voteKick.votes > 0;

              return (
                <li
                  key={entry.slot}
                  className={`player-moderation-row ${entry.folded ? "folded" : ""} ${!entry.connected ? "away" : ""}`}
                >
                  <span className="player-moderation-name">
                    {entry.name}
                    {isMe ? " (you)" : ""}
                  </span>
                  <span className="player-moderation-status">{status}</span>
                  <span className="player-moderation-actions">
                    {canVote && !isMe && !entry.folded ? (
                      <button
                        type="button"
                        className="mod-btn mod-btn-vote"
                        onClick={() => onVoteKick(entry.slot)}
                        title={`Vote to kick (${voteKick?.needed ?? "?"} needed)`}
                      >
                        {voteActive ? `Vote ${voteKick.votes}/${voteKick.needed}` : "Vote kick"}
                      </button>
                    ) : null}
                    {isHost && !isMe && !entry.folded ? (
                      <button
                        type="button"
                        className="mod-btn mod-btn-host"
                        onClick={() => onHostKick(entry.slot)}
                      >
                        Kick
                      </button>
                    ) : null}
                    {voted && !canVote && !isHost ? (
                      <span className="vote-kick-progress">
                        {voteKick.votes}/{voteKick.needed}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
          {voteKick ? (
            <p className="player-moderation-hint">
              Vote kick: {voteKick.targetName} — {voteKick.votes}/{voteKick.needed} votes
            </p>
          ) : null}
          {isSpectator ? (
            <p className="player-moderation-hint">You are spectating this match.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

import { MAX_PLAYERS, MIN_PLAYERS } from "@shared/gameLogic.js";

export default function HomeScreen({ onPlayBots, onPlayOnline }) {
  return (
    <div className="home-screen">
      <header className="home-top">
        <span className="inks" aria-hidden="true">
          <i style={{ background: "var(--red)" }} />
          <i style={{ background: "var(--blue)" }} />
          <i style={{ background: "var(--yellow)" }} />
          <i style={{ background: "var(--green)" }} />
        </span>
        <span>
          {MIN_PLAYERS}–{MAX_PLAYERS} players · one table
        </span>
      </header>

      <div className="home-body">
        <div>
          <h1 className="home-title">
            <span className="line overprint" data-text="Brain">
              Brain
            </span>
            <span className="line overprint" data-text="rot">
              rot
            </span>
            <span className="line line-uno">UNO</span>
          </h1>
          <p className="home-sub">
            UNO with the house rules your friends argue about. Stack a +2 on a +2, shout UNO before
            someone catches you, drop a +4 on a +4 and watch the group chat melt.
          </p>
        </div>

        <nav className="home-choices" aria-label="Choose how to play">
          <button type="button" className="mode-card mode-card-bots" onClick={onPlayBots}>
            <span className="ellipse ghost" aria-hidden="true" />
            <span className="ellipse" aria-hidden="true" />
            <span className="corner">Solo</span>
            <span>
              <span className="mode-label">Play the bots</span>
              <span className="mode-desc">A quick table against up to 15 computer players.</span>
            </span>
            <span className="corner bottom" aria-hidden="true">
              Solo
            </span>
          </button>

          <button type="button" className="mode-card mode-card-online" onClick={onPlayOnline}>
            <span className="ellipse ghost" aria-hidden="true" />
            <span className="ellipse" aria-hidden="true" />
            <span className="corner">Online</span>
            <span>
              <span className="mode-label">Play with friends</span>
              <span className="mode-desc">Host a room and share a six-letter code, or join one.</span>
            </span>
            <span className="corner bottom" aria-hidden="true">
              Online
            </span>
          </button>
        </nav>
      </div>

      <footer className="home-footer">
        <span>Made by Aarab Malik</span>
        <span>Rules: stacking, UNO calls, custom house rules per room</span>
      </footer>
    </div>
  );
}

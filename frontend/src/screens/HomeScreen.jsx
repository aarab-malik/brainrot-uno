export default function HomeScreen({ onPlayBots, onPlayOnline }) {
  return (
    <div className="party-screen home-screen">
      <div className="home-ambient" aria-hidden>
        <span className="uno-dot uno-dot-red" />
        <span className="uno-dot uno-dot-blue" />
        <span className="uno-dot uno-dot-yellow" />
        <span className="uno-dot uno-dot-green" />
      </div>

      <div className="home-lane">
        <header className="home-title-header">
          <p className="party-kicker">Tabletop card room</p>
          <h1 className="party-title">
            Brainrot <span>UNO</span>
          </h1>
          <p className="party-credits">Created by Aarab Malik</p>
        </header>

        <main className="home-choices" aria-label="Choose game mode">
          <button type="button" className="mode-card mode-card-bots" onClick={onPlayBots}>
            <span className="mode-stripe" aria-hidden />
            <span className="mode-number">01</span>
            <span className="mode-label">AI Table</span>
            <span className="mode-desc">Solo match against computer players</span>
          </button>

          <button type="button" className="mode-card mode-card-online" onClick={onPlayOnline}>
            <span className="mode-stripe" aria-hidden />
            <span className="mode-number">02</span>
            <span className="mode-label">Multiplayer</span>
            <span className="mode-desc">Host a room or join friends online</span>
          </button>
        </main>

        <footer className="home-footer">
          <span>2–16 players online · UNO calls · draw stacks · cozy table view</span>
        </footer>
      </div>
    </div>
  );
}

export default function WildColorDpad({ onPick }) {
  return (
    <div className="wild-dpad-overlay">
      <div className="wild-dpad-menu" role="dialog" aria-label="Choose wild color">
        <p className="wild-dpad-title">Choose color</p>
        <div className="wild-dpad-cross">
          <button type="button" className="wild-dpad-btn wild-dpad-up red" onClick={() => onPick("Red")}>
            Red
          </button>
          <button
            type="button"
            className="wild-dpad-btn wild-dpad-left yellow"
            onClick={() => onPick("Yellow")}
          >
            Yellow
          </button>
          <div className="wild-dpad-center" aria-hidden>
            +
          </div>
          <button type="button" className="wild-dpad-btn wild-dpad-right blue" onClick={() => onPick("Blue")}>
            Blue
          </button>
          <button
            type="button"
            className="wild-dpad-btn wild-dpad-down green"
            onClick={() => onPick("Green")}
          >
            Green
          </button>
        </div>
      </div>
    </div>
  );
}

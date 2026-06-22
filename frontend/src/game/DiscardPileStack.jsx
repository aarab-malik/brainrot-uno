import CardSprite from "../components/CardSprite";

/** Top card full; up to 2 cards beneath, slightly grayed. */
export default function DiscardPileStack({ discardPile, topCard }) {
  const pile = Array.isArray(discardPile) ? discardPile : [];
  const top = topCard ?? pile[pile.length - 1] ?? null;
  if (!top) return null;

  const lastThree = pile.slice(-3);
  const under = lastThree.length > 1 ? lastThree.slice(0, -1) : [];

  return (
    <div className="discard-pile-stack" data-anchor="discard-pile">
      {under.map((card, i) => (
        <CardSprite
          key={card.id}
          card={card}
          className={`pile-under pile-under-${i}`}
          dim
        />
      ))}
      <CardSprite key={top.id} card={top} className="pile-top pile-settle" />
    </div>
  );
}

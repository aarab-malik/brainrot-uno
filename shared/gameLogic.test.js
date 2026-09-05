import { describe, expect, it } from "vitest";
import {
  ACTIONS,
  DECK_SIZE,
  DEFAULT_GAME_RULES,
  applyCallUno,
  applyDraw,
  applyPlay,
  foldSlotIntoDrawPile,
  getValidMoves,
  makeInitialGameState,
} from "./gameLogic.js";

const card = (color, value) => ({ color, value, id: `${color}-${value}-${Math.random()}` });

/** Deterministic state: 3 players, one card each unless overridden. */
function fixture(overrides = {}) {
  const base = makeInitialGameState(3, 4, DEFAULT_GAME_RULES);
  const top = card("Red", 5);
  return {
    ...base,
    hands: [
      [card("Red", 1), card("Blue", 2)],
      [card("Red", 3), card("Blue", 4)],
      [card("Red", 7), card("Green", 9)],
    ],
    topCard: top,
    discardPile: [top],
    currentPlayer: 0,
    direction: 1,
    pendingDraw: 0,
    drawStackType: null,
    mayPassAfterDraw: false,
    unoPending: null,
    unoMissed: [false, false, false],
    foldedSlots: [false, false, false],
    ...overrides,
  };
}

describe("initial deal", () => {
  it("deals equal hands and leaves the rest in the draw pile", () => {
    const state = makeInitialGameState(4, 7);
    expect(state.hands).toHaveLength(4);
    state.hands.forEach((h) => expect(h).toHaveLength(7));
    expect(state.discardPile).toHaveLength(1);
    expect(typeof state.topCard.value).toBe("number");
    expect(state.drawPile.length + 4 * 7 + 1).toBe(DECK_SIZE);
  });
});

describe("turn advance and reverse", () => {
  it("advances clockwise after a number card", () => {
    const next = applyPlay(fixture(), 0, 0);
    expect(next.currentPlayer).toBe(1);
    expect(next.direction).toBe(1);
  });

  it("reverse with 3 players flips direction", () => {
    const state = fixture({ hands: [[card("Red", ACTIONS.REVERSE), card("Blue", 2)], [card("Red", 3)], [card("Red", 7)]] });
    const next = applyPlay(state, 0, 0);
    expect(next.direction).toBe(-1);
    expect(next.currentPlayer).toBe(2);
  });

  it("reverse with 2 active players acts as skip", () => {
    const state = fixture({
      hands: [[card("Red", ACTIONS.REVERSE), card("Blue", 2)], [card("Red", 3)], []],
      foldedSlots: [false, false, true],
    });
    const next = applyPlay(state, 0, 0);
    expect(next.currentPlayer).toBe(0);
    expect(next.direction).toBe(1);
  });
});

describe("draw-two stacking (default rules)", () => {
  it("stacks +2 on +2 and the final target draws the total and loses the turn", () => {
    const state = fixture({
      hands: [
        [card("Red", ACTIONS.DRAW_TWO), card("Blue", 2)],
        [card("Green", ACTIONS.DRAW_TWO), card("Blue", 4)],
        [card("Red", 7), card("Green", 9)],
      ],
    });
    const afterFirst = applyPlay(state, 0, 0);
    expect(afterFirst.pendingDraw).toBe(2);
    expect(afterFirst.currentPlayer).toBe(1);

    const moves = getValidMoves(afterFirst, 1);
    expect(moves.some((m) => m.type === "play" && m.cardIndex === 0)).toBe(true);
    expect(moves.some((m) => m.type === "play" && m.cardIndex === 1)).toBe(false);

    const afterStack = applyPlay(afterFirst, 1, 0);
    expect(afterStack.pendingDraw).toBe(4);
    expect(afterStack.currentPlayer).toBe(2);

    const drawMove = getValidMoves(afterStack, 2).find((m) => m.type === "draw");
    expect(drawMove.amount).toBe(4);
    const afterDraw = applyDraw(afterStack, 2, drawMove.amount);
    expect(afterDraw.hands[2]).toHaveLength(6);
    expect(afterDraw.pendingDraw).toBe(0);
    expect(afterDraw.currentPlayer).toBe(0);
  });
});

describe("reshuffle", () => {
  it("recycles the discard pile (minus the top card) when the draw pile is empty", () => {
    const top = card("Red", 5);
    const discard = [card("Blue", 1), card("Blue", 2), card("Blue", 3), top];
    const state = fixture({ drawPile: [], discardPile: discard, topCard: top });
    const next = applyDraw(state, 0, 2);
    expect(next.hands[0]).toHaveLength(4);
    expect(next.discardPile).toEqual([top]);
    expect(next.drawPile).toHaveLength(1);
    expect(next.topCard).toBe(top);
  });
});

describe("UNO call", () => {
  it("penalises going to one card without calling UNO", () => {
    const next = applyPlay(fixture(), 0, 0);
    expect(next.hands[0]).toHaveLength(1);
    expect(next.unoMissed[0]).toBe(true);
    // On their next turn the only move is the 2-card penalty draw.
    const penalised = { ...next, currentPlayer: 0 };
    expect(getValidMoves(penalised, 0)).toEqual([{ type: "draw", amount: 2, unoPenalty: true }]);
  });

  it("does not penalise after a pre-call", () => {
    const called = applyCallUno(fixture(), 0);
    expect(called.unoPending).toEqual({ playerIndex: 0, called: true });
    const next = applyPlay(called, 0, 0);
    expect(next.unoMissed[0]).toBe(false);
  });
});

describe("chosenColor validation", () => {
  it("rejects colors outside COLORS", () => {
    const state = fixture({ hands: [[card("Wild", ACTIONS.WILD), card("Blue", 2)], [card("Red", 3)], [card("Red", 7)]] });
    expect(() => applyPlay(state, 0, 0, "Purple")).toThrow(/color/i);
    expect(applyPlay(state, 0, 0, "Green").topCard.color).toBe("Green");
  });
});

describe("folding", () => {
  it("returns the hand to the draw pile and clears the folder's pending state", () => {
    const state = fixture({ pendingDraw: 2, drawStackType: ACTIONS.DRAW_TWO, mayPassAfterDraw: true });
    const pileBefore = state.drawPile.length;
    const next = foldSlotIntoDrawPile(state, 0);
    expect(next.hands[0]).toEqual([]);
    expect(next.drawPile).toHaveLength(pileBefore + 2);
    expect(next.pendingDraw).toBe(0);
    expect(next.mayPassAfterDraw).toBe(false);
    expect(next.currentPlayer).toBe(1);
    expect(next.winner).toBeNull();
  });

  it("declares the last remaining player the winner", () => {
    const state = fixture({ foldedSlots: [false, true, false], hands: [[card("Red", 1)], [], [card("Red", 7)]] });
    const next = foldSlotIntoDrawPile(state, 2);
    expect(next.winner).toBe(0);
    expect(next.currentPlayer).toBe(0);
  });
});

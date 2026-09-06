/**
 * End-to-end multiplayer test: a real Socket.io server on an ephemeral port,
 * real socket.io-client connections, and the shared rules engine on the client
 * side to pick moves from the *received* (redacted) state.
 */
import { createServer } from "node:http";
import { io as connectSocket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { attachGameServer } from "./setupGameServer.js";
import { handCount } from "./state.js";
import { ACTIONS, COLORS, getValidMoves, needsUnoCall } from "../shared/gameLogic.js";

const MAX_ACTIONS = 2000;
const ACK_TIMEOUT_MS = 4000;
const EVENT_TIMEOUT_MS = 4000;
const VISIBLE_DISCARD = 3;

// ---------------------------------------------------------------------------
// Crash detector (requirement 7)
// ---------------------------------------------------------------------------
const crashes = [];
const recordCrash = (err) => crashes.push(err);

beforeAll(() => {
  process.on("uncaughtException", recordCrash);
  process.on("unhandledRejection", recordCrash);
});
afterAll(() => {
  process.off("uncaughtException", recordCrash);
  process.off("unhandledRejection", recordCrash);
});
afterEach(() => {
  expect(crashes, "server threw an uncaught error").toEqual([]);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function check(cond, message) {
  if (!cond) throw new Error(message);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Buffers every server event per client so tests can await them in order. */
class Inbox {
  constructor(socket) {
    this.queues = new Map();
    this.waiters = new Map();
    socket.onAny((event, payload) => this.push(event, payload));
  }

  push(event, payload) {
    const waiters = this.waiters.get(event);
    if (waiters?.length) {
      waiters.shift()(payload);
      return;
    }
    if (!this.queues.has(event)) this.queues.set(event, []);
    this.queues.get(event).push(payload);
  }

  next(event, timeoutMs = EVENT_TIMEOUT_MS) {
    const queue = this.queues.get(event);
    if (queue?.length) return Promise.resolve(queue.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const list = this.waiters.get(event) ?? [];
        this.waiters.set(event, list.filter((w) => w !== resolver));
        reject(new Error(`timed out waiting for "${event}"`));
      }, timeoutMs);
      const resolver = (payload) => {
        clearTimeout(timer);
        resolve(payload);
      };
      if (!this.waiters.has(event)) this.waiters.set(event, []);
      this.waiters.get(event).push(resolver);
    });
  }

  drain(event) {
    const items = this.queues.get(event) ?? [];
    this.queues.set(event, []);
    return items;
  }

  count(event) {
    return this.queues.get(event)?.length ?? 0;
  }
}

function ask(socket, event, ...args) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ack for "${event}"`)), ACK_TIMEOUT_MS);
    socket.emit(event, ...args, (res) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

async function startServer(timings = {}) {
  const httpServer = createServer();
  const { io, rooms } = attachGameServer(httpServer, { timings });
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${httpServer.address().port}`;
  const clients = new Set();

  const connect = () =>
    new Promise((resolve, reject) => {
      const socket = connectSocket(url, {
        transports: ["websocket"],
        forceNew: true,
        reconnection: false,
      });
      const client = { socket, inbox: new Inbox(socket), slot: null, token: null, name: null };
      clients.add(client);
      socket.once("connect", () => resolve(client));
      socket.once("connect_error", reject);
    });

  const close = async () => {
    for (const c of clients) c.socket.disconnect();
    rooms.destroy();
    await new Promise((resolve) => io.close(resolve));
  };

  return { url, io, rooms, connect, close };
}

/** Host + (n-1) joiners in one lobby. Lobby updates are drained so game events start clean. */
async function makeRoom(server, n, { handSize = 5, rules, maxPlayers = n } = {}) {
  const host = await server.connect();
  const hosted = await ask(host.socket, "host-room", {
    name: "P0",
    maxPlayers,
    startingHandSize: handSize,
    rules,
  });
  expect(hosted.ok).toBe(true);
  Object.assign(host, { slot: hosted.slot, token: hosted.token, name: "P0" });
  const clients = [host];
  for (let i = 1; i < n; i += 1) {
    const c = await server.connect();
    const joined = await ask(c.socket, "join-room", { code: hosted.code, name: `P${i}` });
    expect(joined.ok).toBe(true);
    Object.assign(c, { slot: joined.slot, token: joined.token, name: `P${i}` });
    clients.push(c);
  }
  // Every join fans out a lobby-update; let them land, then clear.
  await wait(20);
  clients.forEach((c) => c.inbox.drain("lobby-update"));
  return { code: hosted.code, host, clients };
}

async function startGame(host, clients) {
  const ack = await ask(host.socket, "start-game");
  expect(ack).toMatchObject({ ok: true });
  await Promise.all(clients.map((c) => c.inbox.next("game-started")));
}

/** Exactly what the frontend does: derive legal moves from the redacted view. */
function chooseMove(state, slot) {
  const options = getValidMoves(state, slot).map((m) =>
    m.type === "play" ? { type: "play", cardIndex: m.cardIndex } : { type: "draw" }
  );
  if (state.mayPassAfterDraw) options.push({ type: "pass" });
  const unoDue = needsUnoCall(state, slot);
  if (unoDue) options.push({ type: "uno" });
  check(
    options.length > 0,
    `rules engine offers no legal move for slot ${slot}: ${JSON.stringify(state)}`
  );

  let move;
  const plays = options.filter((o) => o.type === "play");
  if (unoDue && Math.random() < 0.7) {
    move = { type: "uno" };
  } else if (plays.length && Math.random() < 0.8) {
    move = plays[Math.floor(Math.random() * plays.length)];
  } else {
    move = options[Math.floor(Math.random() * options.length)];
  }

  if (move.type === "play") {
    const card = state.hands[slot][move.cardIndex];
    if (card.value === ACTIONS.WILD || card.value === ACTIONS.WILD_DRAW_FOUR) {
      move = { ...move, chosenColor: COLORS[Math.floor(Math.random() * COLORS.length)] };
    }
  }
  return move;
}

function assertPrivateView(state, slot) {
  state.hands.forEach((hand, i) => {
    if (i === slot) {
      check(Array.isArray(hand), `own hand for slot ${slot} is not an array`);
      hand.forEach((card) => check(card && "value" in card, "own card missing value"));
      return;
    }
    check(!Array.isArray(hand), `slot ${slot} can see slot ${i}'s cards`);
    check(hand.hidden === true && typeof hand.count === "number", "opponent hand not {hidden,count}");
    check(Object.keys(hand).length === 2, `opponent hand leaks fields: ${Object.keys(hand)}`);
  });
  check(Array.isArray(state.drawPile), "drawPile missing");
  check(state.drawPile.length === state.drawPileCount, "drawPileCount mismatch");
  state.drawPile.forEach((c) =>
    check(c.hidden === true && c.color === undefined && c.value === undefined, "drawPile leaks a card")
  );
  check(state.discardPile.length <= VISIBLE_DISCARD, `discardPile too long: ${state.discardPile.length}`);
}

function fingerprint(state) {
  return JSON.stringify({
    currentPlayer: state.currentPlayer,
    top: state.topCard?.id ?? null,
    topColor: state.topCard?.color ?? null,
    winner: state.winner,
    counts: state.hands.map(handCount),
    draw: state.drawPileCount,
    turn: state.turnCount,
    direction: state.direction,
    pending: state.pendingDraw,
    folded: state.foldedSlots,
  });
}

function assertAgreement(states) {
  const first = fingerprint(states[0]);
  states.forEach((s, i) => check(fingerprint(s) === first, `client ${i} disagrees:\n${fingerprint(s)}\n${first}`));
}

/**
 * Drive one match to completion. Each successful action produces exactly one
 * game-update per connected player, so the loop is: collect N views, verify,
 * let the current player act, repeat.
 */
async function playMatch(clients, spectators = [], seed = null) {
  let actions = 0;
  let last = null;
  for (;;) {
    let updates;
    let specUpdates;
    try {
      if (seed) {
        ({ updates, specUpdates = [] } = seed);
        seed = null;
      } else {
        updates = await Promise.all(clients.map((c) => c.inbox.next("game-update")));
        specUpdates = await Promise.all(spectators.map((s) => s.inbox.next("game-update")));
      }
    } catch (err) {
      throw new Error(`${err.message} after action #${actions}: ${JSON.stringify(last)}`);
    }
    updates.forEach((u, i) => {
      check(u.yourSlot === clients[i].slot, `yourSlot ${u.yourSlot} !== ${clients[i].slot}`);
      check(u.isSpectator === false, "player flagged as spectator");
      assertPrivateView(u.state, clients[i].slot);
    });
    specUpdates.forEach((u) => {
      check(u.isSpectator === true && u.yourSlot === null, "spectator payload wrong");
      assertPrivateView(u.state, -1);
    });
    assertAgreement([...updates.map((u) => u.state), ...specUpdates.map((u) => u.state)]);

    const state = updates[0].state;
    if (state.winner !== null) return { actions, winner: state.winner };
    check(actions < MAX_ACTIONS, `match did not finish within ${MAX_ACTIONS} actions`);

    const actorIndex = clients.findIndex((c) => c.slot === state.currentPlayer);
    check(actorIndex !== -1, `turn is on slot ${state.currentPlayer}, which nobody holds`);
    const actor = clients[actorIndex];
    const move = chooseMove(updates[actorIndex].state, actor.slot);
    const ack = await ask(actor.socket, "game-action", move);
    check(ack?.ok === true, `legal move rejected: ${JSON.stringify({ move, ack })}`);
    last = { slot: actor.slot, move, ackState: { ...ack.state, hands: undefined, drawPile: undefined } };
    actions += 1;
  }
}

const card = (color, value, id = `${color}-${value}-${Math.random().toString(36).slice(2, 8)}`) => ({
  id,
  color,
  value,
});

/** Overwrite a room's state (white-box) and push it to clients, then drain those updates. */
async function setServerState(server, code, clients, patch) {
  const room = server.rooms.getRoom(code);
  room.gameState = { ...room.gameState, ...patch };
  server.rooms.emitGameState(room);
  return Promise.all(clients.map((c) => c.inbox.next("game-update")));
}

function snapshot(server, code) {
  return JSON.stringify(server.rooms.getRoom(code).gameState);
}

// ---------------------------------------------------------------------------
// 1. Full matches
// ---------------------------------------------------------------------------
describe("full online match", () => {
  let server;
  beforeAll(async () => {
    server = await startServer();
  });
  afterAll(() => server.close());

  for (const n of [2, 4, 8]) {
    it(
      `${n} players: two matches, then back to the lobby`,
      async () => {
        const { code, host, clients } = await makeRoom(server, n, { maxPlayers: 16 });

        // Host configures the table; everyone sees the change.
        expect(await ask(host.socket, "set-max-players", n)).toMatchObject({ ok: true, maxPlayers: n });
        expect(await ask(host.socket, "set-starting-hand", 5)).toMatchObject({ ok: true, startingHandSize: 5 });
        const rules = { drawFourSkipsTurn: true, allowDrawFourOnDrawTwo: true };
        expect(await ask(host.socket, "set-room-rules", rules)).toMatchObject({ ok: true });
        const settings = [];
        for (let i = 0; i < 3; i += 1) settings.push(await clients[n - 1].inbox.next("lobby-update"));
        expect(settings[2].rules).toMatchObject(rules);
        expect(settings[2].startingHandSize).toBe(5);
        expect(settings[2].maxPlayers).toBe(n);
        await wait(20);
        clients.slice(0, -1).forEach((c) => expect(c.inbox.count("lobby-update")).toBe(3));
        clients.forEach((c) => c.inbox.drain("lobby-update"));

        await startGame(host, clients);
        const first = await playMatch(clients);
        expect(first.winner).not.toBeNull();
        expect(server.rooms.getRoom(code).gameState.rules).toMatchObject(rules);

        // Nobody but the host can restart; the host can.
        if (n > 1) {
          expect(await ask(clients[1].socket, "restart-game")).toMatchObject({ ok: false });
        }
        expect(await ask(host.socket, "restart-game")).toMatchObject({ ok: true });
        await Promise.all(clients.map((c) => c.inbox.next("game-started")));
        const second = await playMatch(clients);
        expect(second.winner).not.toBeNull();

        expect(await ask(host.socket, "return-lobby")).toMatchObject({ ok: true });
        const lobbies = await Promise.all(clients.map((c) => c.inbox.next("lobby-update")));
        lobbies.forEach((l) => {
          expect(l.status).toBe("lobby");
          expect(l.players).toHaveLength(n);
          expect(l.players.map((p) => p.slot)).toEqual([...Array(n).keys()]);
          expect(l.players.every((p) => p.connected)).toBe(true);
          expect(l.hostId).toBe(host.socket.id);
        });
        expect(server.rooms.getRoom(code).status).toBe("lobby");
        expect(server.rooms.getRoom(code).gameState).toBeNull();
      },
      20_000
    );
  }
});

// ---------------------------------------------------------------------------
// 2. Cheating attempts
// ---------------------------------------------------------------------------
describe("cheating and garbage are rejected without touching state", () => {
  let server;
  beforeAll(async () => {
    server = await startServer();
  });
  afterAll(() => server.close());

  it("rejects every illegal game-action and leaves the state byte-identical", async () => {
    const { code, host, clients } = await makeRoom(server, 3);
    await startGame(host, clients);
    await Promise.all(clients.map((c) => c.inbox.next("game-update")));

    const [p0, p1, p2] = clients;
    const red5 = card("Red", 5);
    // Slot 0 to act. Hand: playable Red 1, playable Blue 5, two wilds, unplayable Green 9.
    await setServerState(server, code, clients, {
      currentPlayer: 0,
      direction: 1,
      pendingDraw: 0,
      drawStackType: null,
      penaltyChainMode: null,
      penaltyAnchorColor: null,
      mayPassAfterDraw: false,
      unoPending: null,
      unoMissed: [false, false, false],
      topCard: red5,
      discardPile: [red5],
      hands: [
        [card("Red", 1), card("Blue", 5), card("Wild", ACTIONS.WILD), card("Wild", ACTIONS.WILD_DRAW_FOUR), card("Green", 9)],
        [card("Green", 1), card("Green", 2), card("Green", 3)],
        [card("Yellow", 1), card("Yellow", 2), card("Yellow", 3)],
      ],
    });

    // Spectator joins mid-game under a new name.
    const spec = await server.connect();
    const specJoin = await ask(spec.socket, "join-room", { code, name: "Lurker" });
    expect(specJoin).toMatchObject({ ok: true, isSpectator: true, slot: null });
    await Promise.all([...clients, spec].map((c) => c.inbox.next("game-update")));
    assertPrivateView(specJoin.state, -1);

    const before = snapshot(server, code);
    const attempts = [
      [p1, { type: "draw" }, "Not your turn"],
      [p1, { type: "play", cardIndex: 0 }, "Not your turn"],
      [p2, { type: "uno" }, "Not your turn"],
      [p0, { type: "play", cardIndex: 5 }, "Invalid card"],
      [p0, { type: "play", cardIndex: 999 }, "Invalid card"],
      [p0, { type: "play", cardIndex: 4 }, "Invalid play"],
      [p0, { type: "play", cardIndex: 2, chosenColor: "Purple" }, "Invalid color"],
      [p0, { type: "play", cardIndex: 2 }, "Choose a color for wild"],
      [p0, { type: "play", cardIndex: 3 }, "Choose a color for wild"],
      [p0, { type: "pass" }, "Cannot pass now"],
      [p0, { type: "uno" }, "Call UNO"],
      [p0, { type: "steal" }, "Unknown action"],
      [spec, { type: "draw" }, "Spectators cannot play"],
      [spec, { type: "play", cardIndex: 0 }, "Spectators cannot play"],
    ];
    for (const [client, action, message] of attempts) {
      const ack = await ask(client.socket, "game-action", action);
      expect(ack, JSON.stringify(action)).toMatchObject({ ok: false });
      expect(ack.error).toContain(message);
    }

    const garbage = [
      null,
      undefined,
      "draw",
      42,
      [],
      ["play", 0],
      {},
      { type: 123 },
      { type: null },
      { type: "play" },
      { type: "play", cardIndex: -1 },
      { type: "play", cardIndex: 1.5 },
      { type: "play", cardIndex: "abc" },
      { type: "play", cardIndex: NaN },
      { type: "play", cardIndex: Infinity },
      { type: "play", cardIndex: 1e308 },
      { type: "play", cardIndex: Number.MAX_SAFE_INTEGER },
      { type: "play", cardIndex: 0, chosenColor: {} },
      { type: "play", cardIndex: 0, chosenColor: ["Red"] },
      { type: "play", cardIndex: 0, chosenColor: 7 },
      { type: "x".repeat(10_000) },
      { type: "steal", extra: "a".repeat(50_000) },
    ];
    for (const payload of garbage) {
      const ack = await ask(p0.socket, "game-action", payload);
      expect(ack, JSON.stringify(payload)).toMatchObject({ ok: false });
    }
    // No payload at all, only an ack.
    expect(await ask(p0.socket, "game-action")).toMatchObject({ ok: false });
    // Fire-and-forget garbage with no ack must not crash either.
    p0.socket.emit("game-action", null);
    p0.socket.emit("game-action", { type: "play", cardIndex: "0" });
    p0.socket.emit("vote-kick", "abc");
    p0.socket.emit("host-kick", { slot: 1 });
    p0.socket.emit("set-room-rules", "nope");
    p0.socket.emit("join-room", 12);
    p0.socket.emit("rejoin-room", []);
    await wait(50);

    // Lobby-only and host-only controls are locked mid-game.
    expect(await ask(p1.socket, "start-game")).toMatchObject({ ok: false });
    expect(await ask(host.socket, "start-game")).toMatchObject({ ok: false });
    expect(await ask(host.socket, "set-room-rules", { drawTwoSkipsTurn: false })).toMatchObject({ ok: false });
    expect(await ask(host.socket, "set-starting-hand", 7)).toMatchObject({ ok: false });
    expect(await ask(host.socket, "set-max-players", 4)).toMatchObject({ ok: false });
    expect(await ask(host.socket, "restart-game")).toMatchObject({ ok: false, error: expect.stringContaining("Finish") });
    expect(await ask(host.socket, "return-lobby")).toMatchObject({ ok: false });
    expect(await ask(p1.socket, "host-kick", 0)).toMatchObject({ ok: false, error: "Only the host can kick." });
    expect(await ask(host.socket, "host-kick", 0)).toMatchObject({ ok: false, error: "You cannot kick yourself." });
    expect(await ask(host.socket, "host-kick", 7)).toMatchObject({ ok: false, error: "Invalid player." });
    expect(await ask(spec.socket, "vote-kick", 1)).toMatchObject({ ok: false });
    expect(await ask(p1.socket, "vote-kick", 1)).toMatchObject({ ok: false });
    expect(await ask(p1.socket, "vote-kick", 99)).toMatchObject({ ok: false });

    expect(snapshot(server, code)).toBe(before);
    clients.forEach((c) => expect(c.inbox.count("game-update"), `${c.name} got a stray update`).toBe(0));
    expect(spec.inbox.count("game-update")).toBe(0);

    // A legal move still works afterwards, including for the same wild with a proper color...
    expect(await ask(p0.socket, "game-action", { type: "play", cardIndex: 2, chosenColor: "Blue" })).toMatchObject({ ok: true });
    const after = await Promise.all([...clients, spec].map((c) => c.inbox.next("game-update")));
    expect(after[0].state.topCard.color).toBe("Blue");
    expect(after[0].state.currentPlayer).toBe(1);
    assertAgreement(after.map((u) => u.state));

    // ...and "draw twice" is blocked once a drawn card is playable.
    await setServerState(server, code, [...clients, spec], {
      currentPlayer: 1,
      mayPassAfterDraw: false,
      pendingDraw: 0,
      drawStackType: null,
      topCard: card("Blue", 7),
      discardPile: [card("Blue", 7)],
      drawPile: [card("Blue", 8), ...server.rooms.getRoom(code).gameState.drawPile],
    });
    expect(await ask(p1.socket, "game-action", { type: "draw" })).toMatchObject({ ok: true });
    const drawn = await Promise.all([...clients, spec].map((c) => c.inbox.next("game-update")));
    expect(drawn[1].state.mayPassAfterDraw).toBe(true);
    expect(drawn[1].state.currentPlayer).toBe(1);
    expect(await ask(p1.socket, "game-action", { type: "draw" })).toMatchObject({ ok: false, error: "Cannot draw now." });
    expect(await ask(p1.socket, "game-action", { type: "pass" })).toMatchObject({ ok: true });
    await Promise.all([...clients, spec].map((c) => c.inbox.next("game-update")));
  });

  it("rejects garbage on lobby events", async () => {
    const c = await server.connect();
    const bad = [
      ["host-room", null],
      ["host-room", "me"],
      ["host-room", { name: "" }],
      ["host-room", { name: "x".repeat(25) }],
      ["host-room", { name: 5 }],
      ["host-room", { name: "ok", maxPlayers: 99 }],
      ["host-room", { name: "ok", startingHandSize: "lots" }],
      ["host-room", { name: "ok", rules: [1, 2] }],
      ["join-room", null],
      ["join-room", { code: "AB", name: "x" }],
      ["join-room", { code: "ABCDEF", name: "x", token: 12 }],
      ["join-room", { code: "ABCDEF", name: "x", token: "t".repeat(200) }],
      ["rejoin-room", { code: "ABCDEF" }],
      ["set-max-players", "eight"],
      ["set-starting-hand", null],
      ["vote-kick", -1],
      ["host-kick", 10 ** 9],
      ["start-game"],
      ["restart-game"],
      ["return-lobby"],
      ["game-action", { type: "draw" }],
    ];
    for (const [event, ...args] of bad) {
      const ack = await ask(c.socket, event, ...args);
      expect(ack, `${event} ${JSON.stringify(args)}`).toMatchObject({ ok: false });
    }
    expect(server.rooms.rooms.size).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Disconnect / reconnect
// ---------------------------------------------------------------------------
describe("disconnect and reconnect mid-game", () => {
  it(
    "waits for the away player, folds them after the away window, and play resumes",
    async () => {
      const server = await startServer({ awayFoldMs: 300, foldCheckMs: 40 });
      try {
        const { code, host, clients } = await makeRoom(server, 3);
        await startGame(host, clients);
        const initial = await Promise.all(clients.map((c) => c.inbox.next("game-update")));
        expect(initial[0].state.currentPlayer).toBe(0);
        const [p0, p1, p2] = clients;

        // The player whose turn it is drops.
        p0.socket.disconnect();
        const others = [p1, p2];
        const awayViews = await Promise.all(others.map((c) => c.inbox.next("game-update")));
        awayViews.forEach((u) => {
          expect(u.roster[0]).toMatchObject({ connected: false, folded: false });
          expect(u.state.currentPlayer).toBe(0); // Turn waits for the away player, it is not skipped.
          expect(u.hostId).toBe(p1.socket.id); // Host role moved to the next connected player.
        });
        expect(await ask(p1.socket, "game-action", { type: "draw" })).toMatchObject({ ok: false, error: "Not your turn." });

        // Away window elapses: the seat folds, cards go back to the draw pile, turn moves on.
        const folded = await Promise.all(others.map((c) => c.inbox.next("player-folded", 2000)));
        expect(folded[0]).toMatchObject({ slot: 0, name: "P0" });
        let views = await Promise.all(others.map((c) => c.inbox.next("game-update", 2000)));
        expect(views[0].state.foldedSlots).toEqual([true, false, false]);
        assertAgreement(views.map((u) => u.state));
        expect(views[0].state.currentPlayer).not.toBe(0);
        expect(handCount(views[0].state.hands[0])).toBe(0);
        expect(views[0].roster[0]).toMatchObject({ connected: false, folded: true });

        // Remaining players can act.
        const actor = others.find((c) => c.slot === views[0].state.currentPlayer);
        const move = chooseMove(views[others.indexOf(actor)].state, actor.slot);
        expect(await ask(actor.socket, "game-action", move)).toMatchObject({ ok: true });
        await Promise.all(others.map((c) => c.inbox.next("game-update")));

        // A folded seat cannot be reclaimed, even with the right token.
        const back = await server.connect();
        const rejoin = await ask(back.socket, "rejoin-room", { code, name: "P0", token: p0.token });
        expect(rejoin).toMatchObject({ ok: true, isSpectator: true, slot: null });
        expect(rejoin.message).toContain("given up");
        await Promise.all([...others, back].map((c) => c.inbox.next("game-update")));

        // Restart with a folded seat still on the roster: that seat must not hold the turn forever.
        const room = server.rooms.getRoom(code);
        room.gameState = { ...room.gameState, winner: 1 };
        expect(await ask(p1.socket, "restart-game")).toMatchObject({ ok: true });
        await Promise.all([...others, back].map((c) => c.inbox.next("game-started")));
        const restarted = await Promise.all([...others, back].map((c) => c.inbox.next("game-update")));
        expect(restarted[0].state.currentPlayer).toBe(0); // Dealt to the empty seat 0...
        expect(restarted[0].state.foldedSlots).toEqual([false, false, false]);
        expect(restarted[0].roster[0]).toMatchObject({ connected: false, folded: false });
        await Promise.all(others.map((c) => c.inbox.next("player-folded", 2000))); // ...which folds again on the timer.
        views = await Promise.all([...others, back].map((c) => c.inbox.next("game-update", 2000)));
        expect(views[0].state.foldedSlots).toEqual([true, false, false]);
        expect(views[0].state.currentPlayer).not.toBe(0);
        // The spectator keeps receiving state across the restart.
        expect(views[2]).toMatchObject({ isSpectator: true });
        assertAgreement(views.map((u) => u.state));

        // Return to the lobby drops the dead seat and compacts slots.
        room.gameState = { ...room.gameState, winner: 1 };
        expect(await ask(p1.socket, "return-lobby")).toMatchObject({ ok: true });
        const lobby = await p2.inbox.next("lobby-update");
        expect(lobby.players.map((p) => [p.name, p.slot, p.connected])).toEqual([["P1", 0, true], ["P2", 1, true]]);
        expect(lobby.hostId).toBe(p1.socket.id);
        expect(await ask(p1.socket, "start-game")).toMatchObject({ ok: true });
        const fresh = await Promise.all(others.map((c) => c.inbox.next("game-update")));
        expect(fresh.map((u) => u.yourSlot)).toEqual([0, 1]);
        expect(fresh[0].state.hands).toHaveLength(2);
      } finally {
        await server.close();
      }
    },
    15_000
  );

  it("a player who reconnects in time gets the same hand; wrong token spectates", async () => {
    const server = await startServer({ awayFoldMs: 5000, foldCheckMs: 40 });
    try {
      const { code, host, clients } = await makeRoom(server, 3);
      await startGame(host, clients);
      const initial = await Promise.all(clients.map((c) => c.inbox.next("game-update")));
      const [p0, p1, p2] = clients;
      const handBefore = initial[1].state.hands[1].map((c) => c.id);

      p1.socket.disconnect();
      const away = await Promise.all([p0, p2].map((c) => c.inbox.next("game-update")));
      expect(away[0].roster[1].connected).toBe(false);
      expect(away[0].hostId).toBe(p0.socket.id); // Non-host leaving keeps the host.

      // Game continues for the others while P1 is away.
      const move = chooseMove(away[0].state, 0);
      expect(await ask(p0.socket, "game-action", move)).toMatchObject({ ok: true });
      await Promise.all([p0, p2].map((c) => c.inbox.next("game-update")));

      // Wrong token: spectator, seat untouched.
      const impostor = await server.connect();
      const bad = await ask(impostor.socket, "join-room", { code, name: "P1", token: "not-the-token" });
      expect(bad).toMatchObject({ ok: true, isSpectator: true, slot: null });
      expect(bad.state.hands.every((h) => h.hidden)).toBe(true);
      await Promise.all([p0, p2, impostor].map((c) => c.inbox.next("game-update")));
      expect(server.rooms.getRoom(code).players[1].connected).toBe(false);

      // No token at all: also a spectator.
      const noToken = await server.connect();
      expect(await ask(noToken.socket, "rejoin-room", { code, name: "P1" })).toMatchObject({ ok: true, isSpectator: true });
      await Promise.all([p0, p2, impostor, noToken].map((c) => c.inbox.next("game-update")));

      // Right token: seat and hand restored.
      const back = await server.connect();
      const good = await ask(back.socket, "rejoin-room", { code, name: "P1", token: p1.token });
      expect(good).toMatchObject({ ok: true, isSpectator: false, slot: 1, token: p1.token });
      expect(good.message).toContain("Welcome back");
      expect(good.state.hands[1].map((c) => c.id)).toEqual(handBefore);
      assertPrivateView(good.state, 1);
      back.slot = 1;
      const restored = await Promise.all([p0, p2, back].map((c) => c.inbox.next("game-update")));
      expect(restored[0].roster[1]).toMatchObject({ connected: true, folded: false });
      assertAgreement(restored.map((u) => u.state));
      expect(restored[2].yourSlot).toBe(1);

      // Both spectators still receive state and are still barred from acting.
      const specViews = await Promise.all([impostor, noToken].map((s) => s.inbox.next("game-update")));
      expect(await ask(impostor.socket, "game-action", { type: "draw" })).toMatchObject({ ok: false });

      // And the reconnected player can finish the game with the others.
      const result = await playMatch([p0, back, p2], [impostor, noToken], {
        updates: [restored[0], restored[2], restored[1]],
        specUpdates: specViews,
      });
      expect(result.winner).not.toBeNull();
    } finally {
      await server.close();
    }
  }, 15_000);
});

// ---------------------------------------------------------------------------
// 4. Host leaves
// ---------------------------------------------------------------------------
describe("host leaves", () => {
  let server;
  beforeAll(async () => {
    server = await startServer();
  });
  afterAll(() => server.close());

  it("mid-game: host role passes to the next connected player", async () => {
    const { code, host, clients } = await makeRoom(server, 3);
    await startGame(host, clients);
    await Promise.all(clients.map((c) => c.inbox.next("game-update")));
    const [, p1, p2] = clients;

    host.socket.disconnect();
    const views = await Promise.all([p1, p2].map((c) => c.inbox.next("game-update")));
    views.forEach((u) => expect(u.hostId).toBe(p1.socket.id));
    expect(server.rooms.getRoom(code).hostId).toBe(p1.socket.id);

    // New host holds host powers; old host's seat is merely away.
    expect(await ask(p2.socket, "host-kick", 1)).toMatchObject({ ok: false, error: "Only the host can kick." });
    expect(await ask(p1.socket, "host-kick", 2)).toMatchObject({ ok: true });
    await p1.inbox.next("game-update");
    expect(await p2.inbox.next("player-kicked")).toMatchObject({ message: expect.stringContaining("kicked") });
  });

  it("in the lobby: host role passes on leave-room; last player leaving closes the room", async () => {
    const { code, host, clients } = await makeRoom(server, 3);
    const [, p1, p2] = clients;

    host.socket.emit("leave-room");
    const lobbies = await Promise.all([p1, p2].map((c) => c.inbox.next("lobby-update")));
    lobbies.forEach((l) => {
      expect(l.hostId).toBe(p1.socket.id);
      expect(l.players.map((p) => [p.name, p.slot])).toEqual([["P1", 0], ["P2", 1]]);
    });
    expect(await ask(p2.socket, "set-starting-hand", 6)).toMatchObject({ ok: false });
    expect(await ask(p1.socket, "set-starting-hand", 6)).toMatchObject({ ok: true, startingHandSize: 6 });
    await Promise.all([p1, p2].map((c) => c.inbox.next("lobby-update")));

    // The old host is free to host a new room straight away.
    expect(await ask(host.socket, "host-room", { name: "P0" })).toMatchObject({ ok: true });

    // Host disconnecting in the lobby also transfers.
    p1.socket.disconnect();
    const l2 = await p2.inbox.next("lobby-update");
    expect(l2.hostId).toBe(p2.socket.id);
    expect(l2.players).toHaveLength(1);

    p2.socket.emit("leave-room");
    await wait(30);
    expect(server.rooms.getRoom(code)).toBeUndefined();
    const late = await server.connect();
    expect(await ask(late.socket, "join-room", { code, name: "Late" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("not found"),
    });
  });
});

// ---------------------------------------------------------------------------
// 5. Kicks
// ---------------------------------------------------------------------------
describe("kick paths", () => {
  let server;
  beforeAll(async () => {
    server = await startServer({ awayFoldMs: 5000, foldCheckMs: 40 });
  });
  afterAll(() => server.close());

  it("vote kick needs a majority, marks the target away, and they may return with their token", async () => {
    const { code, host, clients } = await makeRoom(server, 4);
    await startGame(host, clients);
    await Promise.all(clients.map((c) => c.inbox.next("game-update")));
    const [p0, p1, p2, p3] = clients;

    expect(await ask(p3.socket, "vote-kick", 3)).toMatchObject({ ok: false });
    const v1 = await ask(p1.socket, "vote-kick", 3);
    expect(v1).toMatchObject({ ok: true, voteKick: { targetSlot: 3, votes: 1, needed: 2 } });
    const tally = await Promise.all(clients.map((c) => c.inbox.next("game-update")));
    expect(tally[3].voteKick).toMatchObject({ targetSlot: 3, votes: 1, needed: 2 });
    // Same voter again does not double count.
    expect(await ask(p1.socket, "vote-kick", 3)).toMatchObject({ ok: true, voteKick: { votes: 1 } });
    await Promise.all(clients.map((c) => c.inbox.next("game-update")));

    expect(await ask(p2.socket, "vote-kick", 3)).toMatchObject({ ok: true, voteKick: null });
    expect(await p3.inbox.next("player-kicked")).toMatchObject({ message: expect.stringContaining("kicked") });
    const afterKick = await Promise.all([p0, p1, p2].map((c) => c.inbox.next("game-update")));
    afterKick.forEach((u) => {
      expect(u.roster[3]).toMatchObject({ connected: false, folded: false });
      expect(u.voteKick).toBeNull();
    });
    expect(await ask(p3.socket, "game-action", { type: "draw" })).toMatchObject({ ok: false });

    // Kicked players keep their reconnect token and their cards inside the away window.
    const back = await server.connect();
    const rejoin = await ask(back.socket, "rejoin-room", { code, name: "P3", token: p3.token });
    expect(rejoin).toMatchObject({ ok: true, slot: 3, isSpectator: false });
    expect(rejoin.state.hands[3]).toHaveLength(5);
    await Promise.all([p0, p1, p2].map((c) => c.inbox.next("game-update")));
  });

  it("host kick works only for the host and never on themselves", async () => {
    const { host, clients } = await makeRoom(server, 3);
    await startGame(host, clients);
    await Promise.all(clients.map((c) => c.inbox.next("game-update")));
    const [, p1, p2] = clients;
    expect(await ask(p1.socket, "host-kick", 2)).toMatchObject({ ok: false });
    expect(await ask(host.socket, "host-kick", 0)).toMatchObject({ ok: false });
    expect(await ask(host.socket, "host-kick", 2)).toMatchObject({ ok: true });
    expect(await p2.inbox.next("player-kicked")).toBeTruthy();
    const views = await Promise.all([host, p1].map((c) => c.inbox.next("game-update")));
    expect(views[0].roster[2].connected).toBe(false);
    // Kicking an already-away seat is a harmless no-op.
    expect(await ask(host.socket, "host-kick", 2)).toMatchObject({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// 6. Room lifecycle
// ---------------------------------------------------------------------------
describe("room lifecycle", () => {
  let server;
  beforeAll(async () => {
    server = await startServer({ emptyRoomGraceMs: 150 });
  });
  afterAll(() => server.close());

  it("leave-room from the lobby compacts seats so the next game deals to real players", async () => {
    const { host, clients } = await makeRoom(server, 3);
    const [, p1, p2] = clients;
    expect(p2.slot).toBe(2);

    p1.socket.emit("leave-room");
    const lobbies = await Promise.all([host, p2].map((c) => c.inbox.next("lobby-update")));
    lobbies.forEach((l) => expect(l.players.map((p) => [p.name, p.slot])).toEqual([["P0", 0], ["P2", 1]]));

    await startGame(host, [host, p2]);
    const views = await Promise.all([host, p2].map((c) => c.inbox.next("game-update")));
    expect(views.map((u) => u.yourSlot)).toEqual([0, 1]);
    expect(views[0].state.hands).toHaveLength(2);
    expect(Array.isArray(views[1].state.hands[1])).toBe(true);
    p2.slot = 1;
    const result = await playMatch([host, p2], [], { updates: views });
    expect(result.winner).not.toBeNull();
  }, 15_000);

  it("join errors: full room, unknown code, taken name, already seated; lowercase code works", async () => {
    const { code, clients } = await makeRoom(server, 2, { maxPlayers: 2 });
    const extra = await server.connect();
    expect(await ask(extra.socket, "join-room", { code, name: "Extra" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("full"),
    });
    expect(await ask(extra.socket, "join-room", { code: "ZZZZ99", name: "Extra" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("not found"),
    });

    const other = await makeRoom(server, 1, { maxPlayers: 4 });
    expect(await ask(extra.socket, "join-room", { code: other.code, name: "P0" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("taken"),
    });
    const lower = await ask(extra.socket, "join-room", { code: other.code.toLowerCase(), name: " Extra " });
    expect(lower).toMatchObject({ ok: true, code: other.code, slot: 1 });
    expect((await other.host.inbox.next("lobby-update")).players[1].name).toBe("Extra");

    // Already seated elsewhere: refused, and the first room keeps no ghost.
    const third = await makeRoom(server, 1, { maxPlayers: 4 });
    expect(await ask(extra.socket, "join-room", { code: third.code, name: "Extra" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("Leave your current room"),
    });
    expect(server.rooms.getRoom(third.code).players).toHaveLength(1);
    expect(await ask(extra.socket, "host-room", { name: "Extra" })).toMatchObject({ ok: false });
    expect(await ask(clients[0].socket, "join-room", { code, name: "Again" })).toMatchObject({ ok: false });
  });

  it("an in-game room with nobody connected is deleted after the grace period", async () => {
    const { code, host, clients } = await makeRoom(server, 2);
    await startGame(host, clients);
    await Promise.all(clients.map((c) => c.inbox.next("game-update")));
    clients.forEach((c) => c.socket.disconnect());
    await wait(30);
    const room = server.rooms.getRoom(code);
    expect(room).toBeDefined();
    expect(room.cleanupTimer).not.toBeNull();
    await wait(250);
    expect(server.rooms.getRoom(code)).toBeUndefined();
    const late = await server.connect();
    expect(await ask(late.socket, "join-room", { code, name: "Late" })).toMatchObject({ ok: false });
  });

  it("a returning player cancels the pending cleanup", async () => {
    const { code, host, clients } = await makeRoom(server, 2);
    await startGame(host, clients);
    await Promise.all(clients.map((c) => c.inbox.next("game-update")));
    clients.forEach((c) => c.socket.disconnect());
    await wait(30);
    const back = await server.connect();
    expect(await ask(back.socket, "rejoin-room", { code, name: "P1", token: clients[1].token })).toMatchObject({ ok: true, slot: 1 });
    expect(server.rooms.getRoom(code).cleanupTimer).toBeNull();
    await wait(250);
    expect(server.rooms.getRoom(code)).toBeDefined();
  });
});

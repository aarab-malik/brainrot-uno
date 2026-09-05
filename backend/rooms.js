import {
  ACTIONS,
  COLORS,
  applyCallUno,
  applyDraw,
  applyPassTurn,
  applyPlay,
  ensureActiveCurrentPlayer,
  foldSlotIntoDrawPile,
  getValidMoves,
  needsUnoCall,
  makeInitialGameState,
  MIN_PLAYERS,
  MAX_PLAYERS,
  MIN_STARTING_HAND,
  DEFAULT_GAME_RULES,
  normalizeGameRules,
  clampPlayerCount,
  clampStartingHandSize,
  maxStartingHandForPlayers,
} from "../shared/gameLogic.js";
import { randomUUID } from "node:crypto";
import { serializeStateForPlayer, serializeStateForSpectator } from "./state.js";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const AWAY_FOLD_MS = 60_000;
const FOLD_CHECK_MS = 3_000;
const EMPTY_ROOM_GRACE_MS = 5 * 60_000;

function generateCode() {
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

function makePlayer(socketId, name, slot) {
  return {
    id: socketId,
    name: name.trim() || `Player ${slot + 1}`,
    slot,
    token: randomUUID(),
    connected: true,
    role: "player",
    folded: false,
    awaySince: null,
  };
}

export class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    this.socketToRoom = new Map();
    this.foldCheckInterval = setInterval(() => this.checkAwayTimeouts(), FOLD_CHECK_MS);
  }

  destroy() {
    clearInterval(this.foldCheckInterval);
    for (const room of this.rooms.values()) this.cancelCleanup(room);
  }

  getRoom(code) {
    if (typeof code !== "string") return undefined;
    return this.rooms.get(code.toUpperCase());
  }

  hasAnyoneConnected(room) {
    return (
      room.players.some((p) => p.id && p.connected) || (room.spectators?.length ?? 0) > 0
    );
  }

  cancelCleanup(room) {
    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
    }
  }

  /** Delete the room after a grace period if nobody is connected. */
  scheduleCleanupIfEmpty(room) {
    if (this.hasAnyoneConnected(room)) {
      this.cancelCleanup(room);
      return;
    }
    if (room.cleanupTimer) return;
    room.cleanupTimer = setTimeout(() => {
      room.cleanupTimer = null;
      if (this.rooms.get(room.code) !== room) return;
      if (this.hasAnyoneConnected(room)) return;
      this.rooms.delete(room.code);
    }, EMPTY_ROOM_GRACE_MS);
    room.cleanupTimer.unref?.();
  }

  rosterPayload(room) {
    return room.players
      .sort((a, b) => a.slot - b.slot)
      .map((p) => ({
        slot: p.slot,
        name: p.name,
        connected: !!p.connected,
        folded: !!p.folded,
        awayMs: p.awaySince ? Date.now() - p.awaySince : null,
      }));
  }

  voteKickPayload(room) {
    if (!room.voteKick) return null;
    const target = room.players.find((p) => p.slot === room.voteKick.targetSlot);
    return {
      targetSlot: room.voteKick.targetSlot,
      targetName: target?.name ?? `Player ${room.voteKick.targetSlot + 1}`,
      votes: room.voteKick.votes.size,
      needed: this.votesNeeded(room, room.voteKick.targetSlot),
    };
  }

  lobbyPayload(room) {
    const maxStartingHand = maxStartingHandForPlayers(room.maxPlayers);
    return {
      code: room.code,
      hostId: room.hostId,
      maxPlayers: room.maxPlayers,
      startingHandSize: room.startingHandSize,
      rules: normalizeGameRules(room.rules ?? DEFAULT_GAME_RULES),
      minStartingHand: MIN_STARTING_HAND,
      maxStartingHand,
      status: room.status,
      players: [...room.players]
        .sort((a, b) => a.slot - b.slot)
        .map((p) => ({
          id: p.id,
          name: p.name,
          slot: p.slot,
          connected: !!p.connected,
          folded: !!p.folded,
        })),
      spectators: (room.spectators ?? []).map((s) => ({ id: s.id, name: s.name })),
    };
  }

  emitLobby(room) {
    this.io.to(room.code).emit("lobby-update", this.lobbyPayload(room));
  }

  gameMeta(room) {
    return {
      playerNames: room.players.map((p) => p.name),
      roster: this.rosterPayload(room),
      voteKick: this.voteKickPayload(room),
      hostId: room.hostId,
      originalNames: room.originalNames ?? [],
    };
  }

  emitGameState(room) {
    if (!room.gameState) return;
    const meta = this.gameMeta(room);
    const publicState = ensureActiveCurrentPlayer(room.gameState);

    room.players.forEach((p) => {
      if (!p.id || !p.connected || p.folded || p.role !== "player") return;
      const view = serializeStateForPlayer(publicState, p.slot);
      this.io.to(p.id).emit("game-update", {
        state: view,
        yourSlot: p.slot,
        isSpectator: false,
        ...meta,
      });
    });

    const specState = serializeStateForSpectator(publicState);
    (room.spectators ?? []).forEach((s) => {
      if (!s.id) return;
      this.io.to(s.id).emit("game-update", {
        state: specState,
        yourSlot: null,
        isSpectator: true,
        ...meta,
      });
    });
  }

  connectedVoters(room) {
    return room.players.filter(
      (p) => p.role === "player" && !p.folded && p.connected && p.id
    );
  }

  /** Strict majority of connected, non-target voters; never fewer than 2. */
  votesNeeded(room, targetSlot) {
    const n = this.connectedVoters(room).filter((p) => p.slot !== targetSlot).length;
    return Math.max(2, Math.floor(n / 2) + 1);
  }

  hostRoom(socket, { name, maxPlayers: rawMax, startingHandSize: rawHand, rules: rawRules }, callback) {
    if (this.socketToRoom.has(socket.id)) {
      callback?.({ ok: false, error: "Leave your current room first." });
      return;
    }
    let code = generateCode();
    while (this.rooms.has(code)) code = generateCode();

    const maxPlayers = clampPlayerCount(rawMax ?? MAX_PLAYERS);
    const startingHandSize = clampStartingHandSize(rawHand, maxPlayers);
    const rules = normalizeGameRules(rawRules ?? DEFAULT_GAME_RULES);

    const room = {
      code,
      hostId: socket.id,
      maxPlayers,
      startingHandSize,
      rules,
      status: "lobby",
      players: [],
      spectators: [],
      gameState: null,
      originalNames: null,
      voteKick: null,
      cleanupTimer: null,
    };

    const player = makePlayer(socket.id, name, 0);
    room.players.push(player);
    this.rooms.set(code, room);
    this.socketToRoom.set(socket.id, code);
    socket.join(code);

    callback?.({
      ok: true,
      code,
      playerId: socket.id,
      token: player.token,
      slot: 0,
      maxPlayers,
      startingHandSize,
      rules,
    });
    this.emitLobby(room);
  }

  setMaxPlayers(socket, maxPlayers, callback) {
    const room = this.getRoom(this.socketToRoom.get(socket.id));
    if (!room || room.hostId !== socket.id || room.status !== "lobby") {
      callback?.({ ok: false, error: "Cannot change room size." });
      return;
    }
    const next = clampPlayerCount(maxPlayers);
    if (next < room.players.length) {
      callback?.({ ok: false, error: "Too many players already in room." });
      return;
    }
    room.maxPlayers = next;
    room.startingHandSize = clampStartingHandSize(room.startingHandSize, next);
    callback?.({ ok: true, maxPlayers: next, startingHandSize: room.startingHandSize });
    this.emitLobby(room);
  }

  setStartingHandSize(socket, handSize, callback) {
    const room = this.getRoom(this.socketToRoom.get(socket.id));
    if (!room || room.hostId !== socket.id || room.status !== "lobby") {
      callback?.({ ok: false, error: "Cannot change starting hand." });
      return;
    }
    room.startingHandSize = clampStartingHandSize(handSize, room.maxPlayers);
    callback?.({ ok: true, startingHandSize: room.startingHandSize });
    this.emitLobby(room);
  }

  setRoomRules(socket, rulesInput, callback) {
    const room = this.getRoom(this.socketToRoom.get(socket.id));
    if (!room || room.hostId !== socket.id || room.status !== "lobby") {
      callback?.({ ok: false, error: "Cannot change rules right now." });
      return;
    }
    room.rules = normalizeGameRules(rulesInput);
    callback?.({ ok: true, rules: room.rules });
    this.emitLobby(room);
  }

  joinRoom(socket, code, name, callback, token = null) {
    const room = this.getRoom(code);
    if (!room) {
      callback?.({ ok: false, error: "Room not found. Check the code." });
      return;
    }

    if (room.status === "playing") {
      this.rejoinRoom(socket, { code: room.code, name, token }, callback);
      return;
    }

    if (room.players.length >= room.maxPlayers) {
      callback?.({ ok: false, error: `Room is full (${room.maxPlayers} players max).` });
      return;
    }
    if (room.players.some((p) => p.id === socket.id)) {
      callback?.({ ok: false, error: "Already in this room." });
      return;
    }
    const trimmed = (name || "").trim();
    if (room.players.some((p) => p.name === trimmed)) {
      callback?.({ ok: false, error: "That name is taken in this room." });
      return;
    }

    const taken = new Set(room.players.map((p) => p.slot));
    let slot = 0;
    while (taken.has(slot) && slot < room.maxPlayers) slot += 1;

    const player = makePlayer(socket.id, name, slot);
    room.players.push(player);
    this.socketToRoom.set(socket.id, room.code);
    socket.join(room.code);
    this.cancelCleanup(room);

    callback?.({
      ok: true,
      code: room.code,
      playerId: socket.id,
      token: player.token,
      slot,
      maxPlayers: room.maxPlayers,
    });
    this.emitLobby(room);
  }

  removeSpectatorBySocket(room, socketId) {
    room.spectators = (room.spectators ?? []).filter((s) => s.id !== socketId);
  }

  addSpectator(socket, room, name) {
    this.removeSpectatorBySocket(room, socket.id);
    const trimmed = (name || "").trim() || "Spectator";
    room.spectators.push({ id: socket.id, name: trimmed });
    this.socketToRoom.set(socket.id, room.code);
    socket.join(room.code);
    this.cancelCleanup(room);
    return trimmed;
  }

  attachPlayerSocket(socket, room, player) {
    if (player.id && player.id !== socket.id) {
      this.socketToRoom.delete(player.id);
    }
    this.removeSpectatorBySocket(room, socket.id);
    player.id = socket.id;
    player.connected = true;
    player.awaySince = null;
    player.role = "player";
    this.socketToRoom.set(socket.id, room.code);
    socket.join(room.code);
    this.cancelCleanup(room);
  }

  canReclaimSeat(room, player) {
    if (!player || player.folded) return false;
    if (!player.awaySince) return true;
    return Date.now() - player.awaySince < AWAY_FOLD_MS;
  }

  rejoinRoom(socket, { code, name, token } = {}, callback) {
    const room = this.getRoom(code);
    if (!room) {
      callback?.({ ok: false, error: "Room not found." });
      return;
    }

    const trimmed = (typeof name === "string" ? name : "").trim();
    if (!trimmed) {
      callback?.({ ok: false, error: "Enter your name." });
      return;
    }

    if (room.status !== "playing" || !room.gameState) {
      callback?.({ ok: false, error: "Game is not in progress." });
      return;
    }

    const existing = room.players.find((p) => p.name === trimmed);
    const meta = this.gameMeta(room);

    if (existing) {
      // The seat belongs to whoever holds its reconnect token. Anyone else spectates.
      const ownsSeat = typeof token === "string" && token.length > 0 && token === existing.token;
      if (!ownsSeat) {
        this.addSpectator(socket, room, trimmed);
        const view = serializeStateForSpectator(ensureActiveCurrentPlayer(room.gameState));
        callback?.({
          ok: true,
          code: room.code,
          playerId: socket.id,
          slot: null,
          playing: true,
          isSpectator: true,
          state: view,
          message: "You are spectating — that seat belongs to another player.",
          ...meta,
        });
        this.emitGameState(room);
        return;
      }

      if (existing.folded || !this.canReclaimSeat(room, existing)) {
        this.addSpectator(socket, room, trimmed);
        const view = serializeStateForSpectator(ensureActiveCurrentPlayer(room.gameState));
        callback?.({
          ok: true,
          code: room.code,
          playerId: socket.id,
          slot: null,
          playing: true,
          isSpectator: true,
          state: view,
          message: "You are spectating — your seat was given up after 60s away.",
          ...meta,
        });
        this.emitGameState(room);
        return;
      }

      this.attachPlayerSocket(socket, room, existing);
      const view = serializeStateForPlayer(room.gameState, existing.slot);
      callback?.({
        ok: true,
        code: room.code,
        playerId: socket.id,
        token: existing.token,
        slot: existing.slot,
        playing: true,
        isSpectator: false,
        state: view,
        message: "Welcome back — your hand is restored.",
        ...meta,
      });
      this.emitGameState(room);
      return;
    }

    if (!(room.originalNames ?? []).includes(trimmed)) {
      this.addSpectator(socket, room, trimmed);
      const view = serializeStateForSpectator(ensureActiveCurrentPlayer(room.gameState));
      callback?.({
        ok: true,
        code: room.code,
        playerId: socket.id,
        slot: null,
        playing: true,
        isSpectator: true,
        state: view,
        message: "You are spectating — only original players can take a seat.",
        ...meta,
      });
      this.emitGameState(room);
      return;
    }

    callback?.({ ok: false, error: "Could not find your seat. Ask the host to restart." });
  }

  resumeRoom(socket, payload, callback) {
    this.rejoinRoom(socket, payload, callback);
  }

  markPlayerAway(room, player) {
    if (!player || player.folded) return;
    const wasHost = room.hostId === player.id;
    if (player.id) {
      this.socketToRoom.delete(player.id);
      this.io.to(player.id).emit("player-away", {
        message: "You disconnected. Rejoin with the same name and room code within 60 seconds.",
      });
      player.id = null;
    }
    player.connected = false;
    player.awaySince = player.awaySince ?? Date.now();
    room.voteKick = null;

    if (wasHost || !room.players.some((p) => p.id === room.hostId)) {
      const nextHost = room.players.find((p) => p.id && p.connected && !p.folded);
      if (nextHost) room.hostId = nextHost.id;
    }
    this.scheduleCleanupIfEmpty(room);
  }

  kickPlayer(room, slot) {
    const player = room.players.find((p) => p.slot === slot);
    if (!player || player.folded) return;
    if (player.id) {
      this.io.to(player.id).emit("player-kicked", {
        message: "You were kicked. Rejoin with the same name and code within 60s to keep your cards.",
      });
    }
    this.markPlayerAway(room, player);
    this.emitGameState(room);
  }

  foldAwayPlayer(room, slot) {
    const player = room.players.find((p) => p.slot === slot);
    if (!player || player.folded || !room.gameState) return;

    player.folded = true;
    player.connected = false;
    player.awaySince = null;
    if (player.id) {
      this.socketToRoom.delete(player.id);
      player.id = null;
    }

    room.gameState = ensureActiveCurrentPlayer(foldSlotIntoDrawPile(room.gameState, slot));
    room.voteKick = null;
    this.io.to(room.code).emit("player-folded", {
      slot,
      name: player.name,
      message: `${player.name}'s cards were returned to the draw pile.`,
    });
    this.scheduleCleanupIfEmpty(room);
    this.emitGameState(room);
  }

  checkAwayTimeouts() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      if (room.status !== "playing" || !room.gameState) continue;
      let changed = false;
      for (const player of room.players) {
        if (player.folded || !player.awaySince) continue;
        if (now - player.awaySince >= AWAY_FOLD_MS) {
          this.foldAwayPlayer(room, player.slot);
          changed = true;
        }
      }
      if (changed) this.emitGameState(room);
    }
  }

  voteKick(socket, targetSlot, callback) {
    const code = this.socketToRoom.get(socket.id);
    const room = code ? this.rooms.get(code) : null;
    if (!room || room.status !== "playing") {
      callback?.({ ok: false, error: "No active game." });
      return;
    }

    const voter = this.findPlayer(room, socket.id);
    if (!voter || voter.folded || !voter.connected) {
      callback?.({ ok: false, error: "Only active players can vote." });
      return;
    }

    const target = room.players.find((p) => p.slot === targetSlot);
    if (!target || target.folded) {
      callback?.({ ok: false, error: "Invalid player." });
      return;
    }
    if (target.slot === voter.slot) {
      callback?.({ ok: false, error: "You cannot vote to kick yourself." });
      return;
    }

    if (!room.voteKick || room.voteKick.targetSlot !== targetSlot) {
      room.voteKick = { targetSlot, votes: new Set([socket.id]) };
    } else {
      room.voteKick.votes.add(socket.id);
    }

    const needed = this.votesNeeded(room, targetSlot);
    if (room.voteKick.votes.size >= needed) {
      this.kickPlayer(room, targetSlot);
      room.voteKick = null;
    }

    callback?.({ ok: true, voteKick: this.voteKickPayload(room) });
    this.emitGameState(room);
  }

  hostKick(socket, targetSlot, callback) {
    const code = this.socketToRoom.get(socket.id);
    const room = code ? this.rooms.get(code) : null;
    if (!room || room.status !== "playing") {
      callback?.({ ok: false, error: "No active game." });
      return;
    }
    if (room.hostId !== socket.id) {
      callback?.({ ok: false, error: "Only the host can kick." });
      return;
    }

    const target = room.players.find((p) => p.slot === targetSlot);
    if (!target || target.folded) {
      callback?.({ ok: false, error: "Invalid player." });
      return;
    }
    if (target.id === socket.id) {
      callback?.({ ok: false, error: "You cannot kick yourself." });
      return;
    }

    this.kickPlayer(room, targetSlot);
    room.voteKick = null;
    callback?.({ ok: true });
    this.emitGameState(room);
  }

  leaveRoom(socket) {
    const code = this.socketToRoom.get(socket.id);
    if (!code) return;
    const room = this.rooms.get(code);
    if (!room) return;

    const player = room.players.find((p) => p.id === socket.id);
    const spectator = (room.spectators ?? []).find((s) => s.id === socket.id);

    this.socketToRoom.delete(socket.id);
    socket.leave(code);

    if (spectator) {
      this.removeSpectatorBySocket(room, socket.id);
      if (room.players.length === 0 && (room.spectators?.length ?? 0) === 0) {
        this.cancelCleanup(room);
        this.rooms.delete(code);
      } else {
        this.scheduleCleanupIfEmpty(room);
      }
      return;
    }

    if (!player) return;

    if (room.status === "playing" && room.gameState && !player.folded) {
      this.markPlayerAway(room, player);
      if (room.players.some((p) => p.connected || p.awaySince)) {
        this.emitGameState(room);
      }
      return;
    }

    room.players = room.players.filter((p) => p.id !== socket.id);

    if (room.players.length === 0 && (room.spectators?.length ?? 0) === 0) {
      this.cancelCleanup(room);
      this.rooms.delete(code);
      return;
    }
    this.scheduleCleanupIfEmpty(room);

    if (room.hostId === socket.id) {
      room.hostId = room.players.find((p) => p.id)?.id ?? room.players[0]?.id;
    }

    this.emitLobby(room);
  }

  startGame(socket, callback) {
    const code = this.socketToRoom.get(socket.id);
    const room = code ? this.rooms.get(code) : null;
    if (!room) {
      callback?.({ ok: false, error: "Not in a room." });
      return;
    }
    if (room.hostId !== socket.id) {
      callback?.({ ok: false, error: "Only the host can start." });
      return;
    }
    const count = room.players.length;
    if (count < MIN_PLAYERS) {
      callback?.({ ok: false, error: `Need at least ${MIN_PLAYERS} players.` });
      return;
    }

    room.status = "playing";
    room.rules = normalizeGameRules(room.rules ?? DEFAULT_GAME_RULES);
    room.players.sort((a, b) => a.slot - b.slot);
    room.originalNames = room.players.map((p) => p.name);
    room.players.forEach((p) => {
      p.role = "player";
      p.folded = false;
      p.awaySince = null;
      p.connected = !!p.id;
    });
    room.spectators = [];
    room.voteKick = null;
    room.gameState = makeInitialGameState(count, room.startingHandSize, room.rules);

    callback?.({ ok: true });
    this.io.to(code).emit("game-started", {
      playerNames: room.players.map((p) => p.name),
    });
    this.emitGameState(room);
  }

  restartGame(socket, callback) {
    const code = this.socketToRoom.get(socket.id);
    const room = code ? this.rooms.get(code) : null;
    if (!room || room.status !== "playing" || !room.gameState) {
      callback?.({ ok: false, error: "No finished game to restart." });
      return;
    }
    if (room.hostId !== socket.id) {
      callback?.({ ok: false, error: "Only the host can restart the table." });
      return;
    }
    if (room.gameState.winner === null) {
      callback?.({ ok: false, error: "Finish the current game before restarting." });
      return;
    }

    room.players.sort((a, b) => a.slot - b.slot);
    room.rules = normalizeGameRules(room.rules ?? DEFAULT_GAME_RULES);
    room.originalNames = room.players.map((p) => p.name);
    room.players.forEach((p) => {
      p.role = "player";
      p.folded = false;
      p.awaySince = null;
      p.connected = !!p.id;
    });
    room.spectators = [];
    room.voteKick = null;
    room.gameState = makeInitialGameState(
      room.players.length,
      room.startingHandSize,
      room.rules
    );

    callback?.({ ok: true });
    this.io.to(code).emit("game-started", {
      playerNames: room.players.map((p) => p.name),
    });
    this.emitGameState(room);
  }

  returnToLobby(socket, callback) {
    const code = this.socketToRoom.get(socket.id);
    const room = code ? this.rooms.get(code) : null;
    if (!room || room.status !== "playing" || !room.gameState) {
      callback?.({ ok: false, error: "No finished game to change." });
      return;
    }
    if (room.hostId !== socket.id) {
      callback?.({ ok: false, error: "Only the host can change the rules." });
      return;
    }
    if (room.gameState.winner === null) {
      callback?.({ ok: false, error: "Finish the current game before changing rules." });
      return;
    }

    room.status = "lobby";
    room.gameState = null;
    room.originalNames = null;
    room.voteKick = null;
    room.players.sort((a, b) => a.slot - b.slot);
    room.players.forEach((p, slot) => {
      p.slot = slot;
      p.role = "player";
      p.folded = false;
      p.awaySince = null;
      p.connected = !!p.id;
    });
    room.maxPlayers = Math.max(room.maxPlayers, room.players.length);
    room.startingHandSize = clampStartingHandSize(room.startingHandSize, room.maxPlayers);

    callback?.({ ok: true });
    this.emitLobby(room);
  }

  findPlayer(room, socketId) {
    return room.players.find((p) => p.id === socketId);
  }

  findParticipant(room, socketId) {
    return (
      this.findPlayer(room, socketId) ??
      (room.spectators ?? []).find((s) => s.id === socketId)
    );
  }

  handleGameAction(socket, action, callback) {
    const code = this.socketToRoom.get(socket.id);
    const room = code ? this.rooms.get(code) : null;
    if (!room) {
      callback?.({ ok: false, error: "Not in a room. Rejoin with your room code and name." });
      return;
    }
    if (room.status !== "playing" || !room.gameState) {
      callback?.({ ok: false, error: "No active game. Try refreshing — your room may have ended." });
      return;
    }

    const player = this.findPlayer(room, socket.id);
    if (!player || player.slot === undefined) {
      callback?.({ ok: false, error: "Spectators cannot play. Rejoin in time to reclaim your seat." });
      return;
    }

    if (player.folded || room.gameState.foldedSlots?.[player.slot]) {
      callback?.({ ok: false, error: "You are out of this game (spectating)." });
      return;
    }

    if (!player.connected) {
      callback?.({ ok: false, error: "Reconnect to play." });
      return;
    }

    const slot = player.slot;
    let state = ensureActiveCurrentPlayer(room.gameState);

    if (state.winner !== null) {
      callback?.({ ok: false, error: "Game is over." });
      return;
    }

    if (state.currentPlayer !== slot) {
      callback?.({ ok: false, error: "Not your turn." });
      return;
    }

    let nextState = state;

    try {
      if (action.type === "draw") {
        const moves = getValidMoves(state, slot);
        const drawMove = moves.find((m) => m.type === "draw");
        if (!drawMove) {
          callback?.({ ok: false, error: "Cannot draw now." });
          return;
        }
        nextState = applyDraw(state, slot, drawMove.amount);
      } else if (action.type === "pass") {
        if (!state.mayPassAfterDraw) {
          callback?.({ ok: false, error: "Cannot pass now." });
          return;
        }
        nextState = applyPassTurn(state, slot);
      } else if (action.type === "play") {
        const { cardIndex, chosenColor } = action;
        const hand = state.hands[slot];
        if (
          !Number.isInteger(cardIndex) ||
          !Array.isArray(hand) ||
          cardIndex < 0 ||
          cardIndex >= hand.length
        ) {
          callback?.({ ok: false, error: "Invalid card." });
          return;
        }
        if (chosenColor != null && !COLORS.includes(chosenColor)) {
          callback?.({ ok: false, error: "Invalid color." });
          return;
        }
        const moves = getValidMoves(state, slot);
        const playMove = moves.find((m) => m.type === "play" && m.cardIndex === cardIndex);
        if (!playMove) {
          callback?.({ ok: false, error: "Invalid play." });
          return;
        }
        const card = hand[cardIndex];
        if (
          (card.value === ACTIONS.WILD || card.value === ACTIONS.WILD_DRAW_FOUR) &&
          !chosenColor
        ) {
          callback?.({ ok: false, error: "Choose a color for wild." });
          return;
        }
        nextState = applyPlay(state, slot, cardIndex, chosenColor ?? null);
      } else if (action.type === "uno") {
        if (!needsUnoCall(state, slot)) {
          callback?.({ ok: false, error: "Call UNO before playing from two cards to one." });
          return;
        }
        nextState = applyCallUno(state, slot);
      } else {
        callback?.({ ok: false, error: "Unknown action." });
        return;
      }
    } catch (err) {
      callback?.({ ok: false, error: err.message || "Invalid move." });
      return;
    }

    room.gameState = ensureActiveCurrentPlayer(nextState);
    const view = serializeStateForPlayer(room.gameState, slot);
    const meta = this.gameMeta(room);
    callback?.({ ok: true, state: view, ...meta });
    this.emitGameState(room);
  }

  handleDisconnect(socket) {
    const code = this.socketToRoom.get(socket.id);
    if (!code) return;
    const room = this.rooms.get(code);
    if (!room) return;

    const spectator = (room.spectators ?? []).find((s) => s.id === socket.id);
    if (spectator) {
      this.removeSpectatorBySocket(room, socket.id);
      this.socketToRoom.delete(socket.id);
      this.scheduleCleanupIfEmpty(room);
      return;
    }

    if (room.status === "lobby") {
      this.leaveRoom(socket);
      return;
    }

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    this.markPlayerAway(room, player);
    this.emitGameState(room);
  }
}

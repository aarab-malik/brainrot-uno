import { Server } from "socket.io";
import { RoomManager } from "./rooms.js";
import { MAX_PLAYERS, MAX_STARTING_HAND, MIN_PLAYERS, MIN_STARTING_HAND } from "../shared/gameLogic.js";

const NAME_MAX = 24;
const CODE_MIN = 4;
const CODE_MAX = 8;

class BadRequest extends Error {}

function bad(message = "Bad request") {
  throw new BadRequest(message);
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asName(v) {
  if (typeof v !== "string") bad();
  const trimmed = v.trim();
  if (trimmed.length < 1 || trimmed.length > NAME_MAX) bad();
  return trimmed;
}

function asCode(v) {
  if (typeof v !== "string") bad();
  const trimmed = v.trim();
  if (trimmed.length < CODE_MIN || trimmed.length > CODE_MAX) bad();
  return trimmed;
}

function asOptionalToken(v) {
  if (v == null) return null;
  if (typeof v !== "string" || v.length > 128) bad();
  return v;
}

function asInt(v, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) bad();
  return n;
}

function asOptionalInt(v, min, max) {
  return v == null ? undefined : asInt(v, min, max);
}

function asRules(v) {
  if (v == null) return undefined;
  if (!isPlainObject(v)) bad();
  return v;
}

function asAction(v) {
  if (!isPlainObject(v) || typeof v.type !== "string") bad();
  const action = { type: v.type };
  if (v.type === "play") {
    action.cardIndex = asInt(v.cardIndex, 0, 1000);
    if (v.chosenColor != null) {
      if (typeof v.chosenColor !== "string") bad();
      action.chosenColor = v.chosenColor;
    }
  }
  return action;
}

/** Run a handler; on any throw log it and answer {ok:false} instead of crashing the server. */
function safe(socket, event, handler) {
  socket.on(event, (...args) => {
    const cb = typeof args[args.length - 1] === "function" ? args.pop() : null;
    try {
      handler(args, cb);
    } catch (err) {
      if (!(err instanceof BadRequest)) {
        console.error(`[game-server] ${event} from ${socket.id} failed:`, err);
      }
      cb?.({ ok: false, error: "Bad request" });
    }
  });
}

/** Attach Socket.io multiplayer to an existing HTTP server (same port as Vite). */
export function attachGameServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: true,
      methods: ["GET", "POST"],
    },
  });

  const rooms = new RoomManager(io);

  io.on("connection", (socket) => {
    safe(socket, "host-room", ([payload], cb) => {
      if (!isPlainObject(payload)) bad();
      rooms.hostRoom(
        socket,
        {
          name: asName(payload.name),
          maxPlayers: asOptionalInt(payload.maxPlayers, MIN_PLAYERS, MAX_PLAYERS),
          startingHandSize: asOptionalInt(payload.startingHandSize, MIN_STARTING_HAND, MAX_STARTING_HAND),
          rules: asRules(payload.rules),
        },
        cb
      );
    });
    safe(socket, "set-max-players", ([maxPlayers], cb) =>
      rooms.setMaxPlayers(socket, asInt(maxPlayers, MIN_PLAYERS, MAX_PLAYERS), cb)
    );
    safe(socket, "set-starting-hand", ([handSize], cb) =>
      rooms.setStartingHandSize(socket, asInt(handSize, MIN_STARTING_HAND, MAX_STARTING_HAND), cb)
    );
    safe(socket, "set-room-rules", ([rules], cb) => {
      if (!isPlainObject(rules)) bad();
      rooms.setRoomRules(socket, rules, cb);
    });
    safe(socket, "join-room", ([payload], cb) => {
      if (!isPlainObject(payload)) bad();
      rooms.joinRoom(socket, asCode(payload.code), asName(payload.name), cb, asOptionalToken(payload.token));
    });
    const rejoin = ([payload], cb) => {
      if (!isPlainObject(payload)) bad();
      rooms.rejoinRoom(
        socket,
        { code: asCode(payload.code), name: asName(payload.name), token: asOptionalToken(payload.token) },
        cb
      );
    };
    safe(socket, "resume-room", rejoin);
    safe(socket, "rejoin-room", rejoin);
    safe(socket, "vote-kick", ([targetSlot], cb) =>
      rooms.voteKick(socket, asInt(targetSlot, 0, MAX_PLAYERS - 1), cb)
    );
    safe(socket, "host-kick", ([targetSlot], cb) =>
      rooms.hostKick(socket, asInt(targetSlot, 0, MAX_PLAYERS - 1), cb)
    );
    safe(socket, "leave-room", () => rooms.leaveRoom(socket));
    safe(socket, "start-game", (_args, cb) => rooms.startGame(socket, cb));
    safe(socket, "restart-game", (_args, cb) => rooms.restartGame(socket, cb));
    safe(socket, "return-lobby", (_args, cb) => rooms.returnToLobby(socket, cb));
    safe(socket, "game-action", ([action], cb) => rooms.handleGameAction(socket, asAction(action), cb));
    safe(socket, "disconnect", () => rooms.handleDisconnect(socket));
  });

  return { io, rooms };
}

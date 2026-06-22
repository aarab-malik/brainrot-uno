import { Server } from "socket.io";
import { RoomManager } from "./rooms.js";

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
    socket.on("host-room", (payload, cb) => rooms.hostRoom(socket, payload, cb));
    socket.on("set-max-players", (maxPlayers, cb) => rooms.setMaxPlayers(socket, maxPlayers, cb));
    socket.on("set-starting-hand", (handSize, cb) =>
      rooms.setStartingHandSize(socket, handSize, cb)
    );
    socket.on("join-room", ({ code, name }, cb) => rooms.joinRoom(socket, code, name, cb));
    socket.on("resume-room", (payload, cb) => rooms.resumeRoom(socket, payload, cb));
    socket.on("rejoin-room", (payload, cb) => rooms.rejoinRoom(socket, payload, cb));
    socket.on("vote-kick", (targetSlot, cb) => rooms.voteKick(socket, targetSlot, cb));
    socket.on("host-kick", (targetSlot, cb) => rooms.hostKick(socket, targetSlot, cb));
    socket.on("leave-room", () => rooms.leaveRoom(socket));
    socket.on("start-game", (cb) => rooms.startGame(socket, cb));
    socket.on("restart-game", (cb) => rooms.restartGame(socket, cb));
    socket.on("return-lobby", (cb) => rooms.returnToLobby(socket, cb));
    socket.on("game-action", (action, cb) => rooms.handleGameAction(socket, action, cb));
    socket.on("disconnect", () => rooms.handleDisconnect(socket));
  });

  return { io, rooms };
}

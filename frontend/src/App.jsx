import { useCallback, useEffect, useState } from "react";
import BotGame from "./game/BotGame";
import OnlineGame from "./game/OnlineGame";
import { useSocket } from "./hooks/useSocket";
import BotSetupScreen from "./screens/BotSetupScreen";
import HomeScreen from "./screens/HomeScreen";
import OnlineScreen from "./screens/OnlineScreen";
import { clearUnoSession, loadUnoSession, saveUnoSession } from "./utils/sessionStorage";

const SCREENS = {
  HOME: "home",
  BOTS_SETUP: "bots-setup",
  BOTS: "bots",
  ONLINE: "online",
  ONLINE_GAME: "online-game",
};

const ACK_TIMEOUT_MS = 5000;
const NO_RESPONSE = { ok: false, error: "No response from server" };

/** Emit with an ack and a timeout; the callback always gets a response object. */
function emitWithAck(socket, event, args, onResponse) {
  if (!socket) {
    onResponse(NO_RESPONSE);
    return;
  }
  socket.timeout(ACK_TIMEOUT_MS).emit(event, ...args, (err, res) => {
    onResponse(err ? NO_RESPONSE : res);
  });
}

export default function App() {
  const [screen, setScreen] = useState(SCREENS.HOME);
  const { socket, connected, connectError } = useSocket();

  const [lobby, setLobby] = useState(null);
  const [myPlayerId, setMyPlayerId] = useState(null);
  const [mySlot, setMySlot] = useState(null);
  const [onlineError, setOnlineError] = useState(null);
  const [gamePayload, setGamePayload] = useState(null);
  const [botPlayerCount, setBotPlayerCount] = useState(3);
  const [botStartingHand, setBotStartingHand] = useState(8);
  useEffect(() => {
    const s = socket.current;
    if (!s) return undefined;

    const onLobby = (data) => {
      setLobby(data);
      if (data?.status === "lobby") {
        setGamePayload(null);
        setScreen(SCREENS.ONLINE);
      }
      setOnlineError(null);
    };

    const onGameStarted = ({ playerNames }) => {
      setOnlineError(null);
      const session = loadUnoSession();
      if (session && playerNames?.[session.slot]) {
        saveUnoSession(session);
      }
    };

    s.on("lobby-update", onLobby);
    s.on("game-started", onGameStarted);

    return () => {
      s.off("lobby-update", onLobby);
      s.off("game-started", onGameStarted);
    };
  }, [socket]);

  useEffect(() => {
    const s = socket.current;
    if (!s) return undefined;

    const onGameUpdate = (payload) => {
      setGamePayload(payload);
      if (payload.isSpectator) {
        setMySlot(null);
      } else if (payload.yourSlot != null) {
        setMySlot(payload.yourSlot);
      }
      setScreen(SCREENS.ONLINE_GAME);
    };

    s.on("game-update", onGameUpdate);
    return () => s.off("game-update", onGameUpdate);
  }, [socket]);

  useEffect(() => {
    const s = socket.current;
    if (!s) return undefined;

    const tryResume = () => {
      const session = loadUnoSession();
      if (!session) return;
      emitWithAck(s, "resume-room", [session], (res) => {
        if (!res?.ok) {
          // Keep the session on a timeout so the next reconnect can retry.
          if (res !== NO_RESPONSE) clearUnoSession();
          return;
        }
        setMyPlayerId(res.playerId);
        saveUnoSession({
          code: res.code,
          name: session.name,
          slot: res.slot,
          token: res.token ?? session.token,
        });
        if (res.playing && res.state) {
          setGamePayload({
            state: res.state,
            yourSlot: res.slot,
            isSpectator: !!res.isSpectator,
            playerNames: res.playerNames,
            roster: res.roster,
            voteKick: res.voteKick,
            hostId: res.hostId,
            message: res.message,
          });
          setMySlot(res.isSpectator ? null : res.slot);
          setScreen(SCREENS.ONLINE_GAME);
        }
      });
    };

    if (s.connected) tryResume();
    s.on("connect", tryResume);
    return () => s.off("connect", tryResume);
  }, [socket]);

  const hostRoom = useCallback(
    (name, maxPlayers, startingHandSize) =>
      new Promise((resolve) => {
        emitWithAck(socket.current, "host-room", [{ name, maxPlayers, startingHandSize }], (res) => {
          if (res?.ok) {
            setMyPlayerId(res.playerId);
            setMySlot(res.slot);
            saveUnoSession({ code: res.code, slot: res.slot, name, token: res.token });
            setOnlineError(null);
          } else {
            setOnlineError(res?.error ?? "Could not create room");
          }
          resolve(res);
        });
      }),
    [socket]
  );

  const joinRoom = useCallback(
    (code, name) =>
      new Promise((resolve) => {
        // Re-send a stored token so a mid-game rejoin can reclaim the same seat.
        const stored = loadUnoSession();
        const token =
          stored && stored.code === code.toUpperCase() && stored.name === name.trim()
            ? stored.token
            : undefined;
        emitWithAck(socket.current, "join-room", [{ code, name, token }], (res) => {
          if (res?.ok) {
            setMyPlayerId(res.playerId);
            setMySlot(res.isSpectator ? null : res.slot);
            saveUnoSession({ code: res.code, name, slot: res.slot, token: res.token ?? token });
            setOnlineError(null);
            if (res.playing && res.state) {
              setGamePayload({
                state: res.state,
                yourSlot: res.slot,
                isSpectator: !!res.isSpectator,
                playerNames: res.playerNames,
                roster: res.roster,
                voteKick: res.voteKick,
                hostId: res.hostId,
                message: res.message,
              });
              setScreen(SCREENS.ONLINE_GAME);
            }
          } else {
            setOnlineError(res?.error ?? "Could not join");
          }
          resolve(res);
        });
      }),
    [socket]
  );

  const leaveLobby = useCallback(() => {
    socket.current?.emit("leave-room");
    clearUnoSession();
    setLobby(null);
    setMyPlayerId(null);
    setMySlot(null);
    setGamePayload(null);
    setScreen(SCREENS.HOME);
  }, [socket]);

  const startGame = useCallback(() => {
    emitWithAck(socket.current, "start-game", [], (res) => {
      if (!res?.ok) setOnlineError(res?.error ?? "Could not start");
    });
  }, [socket]);

  const setMaxPlayers = useCallback(
    (maxPlayers) =>
      new Promise((resolve) => {
        emitWithAck(socket.current, "set-max-players", [maxPlayers], (res) => {
          if (!res?.ok) setOnlineError(res?.error ?? "Could not update room");
          resolve(res);
        });
      }),
    [socket]
  );

  const setStartingHandSize = useCallback(
    (handSize) =>
      new Promise((resolve) => {
        emitWithAck(socket.current, "set-starting-hand", [handSize], (res) => {
          if (!res?.ok) setOnlineError(res?.error ?? "Could not update hand size");
          resolve(res);
        });
      }),
    [socket]
  );

  const setRoomRules = useCallback(
    (rules) =>
      new Promise((resolve) => {
        emitWithAck(socket.current, "set-room-rules", [rules], (res) => {
          if (!res?.ok) setOnlineError(res?.error ?? "Could not update rules");
          resolve(res);
        });
      }),
    [socket]
  );

  const enterGame = useCallback((payload) => {
    setGamePayload(payload);
    setScreen(SCREENS.ONLINE_GAME);
  }, []);

  if (screen === SCREENS.BOTS_SETUP) {
    return (
      <BotSetupScreen
        onBack={() => setScreen(SCREENS.HOME)}
        onStart={(count, startingHandSize) => {
          setBotPlayerCount(count);
          setBotStartingHand(startingHandSize ?? 8);
          setScreen(SCREENS.BOTS);
        }}
      />
    );
  }

  if (screen === SCREENS.BOTS) {
    return (
      <BotGame
        playerCount={botPlayerCount}
        startingHandSize={botStartingHand}
        onExit={() => setScreen(SCREENS.HOME)}
        onChangeRules={() => setScreen(SCREENS.BOTS_SETUP)}
      />
    );
  }

  if (screen === SCREENS.ONLINE_GAME && gamePayload?.state) {
    return (
      <OnlineGame
        socketRef={socket}
        mySlot={gamePayload.isSpectator ? null : mySlot}
        myPlayerId={myPlayerId}
        playerNames={gamePayload.playerNames}
        initialState={gamePayload.state}
        gamePayload={gamePayload}
        isSpectator={!!gamePayload.isSpectator}
        onExit={leaveLobby}
      />
    );
  }

  if (screen === SCREENS.ONLINE) {
    return (
      <OnlineScreen
        connected={connected}
        connectError={connectError}
        onBack={() => {
          if (lobby) leaveLobby();
          else setScreen(SCREENS.HOME);
        }}
        onHost={hostRoom}
        onJoin={joinRoom}
        lobby={lobby}
        myPlayerId={myPlayerId}
        error={onlineError}
        onStartGame={startGame}
        onSetMaxPlayers={setMaxPlayers}
        onSetStartingHandSize={setStartingHandSize}
        onSetRoomRules={setRoomRules}
        onLeaveLobby={leaveLobby}
        onEnterGame={enterGame}
        gamePayload={gamePayload}
      />
    );
  }

  return (
    <HomeScreen
      onPlayBots={() => setScreen(SCREENS.BOTS_SETUP)}
      onPlayOnline={() => setScreen(SCREENS.ONLINE)}
    />
  );
}

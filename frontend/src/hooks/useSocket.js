import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

/** Always same host + port as the page (5173, or your ngrok URL). */
function resolveSocketUrl() {
  if (import.meta.env.VITE_SOCKET_URL) {
    return import.meta.env.VITE_SOCKET_URL;
  }
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return undefined;
}

export function useSocket() {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [connectError, setConnectError] = useState(null);

  useEffect(() => {
    const url = resolveSocketUrl();
    const socket = io(url, {
      path: "/socket.io/",
      transports: ["polling", "websocket"],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 800,
      timeout: 20000,
    });
    socketRef.current = socket;

    const onConnect = () => {
      setConnected(true);
      setConnectError(null);
    };
    const onDisconnect = () => setConnected(false);
    const onConnectError = (err) => {
      setConnected(false);
      setConnectError(err.message || "Could not reach game server");
    };

    const onReconnectFailed = () => {
      setConnected(false);
      setConnectError("Could not reach game server after several attempts");
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.io.on("reconnect_failed", onReconnectFailed);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.io.off("reconnect_failed", onReconnectFailed);
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  /** Manual retry once automatic reconnection has given up. */
  const retry = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    setConnectError(null);
    socket.connect();
  }, []);

  return { socket: socketRef, connected, connectError, retry };
}

import { io, Socket } from "socket.io-client";
import { ClientToServerEvents, ServerToClientEvents } from "@openwcall/shared";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

let socket: Socket | null = null;

export function getSocket(token: string) {
  if (!socket) {
    socket = io(SERVER_URL, {
      autoConnect: false
    });
  }

  if (!socket.connected) {
    socket.connect();
    socket.emit(ClientToServerEvents.authHello, { token });
  }

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export type OpenWCallSocket = Socket<
  Record<keyof typeof ServerToClientEvents, (...args: never[]) => void>,
  Record<keyof typeof ClientToServerEvents, (...args: never[]) => void>
>;

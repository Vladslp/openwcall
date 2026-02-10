"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ClientToServerEvents, ServerToClientEvents } from "@openwcall/shared";
import { useAuthStore } from "../../../../store/auth";
import { getSocket } from "../../../../lib/socket";

interface RoomMessage {
  id: string;
  body: string;
  createdAt: string;
  sender: { nickname: string };
}

export default function RoomChatPage() {
  const params = useParams<{ roomId: string }>();
  const { accessToken } = useAuthStore();
  const socket = useMemo(() => (accessToken ? getSocket(accessToken) : null), [accessToken]);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [body, setBody] = useState("");

  useEffect(() => {
    if (!socket || !params.roomId) return;
    socket.emit(ClientToServerEvents.roomChatHistory, { roomId: params.roomId, limit: 50 });
    const onHistory = (payload: { roomId: string; messages: RoomMessage[] }) => {
      if (payload.roomId === params.roomId) setMessages(payload.messages);
    };
    const onMsg = (payload: { roomId: string; message: RoomMessage }) => {
      if (payload.roomId === params.roomId) setMessages((prev) => [...prev, payload.message]);
    };
    socket.on(ServerToClientEvents.roomChatHistory, onHistory);
    socket.on(ServerToClientEvents.roomChatMessage, onMsg);
    return () => {
      socket.off(ServerToClientEvents.roomChatHistory, onHistory);
      socket.off(ServerToClientEvents.roomChatMessage, onMsg);
    };
  }, [params.roomId, socket]);

  return (
    <div className="p-6 h-screen flex flex-col">
      <div className="flex justify-between items-center mb-3">
        <h1 className="text-xl">Room chat: {params.roomId}</h1>
        <Link href={`/room/${params.roomId}`} className="text-primary-400">Open voice room</Link>
      </div>
      <div className="flex-1 overflow-auto bg-slate-950 border border-slate-800 rounded p-3 space-y-2">
        {messages.map((m) => (
          <div key={m.id}>
            <div className="text-xs text-slate-500">{m.sender.nickname} • {new Date(m.createdAt).toLocaleString()}</div>
            <div>{m.body}</div>
          </div>
        ))}
      </div>
      <input
        className="mt-3 rounded bg-slate-900 border border-slate-800 px-3 py-2"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (!body.trim()) return;
            socket?.emit(ClientToServerEvents.roomChatSend, { roomId: params.roomId, body, clientMsgId: crypto.randomUUID() });
            setBody("");
          }
        }}
      />
    </div>
  );
}

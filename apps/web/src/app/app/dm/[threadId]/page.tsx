"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ClientToServerEvents, ServerToClientEvents } from "@openwcall/shared";
import { useAuthStore } from "../../../../store/auth";
import { getSocket } from "../../../../lib/socket";

interface Message {
  id: string;
  body: string;
  createdAt: string;
  sender: { id: string; nickname: string };
}

export default function DmPage() {
  const params = useParams<{ threadId: string }>();
  const { accessToken } = useAuthStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState("");
  const socket = useMemo(() => (accessToken ? getSocket(accessToken) : null), [accessToken]);

  useEffect(() => {
    if (!socket || !params.threadId) return;
    socket.emit(ClientToServerEvents.dmHistory, { threadId: params.threadId, limit: 50 });
    const onHistory = (payload: { threadId: string; messages: Message[] }) => {
      if (payload.threadId === params.threadId) setMessages(payload.messages);
    };
    const onNew = (payload: { threadId: string; message: Message }) => {
      if (payload.threadId === params.threadId) setMessages((prev) => [...prev, payload.message]);
    };
    socket.on(ServerToClientEvents.dmHistory, onHistory);
    socket.on(ServerToClientEvents.dmMessageNew, onNew);
    return () => {
      socket.off(ServerToClientEvents.dmHistory, onHistory);
      socket.off(ServerToClientEvents.dmMessageNew, onNew);
    };
  }, [params.threadId, socket]);

  return (
    <div className="h-screen flex flex-col p-4">
      <div className="flex-1 overflow-auto space-y-2 bg-slate-950 border border-slate-800 rounded p-3">
        {messages.map((m) => (
          <div key={m.id}>
            <div className="text-xs text-slate-500">{m.sender.nickname} • {new Date(m.createdAt).toLocaleString()}</div>
            <div>{m.body}</div>
          </div>
        ))}
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (!body.trim()) return;
            socket?.emit(ClientToServerEvents.dmSend, {
              threadId: params.threadId,
              body,
              clientMsgId: crypto.randomUUID()
            });
            setBody("");
          }
        }}
        className="mt-3 rounded bg-slate-900 border border-slate-800 px-3 py-2"
        placeholder="Message"
      />
    </div>
  );
}

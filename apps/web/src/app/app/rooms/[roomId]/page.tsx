"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { ClientToServerEvents, ServerToClientEvents } from "@openwcall/shared";
import { useAuthStore } from "../../../../store/auth";
import { getSocket } from "../../../../lib/socket";

interface RoomMessage { id: string; body: string | null; deleted?: boolean; createdAt: string; sender: { id: string; nickname: string }; reactions?: Record<string, string[]> }
const EMOJIS = ["👍", "❤️", "😂", "😮", "😭", "👎"];

export default function RoomChatPage() {
  const params = useParams<{ roomId: string }>();
  const { accessToken, user } = useAuthStore();
  const socket = useMemo(() => (accessToken ? getSocket(accessToken) : null), [accessToken]);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [body, setBody] = useState("");
  const [nextCursor, setNextCursor] = useState<{ createdAt: string; id: string } | null>(null);
  const [showNewPill, setShowNewPill] = useState(false);
  const [pending, setPending] = useState<Record<string, string>>({});
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!socket || !params.roomId) return;
    socket.emit(ClientToServerEvents.roomChatHistory, { roomId: params.roomId, limit: 30 });
    const onHistory = (payload: { roomId: string; messages: RoomMessage[]; nextCursor: { createdAt: string; id: string } | null }) => {
      if (payload.roomId !== params.roomId) return;
      setMessages((prev) => (prev.length ? [...payload.messages, ...prev] : payload.messages));
      setNextCursor(payload.nextCursor);
    };
    const onMsg = (payload: { roomId: string; message: RoomMessage }) => {
      if (payload.roomId !== params.roomId) return;
      setMessages((prev) => [...prev, payload.message]);
      const nearBottom = !listRef.current || listRef.current.scrollHeight - listRef.current.scrollTop - listRef.current.clientHeight < 40;
      if (!nearBottom) setShowNewPill(true);
    };
    const onAck = (payload: { clientMsgId: string; messageId: string }) => {
      setPending((prev) => {
        const copy = { ...prev };
        delete copy[payload.clientMsgId];
        return copy;
      });
    };
    const onUpdated = (payload: { message: RoomMessage }) => setMessages((prev) => prev.map((m) => (m.id === payload.message.id ? { ...m, ...payload.message } : m)));
    const onReaction = (payload: { messageId: string; emoji: string; userId: string; add: boolean }) => {
      setMessages((prev) => prev.map((m) => {
        if (m.id !== payload.messageId) return m;
        const next = { ...(m.reactions ?? {}) };
        const arr = new Set(next[payload.emoji] ?? []);
        if (payload.add) arr.add(payload.userId); else arr.delete(payload.userId);
        next[payload.emoji] = [...arr];
        return { ...m, reactions: next };
      }));
    };

    socket.on(ServerToClientEvents.roomChatHistory, onHistory);
    socket.on(ServerToClientEvents.roomChatMessage, onMsg);
    socket.on(ServerToClientEvents.roomChatSendAck, onAck);
    socket.on(ServerToClientEvents.msgUpdated, onUpdated);
    socket.on(ServerToClientEvents.msgReactionUpdate, onReaction);
    return () => {
      socket.off(ServerToClientEvents.roomChatHistory, onHistory);
      socket.off(ServerToClientEvents.roomChatMessage, onMsg);
      socket.off(ServerToClientEvents.roomChatSendAck, onAck);
      socket.off(ServerToClientEvents.msgUpdated, onUpdated);
      socket.off(ServerToClientEvents.msgReactionUpdate, onReaction);
    };
  }, [params.roomId, socket]);

  return (
    <div className="p-6 h-screen flex flex-col">
      <div className="flex justify-between items-center mb-3">
        <h1 className="text-xl">Room chat: {params.roomId}</h1>
        <Link href={`/room/${params.roomId}`} className="text-primary-400">Open voice room</Link>
      </div>
      <div ref={listRef} onScroll={(e) => {
        const el = e.currentTarget;
        if (el.scrollTop < 20 && nextCursor && socket) socket.emit(ClientToServerEvents.roomChatHistory, { roomId: params.roomId, limit: 30, cursor: nextCursor });
      }} className="flex-1 overflow-auto rounded border border-slate-800 p-3 bg-slate-950 space-y-2">
        {messages.map((m) => (
          <div key={m.id}>
            <div className="text-xs text-slate-500">{m.sender.nickname} • {new Date(m.createdAt).toLocaleString()}</div>
            <div>{m.deleted ? <i className="text-slate-500">Message deleted</i> : renderMentions(m.body ?? "")}</div>
            <div className="text-xs flex gap-2">{m.sender.id === user?.id && <><button onClick={() => socket?.emit(ClientToServerEvents.msgDelete, { messageId: m.id })}>Delete</button></>}</div>
            <div className="flex gap-1 flex-wrap">{EMOJIS.map((emoji) => <button key={emoji} className="px-1 rounded bg-slate-800" onClick={() => socket?.emit(ClientToServerEvents.msgReact, { messageId: m.id, emoji, add: true })}>{emoji} {m.reactions?.[emoji]?.length ?? 0}</button>)}</div>
          </div>
        ))}
      </div>
      {showNewPill && <button className="my-2 text-xs text-primary-300" onClick={() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); setShowNewPill(false); }}>New messages</button>}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (!body.trim()) return;
            const clientMsgId = crypto.randomUUID();
            setPending((prev) => ({ ...prev, [clientMsgId]: "sending" }));
            socket?.emit(ClientToServerEvents.roomChatSend, { roomId: params.roomId, body, clientMsgId });
            setBody("");
          }
        }}
        className="mt-3 rounded bg-slate-900 border border-slate-800 px-3 py-2"
        placeholder="Message the room"
      />
    </div>
  );
}

function renderMentions(text: string) {
  return text.split(/(@[a-zA-Z0-9._-]{3,24})/g).map((part, i) => part.startsWith("@") ? <span key={i} className="text-primary-300">{part}</span> : <span key={i}>{part}</span>);
}

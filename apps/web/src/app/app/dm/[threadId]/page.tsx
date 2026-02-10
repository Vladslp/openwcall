"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { ClientToServerEvents, ServerToClientEvents } from "@openwcall/shared";
import { useAuthStore } from "../../../../store/auth";
import { getSocket } from "../../../../lib/socket";

type Delivery = "sending" | "sent" | "failed";

interface Message {
  id: string;
  body: string | null;
  deleted?: boolean;
  createdAt: string;
  sender: { id: string; nickname: string };
  reactions?: Record<string, string[]>;
  delivery?: Delivery;
  clientMsgId?: string;
}

const EMOJIS = ["👍", "❤️", "😂", "😮", "😭", "👎"];

export default function DmPage() {
  const params = useParams<{ threadId: string }>();
  const { accessToken, user } = useAuthStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState("");
  const [typingText, setTypingText] = useState("");
  const [showNewPill, setShowNewPill] = useState(false);
  const [nextCursor, setNextCursor] = useState<{ createdAt: string; id: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const socket = useMemo(() => (accessToken ? getSocket(accessToken) : null), [accessToken]);
  const listRef = useRef<HTMLDivElement>(null);
  const retryTimers = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!socket || !params.threadId) return;
    socket.emit(ClientToServerEvents.dmHistory, { threadId: params.threadId, limit: 30 });

    const onHistory = (payload: { threadId: string; messages: Message[]; nextCursor: { createdAt: string; id: string } | null }) => {
      if (payload.threadId !== params.threadId) return;
      setMessages((prev) => (prev.length ? [...payload.messages, ...prev] : payload.messages));
      setNextCursor(payload.nextCursor);
    };
    const onNew = (payload: { threadId: string; message: Message }) => {
      if (payload.threadId !== params.threadId) return;
      setMessages((prev) => [...prev, payload.message]);
      const nearBottom = !listRef.current || listRef.current.scrollHeight - listRef.current.scrollTop - listRef.current.clientHeight < 40;
      if (!nearBottom) setShowNewPill(true);
    };
    const onAck = (payload: { clientMsgId: string; messageId: string; createdAt: string }) => {
      clearRetry(payload.clientMsgId);
      setMessages((prev) => prev.map((m) => (m.clientMsgId === payload.clientMsgId ? { ...m, id: payload.messageId, createdAt: payload.createdAt, delivery: "sent" } : m)));
    };
    const onTyping = (payload: { threadId: string; userId: string; isTyping: boolean }) => {
      if (payload.threadId !== params.threadId || payload.userId === user?.id) return;
      setTypingText(payload.isTyping ? "Typing…" : "");
    };
    const onUpdated = (payload: { message: Message }) => setMessages((prev) => prev.map((m) => (m.id === payload.message.id ? { ...m, ...payload.message } : m)));
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

    socket.on(ServerToClientEvents.dmHistory, onHistory);
    socket.on(ServerToClientEvents.dmMessageNew, onNew);
    socket.on(ServerToClientEvents.dmSendAck, onAck);
    socket.on(ServerToClientEvents.dmTyping, onTyping);
    socket.on(ServerToClientEvents.msgUpdated, onUpdated);
    socket.on(ServerToClientEvents.msgReactionUpdate, onReaction);
    return () => {
      socket.off(ServerToClientEvents.dmHistory, onHistory);
      socket.off(ServerToClientEvents.dmMessageNew, onNew);
      socket.off(ServerToClientEvents.dmSendAck, onAck);
      socket.off(ServerToClientEvents.dmTyping, onTyping);
      socket.off(ServerToClientEvents.msgUpdated, onUpdated);
      socket.off(ServerToClientEvents.msgReactionUpdate, onReaction);
    };
  }, [params.threadId, socket, user?.id]);

  const clearRetry = (clientMsgId: string) => {
    const timer = retryTimers.current.get(clientMsgId);
    if (timer) window.clearTimeout(timer);
    retryTimers.current.delete(clientMsgId);
  };

  const sendMessage = (text: string) => {
    if (!socket || !params.threadId || !text.trim()) return;
    const clientMsgId = crypto.randomUUID();
    const optimistic: Message = {
      id: `tmp-${clientMsgId}`,
      clientMsgId,
      body: text,
      createdAt: new Date().toISOString(),
      sender: { id: user?.id ?? "me", nickname: user?.nickname ?? user?.name ?? "me" },
      delivery: "sending",
      reactions: {}
    };
    setMessages((prev) => [...prev, optimistic]);
    socket.emit(ClientToServerEvents.dmSend, { threadId: params.threadId, body: text, clientMsgId });
    const timer = window.setTimeout(() => {
      setMessages((prev) => prev.map((m) => (m.clientMsgId === clientMsgId ? { ...m, delivery: "failed" } : m)));
      retryTimers.current.delete(clientMsgId);
    }, 8000);
    retryTimers.current.set(clientMsgId, timer);
  };

  return (
    <div className="h-screen flex flex-col p-4">
      <div ref={listRef} onScroll={(e) => {
        const el = e.currentTarget;
        if (el.scrollTop < 20 && nextCursor && socket) socket.emit(ClientToServerEvents.dmHistory, { threadId: params.threadId, limit: 30, cursor: nextCursor });
      }} className="flex-1 overflow-auto space-y-2 bg-slate-950 border border-slate-800 rounded p-3">
        {messages.map((m) => (
          <div key={m.id} className="text-sm">
            <div className="text-xs text-slate-500">{m.sender.nickname} • {new Date(m.createdAt).toLocaleString()}</div>
            {editingId === m.id ? (
              <div className="flex gap-2"><input className="bg-slate-900 border border-slate-700 rounded px-2" value={editingBody} onChange={(e) => setEditingBody(e.target.value)} /><button onClick={() => { socket?.emit(ClientToServerEvents.msgEdit, { messageId: m.id, body: editingBody }); setEditingId(null); }}>Save</button></div>
            ) : (
              <div>{m.deleted ? <i className="text-slate-500">Message deleted</i> : m.body}</div>
            )}
            <div className="flex gap-2 items-center text-xs text-slate-400">
              {m.delivery && <span>{m.delivery}</span>}
              {m.delivery === "failed" && <button className="text-amber-400" onClick={() => m.body && sendMessage(m.body)}>tap to retry</button>}
              {m.sender.id === user?.id && !m.deleted && <><button onClick={() => { setEditingId(m.id); setEditingBody(m.body ?? ""); }}>Edit</button><button onClick={() => socket?.emit(ClientToServerEvents.msgDelete, { messageId: m.id })}>Delete</button></>}
            </div>
            <div className="flex gap-1 flex-wrap mt-1">
              {EMOJIS.map((emoji) => <button key={emoji} className="px-1 rounded bg-slate-800" onClick={() => socket?.emit(ClientToServerEvents.msgReact, { messageId: m.id, emoji, add: true })}>{emoji} {m.reactions?.[emoji]?.length ?? 0}</button>)}
            </div>
          </div>
        ))}
      </div>
      {showNewPill && <button className="my-2 text-xs text-primary-300" onClick={() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); setShowNewPill(false); }}>New messages</button>}
      <div className="text-xs text-slate-500 h-4">{typingText}</div>
      <textarea
        value={body}
        onChange={(e) => {
          const value = e.target.value;
          setBody(value);
          socket?.emit(ClientToServerEvents.dmTyping, { threadId: params.threadId, isTyping: value.length > 0 });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage(body);
            setBody("");
            socket?.emit(ClientToServerEvents.dmTyping, { threadId: params.threadId, isTyping: false });
          }
        }}
        className="mt-2 rounded bg-slate-900 border border-slate-800 px-3 py-2"
        placeholder="Message"
      />
    </div>
  );
}

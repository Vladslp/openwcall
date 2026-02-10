"use client";

import { useEffect, useMemo, useState } from "react";
import { ClientToServerEvents, ServerToClientEvents } from "@openwcall/shared";
import { useAuthStore } from "../../../store/auth";
import { getSocket } from "../../../lib/socket";

type Tab = "online" | "all" | "pending";
interface Request { id: string; fromUser: { id: string; nickname: string }; toUser: { id: string; nickname: string } }
interface Friend { id: string; nickname: string; status: "online" | "away" }

export default function FriendsPage() {
  const { accessToken } = useAuthStore();
  const [tab, setTab] = useState<Tab>("online");
  const [incoming, setIncoming] = useState<Request[]>([]);
  const [outgoing, setOutgoing] = useState<Request[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const socket = useMemo(() => (accessToken ? getSocket(accessToken) : null), [accessToken]);

  useEffect(() => {
    if (!socket) return;
    socket.emit(ClientToServerEvents.friendsList, {});
    socket.on(ServerToClientEvents.friendsRequests, (payload) => { setIncoming(payload.incoming); setOutgoing(payload.outgoing); });
    socket.on(ServerToClientEvents.friendsList, (payload) => setFriends(payload.friends));
    return () => { socket.off(ServerToClientEvents.friendsRequests); socket.off(ServerToClientEvents.friendsList); };
  }, [socket]);

  const list = tab === "online" ? friends.filter((f) => f.status === "online") : friends;

  return (
    <div className="p-6">
      <h1 className="text-xl mb-4">Friends</h1>
      <div className="flex gap-2 mb-4">
        {(["online", "all", "pending"] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={`px-3 py-1 rounded ${tab === t ? "bg-primary-600" : "bg-slate-800"}`}>{t}</button>)}
      </div>
      {tab === "pending" ? (
        <div className="space-y-3">
          <h2>Incoming</h2>
          {incoming.map((req) => (
            <div key={req.id} className="p-2 border border-slate-800 rounded flex justify-between">
              <span>{req.fromUser.nickname}</span>
              <div className="space-x-2">
                <button onClick={() => socket?.emit(ClientToServerEvents.friendsRequestRespond, { requestId: req.id, action: "accept" })}>Accept</button>
                <button onClick={() => socket?.emit(ClientToServerEvents.friendsRequestRespond, { requestId: req.id, action: "decline" })}>Decline</button>
              </div>
            </div>
          ))}
          <h2>Outgoing</h2>
          {outgoing.map((req) => <div key={req.id} className="p-2 border border-slate-800 rounded">{req.toUser.nickname}</div>)}
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((f) => (
            <div key={f.id} className="p-2 border border-slate-800 rounded flex justify-between items-center">
              <span>{f.nickname} <span className="text-xs text-slate-500">{f.status}</span></span>
              <div className="space-x-2 text-sm">
                <button onClick={() => socket?.emit(ClientToServerEvents.callDirectInvite, { toUserId: f.id })}>Call</button>
                <button onClick={() => socket?.emit(ClientToServerEvents.dmThreadGetOrCreate, { withUserId: f.id })}>View profile</button>
                <button onClick={() => confirm("Remove friend?") && socket?.emit(ClientToServerEvents.friendsRemove, { userId: f.id })}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { ClientToServerEvents, ServerToClientEvents } from "@openwcall/shared";
import { useAuthStore } from "../../../store/auth";
import { getSocket } from "../../../lib/socket";

interface Request {
  id: string;
  fromUser: { nickname: string };
}

export default function FriendsPage() {
  const { accessToken } = useAuthStore();
  const [incoming, setIncoming] = useState<Request[]>([]);
  const socket = useMemo(() => (accessToken ? getSocket(accessToken) : null), [accessToken]);

  useEffect(() => {
    if (!socket) return;
    socket.emit(ClientToServerEvents.friendsList, {});
    socket.on(ServerToClientEvents.friendsRequests, (payload) => setIncoming(payload.incoming));
    return () => { socket.off(ServerToClientEvents.friendsRequests); };
  }, [socket]);

  return (
    <div className="p-6">
      <h1 className="text-xl mb-4">Friend Requests</h1>
      {incoming.map((req) => (
        <div key={req.id} className="mb-2 p-2 border border-slate-800 rounded flex justify-between">
          <span>{req.fromUser.nickname}</span>
          <div className="space-x-2">
            <button onClick={() => socket?.emit(ClientToServerEvents.friendsRequestRespond, { requestId: req.id, action: "accept" })}>Accept</button>
            <button onClick={() => socket?.emit(ClientToServerEvents.friendsRequestRespond, { requestId: req.id, action: "decline" })}>Decline</button>
          </div>
        </div>
      ))}
    </div>
  );
}

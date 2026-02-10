"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ClientToServerEvents, ServerToClientEvents, TEXT } from "@openwcall/shared";
import { useAuthStore } from "../../store/auth";
import { getSocket, disconnectSocket } from "../../lib/socket";
import { logout } from "../../lib/api";

interface RoomInfo {
  roomId: string;
  name: string;
  isPublic: boolean;
  locked: boolean;
  count: number;
}

interface OnlineUser {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  status: "online" | "away";
}

export default function LobbyPage() {
  const router = useRouter();
  const { accessToken, refreshToken, user, clear } = useAuthStore();
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [users, setUsers] = useState<OnlineUser[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", isPublic: true, password: "" });
  const [incomingCall, setIncomingCall] = useState<{ callId: string; fromUser: OnlineUser } | null>(null);
  const [outgoingCallId, setOutgoingCallId] = useState<string | null>(null);

  const socket = useMemo(() => {
    if (!accessToken) return null;
    return getSocket(accessToken);
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    if (!socket) return;

    socket.on(ServerToClientEvents.roomList, (payload) => setRooms(payload.rooms));
    socket.on(ServerToClientEvents.presenceList, (payload) => setUsers(payload.usersOnline));
    socket.on(ServerToClientEvents.callDirectIncoming, (payload) => {
      setIncomingCall({ callId: payload.callId, fromUser: payload.fromUser });
    });
    socket.on(ServerToClientEvents.callDirectState, (payload) => {
      if (payload.state === "ringing") {
        setOutgoingCallId(payload.callId);
      }
      if (payload.state === "connected") {
        router.push(`/room/direct-${payload.callId}`);
      }
      if (payload.state === "ended") {
        setOutgoingCallId(null);
      }
    });

    return () => {
      socket.off(ServerToClientEvents.roomList);
      socket.off(ServerToClientEvents.presenceList);
      socket.off(ServerToClientEvents.callDirectIncoming);
      socket.off(ServerToClientEvents.callDirectState);
    };
  }, [accessToken, router, socket]);

  useEffect(() => {
    return () => {
      disconnectSocket();
    };
  }, []);

  const handleCreateRoom = () => {
    if (!socket) return;
    socket.emit(ClientToServerEvents.roomCreate, {
      name: createForm.name,
      isPublic: createForm.isPublic,
      password: createForm.isPublic ? undefined : createForm.password || undefined
    });
    setShowCreate(false);
    setCreateForm({ name: "", isPublic: true, password: "" });
  };

  const handleJoinRoom = (roomId: string) => {
    router.push(`/room/${roomId}`);
  };

  const handleSignOut = async () => {
    if (refreshToken) {
      await logout(refreshToken);
    }
    clear();
    router.replace("/login");
  };

  const handleInvite = (targetUserId: string) => {
    if (!socket) return;
    socket.emit(ClientToServerEvents.callDirectInvite, { toUserId: targetUserId });
  };

  const handleAcceptCall = () => {
    if (!socket || !incomingCall) return;
    socket.emit(ClientToServerEvents.callDirectAccept, { callId: incomingCall.callId });
    router.push(`/room/direct-${incomingCall.callId}`);
    setIncomingCall(null);
  };

  const handleDeclineCall = () => {
    if (!socket || !incomingCall) return;
    socket.emit(ClientToServerEvents.callDirectDecline, { callId: incomingCall.callId });
    setIncomingCall(null);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{TEXT.appName}</h1>
          <p className="text-sm text-slate-400">Welcome back{user ? `, ${user.name}` : ""}.</p>
        </div>
        <button onClick={handleSignOut} className="text-sm text-slate-300 hover:text-white">
          {TEXT.signOut}
        </button>
      </header>

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 p-6">
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">{TEXT.roomsTitle}</h2>
            <button
              className="rounded-lg bg-primary-500 text-slate-950 px-3 py-1 text-sm"
              onClick={() => setShowCreate(true)}
            >
              {TEXT.createRoom}
            </button>
          </div>
          <div className="space-y-3">
            {rooms.map((room) => (
              <div
                key={room.roomId}
                className="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-xl px-4 py-3"
              >
                <div>
                  <p className="font-medium">{room.name}</p>
                  <p className="text-xs text-slate-400">
                    {room.count} participants {room.locked ? "• Locked" : ""}
                  </p>
                </div>
                <button
                  className="text-sm text-primary-400 hover:text-primary-300"
                  onClick={() => handleJoinRoom(room.roomId)}
                >
                  {TEXT.joinRoom}
                </button>
              </div>
            ))}
            {rooms.length === 0 && <p className="text-sm text-slate-400">No rooms yet.</p>}
          </div>
        </section>

        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
          <h2 className="text-lg font-semibold mb-4">{TEXT.usersTitle}</h2>
          <div className="space-y-3">
            {users
              .filter((entry) => entry.userId !== user?.id)
              .map((entry) => (
                <div
                  key={entry.userId}
                  className="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-xl px-4 py-3"
                >
                  <div>
                    <p className="font-medium">{entry.name}</p>
                    <p className="text-xs text-slate-400">{entry.status}</p>
                  </div>
                  <button
                    className="text-sm text-primary-400 hover:text-primary-300"
                    onClick={() => handleInvite(entry.userId)}
                  >
                    Call
                  </button>
                </div>
              ))}
            {users.length === 0 && <p className="text-sm text-slate-400">No one online.</p>}
          </div>
        </section>
      </main>

      {showCreate && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center px-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">{TEXT.createRoom}</h3>
            <div className="space-y-3">
              <input
                className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2"
                placeholder={TEXT.roomName}
                value={createForm.name}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, name: event.target.value }))}
              />
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!createForm.isPublic}
                  onChange={(event) =>
                    setCreateForm((prev) => ({ ...prev, isPublic: !event.target.checked }))
                  }
                />
                <span className="text-sm">Private room</span>
              </div>
              {!createForm.isPublic && (
                <input
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2"
                  placeholder={TEXT.roomPassword}
                  value={createForm.password}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, password: event.target.value }))}
                />
              )}
            </div>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button className="text-sm text-slate-400" onClick={() => setShowCreate(false)}>
                {TEXT.cancel}
              </button>
              <button
                className="rounded-lg bg-primary-500 text-slate-950 px-3 py-1 text-sm"
                onClick={handleCreateRoom}
              >
                {TEXT.create}
              </button>
            </div>
          </div>
        </div>
      )}

      {incomingCall && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center px-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-2">{TEXT.incomingCall}</h3>
            <p className="text-sm text-slate-400 mb-6">{incomingCall.fromUser.name} is calling you.</p>
            <div className="flex items-center justify-end gap-3">
              <button className="text-sm text-slate-400" onClick={handleDeclineCall}>
                {TEXT.decline}
              </button>
              <button
                className="rounded-lg bg-primary-500 text-slate-950 px-3 py-1 text-sm"
                onClick={handleAcceptCall}
              >
                {TEXT.accept}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

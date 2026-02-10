"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ClientToServerEvents, ServerToClientEvents } from "@openwcall/shared";
import { useAuthStore } from "../store/auth";
import { getSocket } from "../lib/socket";

interface SearchUser { id: string; nickname: string; status: "online" | "away"; avatarUrl?: string | null }
interface Friend { id: string; nickname: string; status: "online" | "away"; avatarUrl?: string | null }
interface Thread { id: string; withUser: { id: string; nickname: string }; lastMessagePreview: string }
interface Notification { id: string; type: string; createdAt: string; readAt?: string | null }

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { accessToken, user } = useAuthStore();
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [incomingCount, setIncomingCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [activeCall, setActiveCall] = useState<{ callId: string; state: string } | null>(null);
  const socket = useMemo(() => (accessToken ? getSocket(accessToken) : null), [accessToken]);

  useEffect(() => {
    if (!accessToken) return router.replace("/login");
    if (!socket) return;

    socket.emit(ClientToServerEvents.friendsList, {});
    socket.emit(ClientToServerEvents.dmThreadList, {});

    socket.on(ServerToClientEvents.userSearchResult, (payload) => setSearchResults(payload.users));
    socket.on(ServerToClientEvents.friendsList, (payload) => setFriends(payload.friends));
    socket.on(ServerToClientEvents.friendsRequests, (payload) => setIncomingCount(payload.incoming.length));
    socket.on(ServerToClientEvents.dmThreadList, (payload) => setThreads(payload.threads));
    socket.on(ServerToClientEvents.notificationList, (payload) => setNotifications(payload.notifications));
    socket.on(ServerToClientEvents.notificationNew, (payload) => setNotifications((prev) => [payload.notification, ...prev]));
    socket.on(ServerToClientEvents.callDirectState, (payload) => setActiveCall(payload.state === "ended" ? null : payload));

    return () => {
      socket.off(ServerToClientEvents.userSearchResult);
      socket.off(ServerToClientEvents.friendsList);
      socket.off(ServerToClientEvents.friendsRequests);
      socket.off(ServerToClientEvents.dmThreadList);
      socket.off(ServerToClientEvents.notificationList);
      socket.off(ServerToClientEvents.notificationNew);
      socket.off(ServerToClientEvents.callDirectState);
    };
  }, [accessToken, router, socket]);

  useEffect(() => {
    if (!socket || search.trim().length < 2) return;
    const timer = setTimeout(() => socket.emit(ClientToServerEvents.userSearch, { query: search, limit: 8 }), 300);
    return () => clearTimeout(timer);
  }, [search, socket]);

  const markAllRead = () => {
    const unread = notifications.filter((n) => !n.readAt).map((n) => n.id);
    if (unread.length) socket?.emit(ClientToServerEvents.notificationsRead, { ids: unread });
  };

  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-[320px_1fr]">
      <aside className="border-r border-slate-800 p-4 space-y-4">
        <div className="flex justify-between items-center">
          <div><p className="text-xs text-slate-400">Signed in as</p><p className="font-semibold">{user?.name}</p></div>
          <button onClick={() => setShowNotifications((v) => !v)}>🔔 {notifications.filter((n) => !n.readAt).length}</button>
        </div>
        {showNotifications && <div className="bg-slate-900 border border-slate-800 rounded p-2 text-xs space-y-2"><button className="text-primary-300" onClick={markAllRead}>Mark all read</button>{notifications.map((n) => <div key={n.id} className={n.readAt ? "text-slate-500" : "text-slate-100"}>{n.type} • {new Date(n.createdAt).toLocaleString()}</div>)}</div>}
        <input
          placeholder="Find by nickname"
          className="w-full rounded bg-slate-900 border border-slate-800 px-3 py-2"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {!!recentSearches.length && <div className="text-xs text-slate-500">Recent: {recentSearches.join(", ")}</div>}
        <div className="space-y-1">
          {searchResults.map((u) => (
            <div key={u.id} className="text-sm bg-slate-900 border border-slate-800 rounded px-2 py-1">
              <div className="flex items-center justify-between gap-2">
                <span>{u.nickname}</span>
                <div className="flex gap-2">
                  <button className="text-primary-400" onClick={() => { setRecentSearches((prev) => [u.nickname, ...prev.filter((s) => s !== u.nickname)].slice(0, 5)); socket?.emit(ClientToServerEvents.friendsRequestSend, { toNickname: u.nickname }); }}>+Friend</button>
                  <button className="text-primary-400" onClick={() => socket?.emit(ClientToServerEvents.dmThreadGetOrCreate, { withUserId: u.id })}>DM</button>
                  <button className="text-primary-400" onClick={() => socket?.emit(ClientToServerEvents.callDirectInvite, { toUserId: u.id })}>Call</button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div>
          <div className="flex justify-between items-center mb-2">
            <h3 className="font-medium">Friends</h3>
            <Link href="/app/friends" className="text-xs text-primary-400">Requests ({incomingCount})</Link>
          </div>
          {friends.map((f) => (
            <button key={f.id} className="w-full text-left text-sm py-1" onClick={() => socket?.emit(ClientToServerEvents.dmThreadGetOrCreate, { withUserId: f.id })}>
              {f.nickname} <span className="text-xs text-slate-500">{f.status}</span>
            </button>
          ))}
        </div>

        <div>
          <h3 className="font-medium mb-2">DMs</h3>
          {threads.map((t) => (
            <Link key={t.id} href={`/app/dm/${t.id}`} className={`block text-sm py-1 ${pathname?.includes(t.id) ? "text-primary-400" : "text-slate-200"}`}>
              {t.withUser.nickname}
              <div className="text-xs text-slate-500 truncate">{t.lastMessagePreview}</div>
            </Link>
          ))}
        </div>

        <div className="pt-2 border-t border-slate-800 flex gap-4 text-sm">
          <Link href="/lobby">Rooms</Link>
          <Link href="/app/settings">Settings</Link>
        </div>
      </aside>
      <section>
        {activeCall && <div className="px-4 py-2 bg-slate-900 border-b border-slate-700 text-sm flex justify-between"><span>Call {activeCall.state}</span><button onClick={() => setActiveCall(null)}>Leave</button></div>}
        {children}
      </section>
    </div>
  );
}

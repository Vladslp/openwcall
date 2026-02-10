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

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { accessToken, user } = useAuthStore();
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [incomingCount, setIncomingCount] = useState(0);
  const socket = useMemo(() => (accessToken ? getSocket(accessToken) : null), [accessToken]);

  useEffect(() => {
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    if (!socket) return;

    socket.emit(ClientToServerEvents.friendsList, {});
    socket.emit(ClientToServerEvents.dmThreadList, {});

    socket.on(ServerToClientEvents.userSearchResult, (payload) => setSearchResults(payload.users));
    socket.on(ServerToClientEvents.friendsList, (payload) => setFriends(payload.friends));
    socket.on(ServerToClientEvents.friendsRequests, (payload) => setIncomingCount(payload.incoming.length));
    socket.on(ServerToClientEvents.dmThreadList, (payload) => setThreads(payload.threads));

    return () => {
      socket.off(ServerToClientEvents.userSearchResult);
      socket.off(ServerToClientEvents.friendsList);
      socket.off(ServerToClientEvents.friendsRequests);
      socket.off(ServerToClientEvents.dmThreadList);
    };
  }, [accessToken, router, socket]);

  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-[320px_1fr]">
      <aside className="border-r border-slate-800 p-4 space-y-4">
        <div>
          <p className="text-xs text-slate-400">Signed in as</p>
          <p className="font-semibold">{user?.name}</p>
        </div>
        <input
          placeholder="Find by nickname"
          className="w-full rounded bg-slate-900 border border-slate-800 px-3 py-2"
          value={search}
          onChange={(e) => {
            const value = e.target.value;
            setSearch(value);
            if (!socket || value.trim().length < 2) return;
            socket.emit(ClientToServerEvents.userSearch, { query: value, limit: 8 });
          }}
        />
        <div className="space-y-1">
          {searchResults.map((u) => (
            <div key={u.id} className="text-sm bg-slate-900 border border-slate-800 rounded px-2 py-1">
              <div className="flex items-center justify-between gap-2">
                <span>{u.nickname}</span>
                <div className="flex gap-2">
                  <button
                    className="text-primary-400"
                    onClick={() => socket?.emit(ClientToServerEvents.friendsRequestSend, { toNickname: u.nickname })}
                  >
                    +Friend
                  </button>
                  <button
                    className="text-primary-400"
                    onClick={() => socket?.emit(ClientToServerEvents.dmThreadGetOrCreate, { withUserId: u.id })}
                  >
                    DM
                  </button>
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
      <section>{children}</section>
    </div>
  );
}

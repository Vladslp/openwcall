"use client";

import { useMemo, useState } from "react";
import { ClientToServerEvents, ServerToClientEvents } from "@openwcall/shared";
import { useAuthStore } from "../../../store/auth";
import { getSocket } from "../../../lib/socket";

export default function SettingsPage() {
  const { accessToken } = useAuthStore();
  const [nickname, setNickname] = useState("");
  const [status, setStatus] = useState("");
  const socket = useMemo(() => (accessToken ? getSocket(accessToken) : null), [accessToken]);

  const submit = () => {
    socket?.emit(ClientToServerEvents.userNicknameSet, { nickname });
    socket?.once(ServerToClientEvents.userNicknameOk, (payload) => setStatus(`Saved: ${payload.nickname}`));
  };

  return (
    <div className="p-6 max-w-lg">
      <h1 className="text-xl mb-4">Settings</h1>
      <label className="block text-sm mb-2">Nickname</label>
      <input className="w-full rounded bg-slate-900 border border-slate-800 px-3 py-2" value={nickname} onChange={(e) => setNickname(e.target.value)} />
      <button className="mt-3 rounded bg-primary-500 text-slate-950 px-4 py-2" onClick={submit}>Save nickname</button>
      {status && <p className="text-sm text-slate-400 mt-2">{status}</p>}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TEXT } from "@openwcall/shared";
import { loginByNickname } from "../../lib/api";
import { useAuthStore } from "../../store/auth";

export default function LoginPage() {
  const router = useRouter();
  const setSession = useAuthStore((state) => state.setSession);
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const data = await loginByNickname({ nickname });
      setSession({ accessToken: data.sessionToken, user: data.user });
      router.push("/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to login");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-xl">
        <h1 className="text-2xl font-semibold mb-2">{TEXT.loginTitle}</h1>
        <p className="text-sm text-slate-400 mb-6">Введите только ник и войдите.</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            required
            placeholder="Nickname"
            className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            aria-label="Nickname"
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            className="w-full rounded-lg bg-primary-500 text-slate-950 font-medium py-2"
          >
            Войти
          </button>
        </form>
      </div>
    </div>
  );
}

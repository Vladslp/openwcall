"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TEXT } from "@openwcall/shared";
import { loginUser, registerUser } from "../../lib/api";
import { useAuthStore } from "../../store/auth";

export default function LoginPage() {
  const router = useRouter();
  const setSession = useAuthStore((state) => state.setSession);
  const [isRegister, setIsRegister] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", password: "" });
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const data = isRegister
        ? await registerUser(form)
        : await loginUser({ email: form.email, password: form.password });
      setSession({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
      router.push("/lobby");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to login");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-xl">
        <h1 className="text-2xl font-semibold mb-2">{TEXT.loginTitle}</h1>
        <p className="text-sm text-slate-400 mb-6">Sign in to start calling.</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            required
            placeholder="Email"
            className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2"
            value={form.email}
            onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
            aria-label="Email"
          />
          {isRegister && (
            <input
              type="text"
              required
              placeholder="Name"
              className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2"
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              aria-label="Name"
            />
          )}
          <input
            type="password"
            required
            placeholder="Password"
            className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2"
            value={form.password}
            onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
            aria-label="Password"
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            className="w-full rounded-lg bg-primary-500 text-slate-950 font-medium py-2"
          >
            {isRegister ? "Create account" : "Sign in"}
          </button>
        </form>
        <button
          onClick={() => setIsRegister((prev) => !prev)}
          className="mt-4 text-sm text-slate-400 hover:text-slate-200"
        >
          {isRegister ? "Already have an account? Sign in" : "New here? Create account"}
        </button>
      </div>
    </div>
  );
}

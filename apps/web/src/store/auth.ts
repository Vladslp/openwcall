import { create } from "zustand";

interface AuthState {
  accessToken: string | null;
  user: { id: string; name: string; nickname?: string | null; avatarUrl?: string | null } | null;
  setSession: (payload: { accessToken: string; user: AuthState["user"] }) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: typeof window !== "undefined" ? localStorage.getItem("openwcall_access") : null,
  user: null,
  setSession: ({ accessToken, user }) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("openwcall_access", accessToken);
    }
    set({ accessToken, user });
  },
  clear: () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("openwcall_access");
    }
    set({ accessToken: null, user: null });
  }
}));

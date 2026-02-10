import { create } from "zustand";

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: { id: string; name: string; email: string } | null;
  setSession: (payload: { accessToken: string; refreshToken: string; user: AuthState["user"] }) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: typeof window !== "undefined" ? localStorage.getItem("openwcall_access") : null,
  refreshToken: typeof window !== "undefined" ? localStorage.getItem("openwcall_refresh") : null,
  user: null,
  setSession: ({ accessToken, refreshToken, user }) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("openwcall_access", accessToken);
      localStorage.setItem("openwcall_refresh", refreshToken);
    }
    set({ accessToken, refreshToken, user });
  },
  clear: () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("openwcall_access");
      localStorage.removeItem("openwcall_refresh");
    }
    set({ accessToken: null, refreshToken: null, user: null });
  }
}));

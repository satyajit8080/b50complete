import { create } from "zustand";
import { apiFetch, setAccessToken } from "../lib/api";

export interface User {
  id: string;
  email: string;
  name?: string;
  role: "USER" | "ADMIN" | "SUPERADMIN";
  tier: "FREE" | "PRO" | "ELITE";
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchMe: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,

  login: async (email, password) => {
    const data = await apiFetch<{ accessToken: string; user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
      skipAuth: true,
    });
    setAccessToken(data.accessToken);
    set({ user: data.user });
  },

  register: async (email, password, name) => {
    const data = await apiFetch<{ accessToken: string; user: User }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, name }),
      skipAuth: true,
    });
    setAccessToken(data.accessToken);
    set({ user: data.user });
  },

  logout: async () => {
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setAccessToken(null);
    set({ user: null });
  },

  fetchMe: async () => {
    set({ isLoading: true });
    try {
      const data = await apiFetch<{ user: User }>("/api/auth/refresh", { method: "POST", skipAuth: true });
      if ((data as any).accessToken) setAccessToken((data as any).accessToken);
      const me = await apiFetch<{ user: User }>("/api/auth/me");
      set({ user: me.user, isLoading: false });
    } catch {
      set({ user: null, isLoading: false });
    }
  },
}));

import { create } from "zustand"
import { applyAccountPreferences } from "@/lib/account-prefs"
import { authApi, meApi } from "@/lib/api"
import type { Me } from "@/lib/api-types"

/**
 * 会话与当前用户。`status: "loading"` 表示还没问过 `/api/me`，`ready` 表示已有
 * 结论（可能是未登录）。会话 Cookie 是 HttpOnly，前端只读 `/api/me` 的结果。
 */
interface AuthState {
  user: Me | null
  status: "loading" | "ready"
  load: () => Promise<Me | null>
  setUser: (user: Me | null) => void
  refresh: () => Promise<Me | null>
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  status: "loading",

  load: async () => {
    try {
      const user = await meApi.get()
      set({ user, status: "ready" })
      await applyAccountPreferences(user)
      return user
    } catch {
      set({ user: null, status: "ready" })
      return null
    }
  },

  setUser: (user) => set({ user, status: "ready" }),

  refresh: async () => {
    try {
      const user = await meApi.get()
      set({ user, status: "ready" })
      return user
    } catch {
      return get().user
    }
  },

  logout: async () => {
    try {
      await authApi.logout()
    } catch {
      // 网络断了也清本地状态，不把用户卡在假登录态
    }
    set({ user: null, status: "ready" })
  }
}))

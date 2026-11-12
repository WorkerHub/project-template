/**
 * 主题偏好（zustand + persist，规格 §6.2）。
 *
 * 初值在模块加载时同步读 localStorage：Provider 的第一次 useLayoutEffect 就能
 * 用上已保存的档位，暗色访客不会先亮后暗。persist 只是把后续选择写回去。
 * 登录后账号偏好由设置页/登录流程覆盖本机值（同样写回这里）。
 */
import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import { readStoredTheme, THEME_STORAGE_KEY, type Theme } from "@/lib/theme"

interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: readStoredTheme() ?? "auto",
      setTheme: (theme) => set({ theme })
    }),
    {
      name: THEME_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ theme: state.theme })
    }
  )
)

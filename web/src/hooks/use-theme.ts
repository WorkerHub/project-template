/**
 * 主题相关的 React 侧钩子：系统外观订阅 + 生效深浅色。
 *
 * 单独成文件是为了让 Provider、Sonner 与设置页共用同一个「系统外观」订阅语义，
 * 不各自 matchMedia 一遍。
 */
import { useEffect, useState } from "react"
import {
  resolveTheme,
  systemPrefersDark,
  watchSystemTheme,
  type ResolvedTheme
} from "@/lib/theme"
import { useThemeStore } from "@/stores/theme"

/** 系统外观（真事实，不是用户偏好）；挂载后监听变化实时跟随。 */
export function useSystemDark(): boolean {
  const [systemDark, setSystemDark] = useState(systemPrefersDark)

  useEffect(() => {
    setSystemDark(systemPrefersDark())
    return watchSystemTheme(() => setSystemDark(systemPrefersDark()))
  }, [])

  return systemDark
}

/** 当前生效的深浅色：三档偏好按系统外观解析。 */
export function useResolvedTheme(): ResolvedTheme {
  const theme = useThemeStore((state) => state.theme)
  const systemDark = useSystemDark()
  return resolveTheme(theme, systemDark)
}

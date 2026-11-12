import { useLayoutEffect } from "react"
import { useResolvedTheme } from "@/hooks/use-theme"
import { applyTheme } from "@/lib/theme"

/**
 * 主题 Provider：把生效档位落到 `<html>`（规格 §6.2）。
 *
 * - `auto` 档由 useResolvedTheme 订阅系统外观，系统切换即时跟随；
 * - useLayoutEffect 在绘制前完成 class 切换，避免先亮后暗；首屏的第一次
 *   落定另有 web/index.html 的内联脚本兜底；
 * - 全站同一个 Provider（登录页、setup、关于页都包在里面）。
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const resolved = useResolvedTheme()

  useLayoutEffect(() => {
    applyTheme(resolved)
  }, [resolved])

  return <>{children}</>
}

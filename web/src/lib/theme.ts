/**
 * 主题：亮 / 暗 / 自动三档（规格 §6.2）。
 *
 * 三档语义与落地方式：
 * - `auto` = 跟随系统 `prefers-color-scheme`，系统变化时实时跟随（Provider 订阅）；
 * - 选择存 localStorage（键见 THEME_STORAGE_KEY），登录后由设置页写回账号偏好；
 * - 生效方式是 `<html>` 的 `.dark` class + `color-scheme`（shadcn 令牌在 index.css
 *   里按 `.dark` 切整套 CSS 变量），不允许逐组件写两套样式；
 * - 首屏防闪烁由 web/index.html 的内联脚本先跑一遍同一套解析（键与这里一致，
 *   测试会断言两处同步）。
 */
export type Theme = "auto" | "light" | "dark"

export type ResolvedTheme = "light" | "dark"

/** zustand persist 的存储键；web/index.html 的内联脚本也读这个键。 */
export const THEME_STORAGE_KEY = "app-theme"

/** 三档的可选值与其文案 key：文案在 locales 的 `common.theme.*`。 */
export const THEME_OPTIONS: { value: Theme; labelKey: string }[] = [
  { value: "auto", labelKey: "common.theme.auto" },
  { value: "light", labelKey: "common.theme.light" },
  { value: "dark", labelKey: "common.theme.dark" }
]

export function isTheme(value: unknown): value is Theme {
  return value === "auto" || value === "light" || value === "dark"
}

/**
 * 账号侧的主题取值（users.theme，默认 `system`）：
 * 界面上的「自动」在库里是 `system`，读写各做一次映射，别把两种词混进 store。
 */
export type AccountTheme = "system" | "light" | "dark"

export function themeFromAccount(value: unknown): Theme | null {
  if (value === "system" || value === "auto") return "auto"
  if (value === "light" || value === "dark") return value
  return null
}

export function themeToAccount(theme: Theme): AccountTheme {
  return theme === "auto" ? "system" : theme
}

/** 当前系统外观（无 matchMedia 的环境按浅色处理）。 */
export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

export function resolveTheme(
  theme: Theme,
  systemDark = systemPrefersDark()
): ResolvedTheme {
  if (theme === "auto") return systemDark ? "dark" : "light"
  return theme
}

/**
 * 把生效深浅色落到 `<html>`。内联脚本做同样三件事：class / color-scheme /
 * theme-color，少一件都会让原生控件或浏览器 UI 停在旧档。
 */
export function applyTheme(resolved: ResolvedTheme): ResolvedTheme {
  if (typeof document === "undefined") return resolved
  const dark = resolved === "dark"
  const root = document.documentElement
  root.classList.toggle("dark", dark)
  root.style.colorScheme = resolved
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute("content", dark ? "#0a0a0a" : "#ffffff")
  return resolved
}

/**
 * 读 zustand persist 写下的值。persist 存的是 `{state:{theme},"version":0}`，
 * 也兼容裸字符串（旧版本/人手改过）。非法值当作没存过。
 */
export function readStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (!raw) return null
    let candidate: unknown = raw
    try {
      const parsed = JSON.parse(raw) as { state?: { theme?: unknown } }
      candidate = parsed?.state?.theme ?? raw
    } catch {
      candidate = raw
    }
    return isTheme(candidate) ? candidate : null
  } catch {
    return null
  }
}

/** 订阅系统明暗变化；返回取消订阅函数。 */
export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {}
  const query = window.matchMedia("(prefers-color-scheme: dark)")
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

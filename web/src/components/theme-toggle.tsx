import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import type { Theme } from "@/lib/theme"
import { useThemeStore } from "@/stores/theme"

const THEME_ICONS = {
  auto: MonitorIcon,
  light: SunIcon,
  dark: MoonIcon
} as const

/** 顶栏与未登录页的主题循环按钮：自动 → 亮 → 暗 → 自动，只改本机偏好。 */
export function ThemeCycleButton() {
  const { t } = useTranslation()
  const theme = useThemeStore((state) => state.theme)
  const setTheme = useThemeStore((state) => state.setTheme)
  const next: Theme =
    theme === "auto" ? "light" : theme === "light" ? "dark" : "auto"
  const Icon = THEME_ICONS[theme]
  const label = t("common.theme.switch", {
    theme: t(`common.theme.${theme}`)
  })

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title={label}
      aria-label={label}
      onClick={() => setTheme(next)}
    >
      <Icon aria-hidden="true" />
    </Button>
  )
}

/**
 * 登录后的账号偏好与本机偏好对齐（规格 §6.2、§6.5）。
 *
 * 语言：账号值优先（规格明定），只读覆盖本机。
 * 主题：账号有明确选择（light/dark）时覆盖本机；账号仍是默认 `system` 时：
 *   - 显式登录/注册（pushLocal）→ 把本机选择写回账号，完成「登录后同步」；
 *   - 会话恢复（pushLocal=false）→ 保留本机选择，不重复写库。
 */
import { applyAccountLanguage } from "@/i18n"
import { meApi } from "@/lib/api"
import type { Me } from "@/lib/api-types"
import { themeFromAccount, themeToAccount } from "@/lib/theme"
import { useThemeStore } from "@/stores/theme"

export async function applyAccountPreferences(
  user: Me,
  options: { pushLocal?: boolean } = {}
): Promise<void> {
  await applyAccountLanguage(user.language)

  const accountTheme = themeFromAccount(user.theme)
  if (!accountTheme) return

  const current = useThemeStore.getState()
  if (accountTheme !== "auto") {
    current.setTheme(accountTheme)
    return
  }

  if (options.pushLocal && current.theme !== "auto") {
    const local = current.theme
    useThemeStore.getState().setTheme(local)
    try {
      await meApi.update({ theme: themeToAccount(local) })
    } catch {
      // 写回失败不影响本次会话的主题选择
    }
  }
}

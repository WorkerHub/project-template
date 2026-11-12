import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { LanguageSegmented } from "@/components/language-toggle"
import { ThemeSegmented } from "@/components/theme-toggle"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { meApi } from "@/lib/api"
import { describeApiError } from "@/lib/api-errors"
import { themeToAccount } from "@/lib/theme"
import { useAuthStore } from "@/stores/auth"

function supportedTimeZones(): string[] {
  const intl = Intl as unknown as {
    supportedValuesOf?: (key: string) => string[]
  }
  try {
    return intl.supportedValuesOf ? intl.supportedValuesOf("timeZone") : []
  } catch {
    return []
  }
}

/**
 * 设置 · 偏好：语言、主题、时区。
 *
 * 三项都立即生效并写回账号（`PUT /api/me`）；语言切换的即时性由 i18next 负责，
 * 这里只补落库。主题在库里用 system/light/dark，界面上的「自动」= system。
 */
export function PreferencesSection() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.user)
  const setUser = useAuthStore((state) => state.setUser)
  const [error, setError] = useState("")

  const zones = useMemo(() => {
    const list = supportedTimeZones()
    if (!user?.timezone) return list
    return list.includes(user.timezone) ? list : [user.timezone, ...list]
  }, [user?.timezone])

  const persist = async (
    input: Parameters<typeof meApi.update>[0]
  ): Promise<void> => {
    setError("")
    try {
      const updated = await meApi.update(input)
      setUser(updated)
      toast.success(t("settings.preferences.saved"))
    } catch (saveError) {
      setError(describeApiError(t, saveError))
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Label>{t("settings.preferences.language")}</Label>
        <LanguageSegmented
          onChange={(language) => void persist({ language })}
        />
        <p className="text-xs text-muted-foreground">
          {t("settings.preferences.languageHint")}
        </p>
      </div>

      <div className="space-y-2">
        <Label>{t("settings.preferences.theme")}</Label>
        <ThemeSegmented
          onChange={(theme) => void persist({ theme: themeToAccount(theme) })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="preferences-timezone">
          {t("settings.preferences.timezone")}
        </Label>
        <Select
          value={user?.timezone ?? ""}
          onValueChange={(timezone) => void persist({ timezone })}
        >
          <SelectTrigger id="preferences-timezone" className="w-full sm:w-80">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {zones.map((zone) => (
              <SelectItem key={zone} value={zone}>
                {zone}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

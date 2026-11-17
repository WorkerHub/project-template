import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { LanguageSegmented } from "@/components/language-toggle"
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
import { useAuthStore } from "@/stores/auth"

/**
 * 常用时区（IANA 标识，按 UTC 偏移自西向东排序）。
 *
 * 替代原先 `Intl.supportedValuesOf("timeZone")` 拉取的全部时区（约 400 项）；
 * 用户已保存的时区若不在本列表内，仍会由 useMemo 自动补到最前。
 */
const COMMON_TIME_ZONES: string[] = [
  "Pacific/Honolulu",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/Mexico_City",
  "America/New_York",
  "America/Toronto",
  "America/Santiago",
  "America/Sao_Paulo",
  "America/Buenos_Aires",
  "UTC",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Africa/Lagos",
  "Africa/Cairo",
  "Europe/Athens",
  "Africa/Johannesburg",
  "Europe/Istanbul",
  "Europe/Moscow",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Jakarta",
  "Asia/Singapore",
  "Asia/Kuala_Lumpur",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Taipei",
  "Asia/Manila",
  "Australia/Perth",
  "Asia/Seoul",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland"
]

/**
 * 设置 · 偏好：语言与时区。
 *
 * 语言与时区立即生效并写回账号（`PUT /api/me`）。
 */
export function PreferencesSection() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.user)
  const setUser = useAuthStore((state) => state.setUser)
  const [error, setError] = useState("")

  const zones = useMemo(() => {
    if (!user?.timezone) return COMMON_TIME_ZONES
    return COMMON_TIME_ZONES.includes(user.timezone)
      ? COMMON_TIME_ZONES
      : [user.timezone, ...COMMON_TIME_ZONES]
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

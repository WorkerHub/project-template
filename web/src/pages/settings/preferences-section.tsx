import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { applyAccountLanguage } from "@/i18n"
import { meApi } from "@/lib/api"
import { describeApiError } from "@/lib/api-errors"
import {
  DEFAULT_LANGUAGE,
  isLanguage,
  type Language,
  SUPPORTED_LANGUAGES
} from "@/lib/language"
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
 * 设置 · 偏好：语言与时区（先选后存）。
 *
 * 语言与时区本地选择后统一通过「保存」写回账号（`PUT /api/me`）。
 */
export function PreferencesSection() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.user)
  const setUser = useAuthStore((state) => state.setUser)

  const userLanguage: Language = isLanguage(user?.language)
    ? user.language
    : DEFAULT_LANGUAGE
  const userTimezone = user?.timezone ?? ""

  const [language, setLanguage] = useState<Language>(userLanguage)
  const [timezone, setTimezone] = useState<string>(userTimezone)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (user?.language && isLanguage(user.language)) {
      setLanguage(user.language)
    }
    if (user?.timezone !== undefined) {
      setTimezone(user.timezone)
    }
  }, [user?.language, user?.timezone])

  const zones = useMemo(() => {
    const customZone = timezone || user?.timezone
    if (!customZone || COMMON_TIME_ZONES.includes(customZone)) {
      return COMMON_TIME_ZONES
    }
    return [customZone, ...COMMON_TIME_ZONES]
  }, [timezone, user?.timezone])

  const dirty = language !== userLanguage || timezone !== userTimezone

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!dirty || busy) return

    setBusy(true)
    setError("")
    try {
      const updated = await meApi.update({ language, timezone })
      setUser(updated)
      if (updated.language) {
        await applyAccountLanguage(updated.language)
      }
      toast.success(t("settings.preferences.saved"))
    } catch (saveError) {
      setError(describeApiError(t, saveError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="space-y-8" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <Label htmlFor="preferences-language">
          {t("settings.preferences.language")}
        </Label>
        <Select
          value={language}
          onValueChange={(value) => {
            if (isLanguage(value)) setLanguage(value)
          }}
        >
          <SelectTrigger id="preferences-language" className="w-full sm:w-80">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUPPORTED_LANGUAGES.map((lang) => (
              <SelectItem key={lang} value={lang}>
                {t(`common.languages.${lang}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="preferences-timezone">
          {t("settings.preferences.timezone")}
        </Label>
        <Select value={timezone} onValueChange={setTimezone}>
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

      <div>
        <Button type="submit" disabled={!dirty || busy}>
          {busy ? t("common.actions.saving") : t("common.actions.save")}
        </Button>
      </div>
    </form>
  )
}

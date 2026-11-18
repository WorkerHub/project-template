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
import { UnsavedChangesGuard } from "@/components/unsaved-changes-guard"
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
 * 设置 · 偏好：语言与时区。
 *
 * 语言与时区均为先选后存，统一通过「保存」按钮提交（`PUT /api/me`）。
 */
export function PreferencesSection() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.user)
  const setUser = useAuthStore((state) => state.setUser)

  const userLanguage = user?.language
  const userTimezone = user?.timezone

  const accountLanguage = isLanguage(userLanguage)
    ? userLanguage
    : DEFAULT_LANGUAGE
  const accountTimezone = userTimezone ?? ""

  const [language, setLanguage] = useState<Language>(accountLanguage)
  const [timezone, setTimezone] = useState<string>(accountTimezone)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    setLanguage(isLanguage(userLanguage) ? userLanguage : DEFAULT_LANGUAGE)
    setTimezone(userTimezone ?? "")
  }, [userLanguage, userTimezone])

  const zones = useMemo(() => {
    const customZone = timezone || userTimezone
    if (!customZone) return COMMON_TIME_ZONES
    return COMMON_TIME_ZONES.includes(customZone)
      ? COMMON_TIME_ZONES
      : [customZone, ...COMMON_TIME_ZONES]
  }, [timezone, userTimezone])

  const isDirty = language !== accountLanguage || timezone !== accountTimezone

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!isDirty || saving) return

    setSaving(true)
    setError("")
    try {
      const updated = await meApi.update({ language, timezone })
      setUser(updated)
      if (isLanguage(updated.language)) {
        await applyAccountLanguage(updated.language)
      }
      toast.success(t("settings.preferences.saved"))
    } catch (saveError) {
      setError(describeApiError(t, saveError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <UnsavedChangesGuard isDirty={isDirty} />
      <div className="space-y-2">
        <Label htmlFor="preferences-language">
          {t("settings.preferences.language")}
        </Label>
        <Select
          value={language}
          onValueChange={(val) => {
            if (isLanguage(val)) setLanguage(val)
          }}
        >
          <SelectTrigger id="preferences-language" className="w-full sm:w-80">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUPPORTED_LANGUAGES.map((item) => (
              <SelectItem key={item} value={item}>
                {t(`common.languages.${item}`)}
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
        <Button type="submit" disabled={!isDirty || saving}>
          {saving ? t("common.actions.saving") : t("common.actions.save")}
        </Button>
      </div>
    </form>
  )
}

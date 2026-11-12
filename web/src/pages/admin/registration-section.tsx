import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Switch } from "@/components/ui/switch"
import { adminApi } from "@/lib/api"
import { describeApiError } from "@/lib/api-errors"
import type { AdminSettings, RegistrationSettings } from "@/lib/api-types"

/**
 * 系统管理 · 注册与审核（规格 §5.6、§6.1）。
 *
 * 「注册需邮箱验证」在邮件未配置时不可开启（前端置灰，后端同样拒绝）；
 * 若开关早已打开而邮件被清空，这里明确提示「暂不生效」，不把新用户锁死。
 */
export function RegistrationSection({
  settings,
  onSaved
}: {
  settings: AdminSettings
  onSaved: (settings: AdminSettings) => void
}) {
  const { t } = useTranslation()
  const registration = settings.registration
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  if (!registration) return null

  const emailConfigured = settings.email.configured

  const update = async (patch: Partial<RegistrationSettings>) => {
    setBusy(true)
    setError("")
    try {
      const updated = await adminApi.updateSettings({
        registration: { ...registration, ...patch }
      })
      onSaved(updated)
    } catch (saveError) {
      setError(describeApiError(t, saveError))
      toast.error(describeApiError(t, saveError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-4 rounded-xl border bg-card p-4">
      <h3 className="font-heading text-sm font-semibold">
        {t("admin.registration.title")}
      </h3>

      <div className="space-y-3">
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>{t("admin.registration.enabled")}</span>
          <Switch
            checked={registration.enabled}
            disabled={busy}
            onCheckedChange={(checked) => void update({ enabled: checked })}
          />
        </label>

        <label className="flex items-center justify-between gap-4 text-sm">
          <span>{t("admin.registration.approvalRequired")}</span>
          <Switch
            checked={registration.approvalRequired}
            disabled={busy}
            onCheckedChange={(checked) =>
              void update({ approvalRequired: checked })
            }
          />
        </label>

        <label className="flex items-center justify-between gap-4 text-sm">
          <span>{t("admin.registration.emailVerification")}</span>
          <Switch
            checked={registration.emailVerification}
            disabled={busy || !emailConfigured}
            onCheckedChange={(checked) =>
              void update({ emailVerification: checked })
            }
          />
        </label>

        {!emailConfigured ? (
          <p className="text-xs text-muted-foreground">
            {registration.emailVerification
              ? t("admin.registration.emailVerificationInactive")
              : t("admin.registration.emailVerificationBlocked")}
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  )
}

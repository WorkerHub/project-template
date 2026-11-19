import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useOutletContext } from "react-router"
import { Switch } from "@/components/ui/switch"
import { adminApi } from "@/lib/api"
import { describeApiError } from "@/lib/api-errors"
import type { AdminSettings } from "@/lib/api-types"

/**
 * 系统管理 · 数据库维护（规格 §5.3.5、§6.1）。
 *
 * 「开放初始化页面」只门控页面，不门控密钥接口。
 */
export function MaintenanceSection(props?: {
  settings?: AdminSettings
  onSaved?: (settings: AdminSettings) => void
}) {
  const { t } = useTranslation()
  const outlet = useOutletContext<{
    settings: AdminSettings
    onSaved: (settings: AdminSettings) => void
  } | null>()
  const settings = props?.settings ?? outlet?.settings
  const onSaved = props?.onSaved ?? outlet?.onSaved ?? (() => {})

  const [error, setError] = useState("")

  if (!settings) return null

  const toggleSetupPage = async (enabled: boolean) => {
    setError("")
    try {
      const updated = await adminApi.updateSettings({
        setupPageEnabled: enabled
      })
      onSaved(updated)
    } catch (saveError) {
      setError(describeApiError(t, saveError))
    }
  }

  return (
    <section className="space-y-4 rounded-xl border bg-card p-4">
      <h3 className="font-heading text-sm font-semibold">
        {t("admin.maintenance.title")}
      </h3>

      <label className="flex items-center justify-between gap-4 text-sm">
        <span className="space-y-0.5">
          <span className="block">{t("admin.maintenance.setupPage")}</span>
          <span className="block text-xs text-muted-foreground">
            {t("admin.maintenance.setupPageHint")}
          </span>
        </span>
        <Switch
          checked={settings.setupPageEnabled}
          onCheckedChange={(checked) => void toggleSetupPage(checked)}
        />
      </label>

      <dl className="grid gap-2 text-sm sm:grid-cols-[8rem_1fr]">
        <dt className="text-muted-foreground">
          {t("admin.maintenance.tablePrefix")}
        </dt>
        <dd className="font-mono text-xs">
          {settings.tablePrefix || t("setup.noPrefix")}
        </dd>
      </dl>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  )
}

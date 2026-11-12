import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { adminApi } from "@/lib/api"
import { describeApiError } from "@/lib/api-errors"
import type { AdminSettings, SetupResult } from "@/lib/api-types"

/**
 * 系统管理 · 数据库维护（规格 §5.3.5、§6.1）。
 *
 * 与初始化页调同一个迁移 runner，回显形状一致；管理员会话即凭证，不再要密钥。
 * 「开放初始化页面」只门控页面，不门控密钥接口。
 */
export function MaintenanceSection({
  settings,
  onSaved
}: {
  settings: AdminSettings
  onSaved: (settings: AdminSettings) => void
}) {
  const { t } = useTranslation()
  const [result, setResult] = useState<SetupResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const run = async () => {
    setBusy(true)
    setError("")
    try {
      const outcome = await adminApi.runSetup()
      setResult(outcome)
    } catch (runError) {
      setError(describeApiError(t, runError))
    } finally {
      setBusy(false)
    }
  }

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

      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={() => void run()}
      >
        {busy ? t("admin.maintenance.running") : t("admin.maintenance.run")}
      </Button>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="space-y-2 rounded-lg bg-muted/50 p-3 text-sm">
          <p className="font-medium">{t("admin.maintenance.done")}</p>
          <p className="text-xs text-muted-foreground">
            {t("admin.maintenance.tablePrefix")}
          </p>
          <p className="font-mono text-xs">
            {result.tablePrefix || t("setup.noPrefix")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("admin.maintenance.migrations")}
          </p>
          <ul className="space-y-1 text-xs">
            {result.migrations.map((migration) => (
              <li key={migration.name} className="flex justify-between gap-3">
                <span className="font-mono">{migration.name}</span>
                <span className="text-muted-foreground">
                  {migration.status === "applied"
                    ? t("admin.maintenance.applied")
                    : t("admin.maintenance.skipped")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

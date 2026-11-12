import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { adminApi } from "@/lib/api"
import { describeApiError } from "@/lib/api-errors"
import type { AdminSettings } from "@/lib/api-types"
import { EmailSection } from "@/pages/admin/email-section"
import { MaintenanceSection } from "@/pages/admin/maintenance-section"
import { RegistrationSection } from "@/pages/admin/registration-section"
import { UsersSection } from "@/pages/admin/users-section"

/**
 * 系统管理页（规格 §6.1，仅管理员）：邮件配置、注册/审核、待批准用户、
 * setup 页开关与数据库维护。菜单隐藏只是体验，接口层 403 才是边界。
 */
export function AdminPage() {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<AdminSettings | null>(null)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setError("")
    try {
      setSettings(await adminApi.settings())
    } catch (loadError) {
      setError(describeApiError(t, loadError))
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {!settings && !error ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : null}

      {settings ? (
        <>
          <EmailSection settings={settings} onSaved={setSettings} />
          <RegistrationSection settings={settings} onSaved={setSettings} />
          <UsersSection />
          <MaintenanceSection settings={settings} onSaved={setSettings} />
        </>
      ) : null}
    </div>
  )
}

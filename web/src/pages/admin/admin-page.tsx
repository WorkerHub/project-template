import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { adminApi } from "@/lib/api"
import { describeApiError } from "@/lib/api-errors"
import type { AdminSettings } from "@/lib/api-types"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CreateUserSection } from "@/pages/admin/create-user-section"
import { EmailSection } from "@/pages/admin/email-section"
import { MaintenanceSection } from "@/pages/admin/maintenance-section"
import { RegistrationSection } from "@/pages/admin/registration-section"
import { UsersSection } from "@/pages/admin/users-section"

/**
 * 系统管理页（规格 §6.1，仅管理员）：邮件配置、注册/审核、用户列表、
 * setup 页开关与数据库维护。菜单隐藏只是体验，接口层 403 才是边界。
 */
export function AdminPage() {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<AdminSettings | null>(null)
  const [error, setError] = useState("")
  const [tab, setTab] = useState("email")

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
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="email">{t("admin.tabs.email")}</TabsTrigger>
            <TabsTrigger value="registration">
              {t("admin.tabs.registration")}
            </TabsTrigger>
            <TabsTrigger value="users">{t("admin.tabs.users")}</TabsTrigger>
            <TabsTrigger value="maintenance">
              {t("admin.tabs.maintenance")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="email" className="pt-4">
            <EmailSection settings={settings} onSaved={setSettings} />
          </TabsContent>
          <TabsContent value="registration" className="pt-4">
            <RegistrationSection settings={settings} onSaved={setSettings} />
          </TabsContent>
          <TabsContent value="users" className="pt-4">
            <div className="space-y-4">
              <CreateUserSection />
              <UsersSection />
            </div>
          </TabsContent>
          <TabsContent value="maintenance" className="pt-4">
            <MaintenanceSection settings={settings} onSaved={setSettings} />
          </TabsContent>
        </Tabs>
      ) : null}
    </div>
  )
}

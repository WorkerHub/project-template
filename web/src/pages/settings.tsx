import { useTranslation } from "react-i18next"
import { NavLink, Outlet, useLocation } from "react-router"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

/**
 * 设置页（技术方案 §5A.3）：安全与偏好两项；个人资料是独立页 `/profile`。
 * 现已重构为路径段独立子路由，不使用 query 参数或页内状态切换。
 */
export function SettingsPage() {
  const { t } = useTranslation()
  const location = useLocation()

  const segments = location.pathname.split("/").filter(Boolean)
  const currentTab = segments[1] || "security"

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Tabs value={currentTab}>
        <TabsList>
          <TabsTrigger value="security" asChild>
            <NavLink to="/settings/security">
              {t("settings.tabs.security")}
            </NavLink>
          </TabsTrigger>
          <TabsTrigger value="preferences" asChild>
            <NavLink to="/settings/preferences">
              {t("settings.tabs.preferences")}
            </NavLink>
          </TabsTrigger>
        </TabsList>

        <div className="pt-4">
          <Outlet />
        </div>
      </Tabs>
    </div>
  )
}

import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { AuthShell } from "@/components/auth-shell"
import { Button } from "@/components/ui/button"
import { useSiteStore } from "@/stores/site"

/**
 * 公开首页（规格 §6.1）：项目名 + 一句话说明 + 登录入口。
 *
 * 名字与说明来自 `GET /api/public`（身份单点），页脚版本号由 AuthShell 给。
 */
export function HomePage() {
  const { t } = useTranslation()
  const info = useSiteStore((state) => state.info)
  const canRegister =
    info?.appMode === "multi" && info.registrationEnabled !== false

  return (
    <AuthShell title={info?.tagline || (info?.name ?? "")}>
      <div className="flex flex-col gap-2">
        <Button asChild>
          <Link to="/login">{t("home.login")}</Link>
        </Button>
        {canRegister ? (
          <Button asChild variant="outline">
            <Link to="/register">{t("home.register")}</Link>
          </Button>
        ) : null}
      </div>
    </AuthShell>
  )
}

import { useTranslation } from "react-i18next"
import { Navigate, useLocation, useNavigate } from "react-router"
import { AuthShell } from "@/components/auth-shell"
import { PasswordChangeForm } from "@/components/password-change-form"
import { Button } from "@/components/ui/button"
import { useAuthStore } from "@/stores/auth"

/**
 * 首登强制改密页：管理员建号的一次性密码登录后整屏引导改密。
 *
 * 页面守卫 `RequirePasswordChanged` 负责把带标记的访问送到这里；本页只做
 * 表单与出口。没有标记的账号直接访问本页时回工作台，避免留下无用入口。
 */
export function ChangePasswordPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)

  const from = (location.state as { from?: string } | null)?.from
  const target =
    from && from !== "/login" && from !== "/change-password"
      ? from
      : "/workbench"

  if (!user) return null
  if (!user.mustChangePassword) return <Navigate to={target} replace />

  const signOut = async () => {
    await logout()
    navigate("/login", { replace: true })
  }

  return (
    <AuthShell
      title={t("changePassword.title")}
      subtitle={t("changePassword.subtitle")}
    >
      <div className="space-y-3">
        <PasswordChangeForm
          idPrefix="change-password"
          onChanged={() => navigate(target, { replace: true })}
        />
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          onClick={() => void signOut()}
        >
          {t("workbench.logout")}
        </Button>
      </div>
    </AuthShell>
  )
}

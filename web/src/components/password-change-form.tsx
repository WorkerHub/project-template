import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { meApi } from "@/lib/api"
import { describeApiError } from "@/lib/api-errors"
import { useAuthStore } from "@/stores/auth"

/**
 * 改密表单：设置页与首登强制改密页共用。
 *
 * 成功后后端会清掉 `mustChangePassword`；这里同步清本地标记，免得登录后的
 * 页面守卫继续把用户送回改密页。`onChanged` 只给需要跳转的调用方用。
 */
export function PasswordChangeForm({
  idPrefix,
  onChanged
}: {
  idPrefix: string
  onChanged?: () => void
}) {
  const { t } = useTranslation()
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (newPassword.length < 8) {
      setError(t("auth.validation.passwordTooShort"))
      return
    }
    if (newPassword !== confirmPassword) {
      setError(t("auth.validation.passwordMismatch"))
      return
    }
    setBusy(true)
    setError("")
    try {
      await meApi.changePassword({ currentPassword, newPassword })
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      const user = useAuthStore.getState().user
      if (user?.mustChangePassword) {
        useAuthStore.getState().setUser({ ...user, mustChangePassword: false })
      }
      toast.success(t("settings.security.passwordChanged"))
      onChanged?.()
    } catch (changeError) {
      setError(describeApiError(t, changeError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-current-password`}>
          {t("common.currentPassword")}
        </Label>
        <Input
          id={`${idPrefix}-current-password`}
          name="current-password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-new-password`}>
          {t("common.newPassword")}
        </Label>
        <Input
          id={`${idPrefix}-new-password`}
          name="new-password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-confirm-password`}>
          {t("common.confirmPassword")}
        </Label>
        <Input
          id={`${idPrefix}-confirm-password`}
          name="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={busy}>
        {busy
          ? t("common.actions.saving")
          : t("settings.security.passwordSubmit")}
      </Button>
    </form>
  )
}

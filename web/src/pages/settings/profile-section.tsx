import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { meApi } from "@/lib/api"
import { describeApiError } from "@/lib/api-errors"
import { useState } from "react"
import { useAuthStore } from "@/stores/auth"

/** 设置 · 个人资料：昵称可改，邮箱与角色只读（改邮箱不在模板范围）。 */
export function ProfileSection() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.user)
  const setUser = useAuthStore((state) => state.setUser)
  const [displayName, setDisplayName] = useState(user?.displayName ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  if (!user) return null

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      const updated = await meApi.update({ displayName: displayName.trim() })
      setUser(updated)
      toast.success(t("settings.profile.saved"))
    } catch (saveError) {
      setError(describeApiError(t, saveError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <form className="space-y-4" onSubmit={save}>
        <div className="space-y-1.5">
          <Label htmlFor="profile-display-name">
            {t("settings.profile.displayName")}
          </Label>
          <Input
            id="profile-display-name"
            name="display-name"
            autoComplete="name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={busy}>
          {busy ? t("common.actions.saving") : t("common.actions.save")}
        </Button>
      </form>

      <dl className="grid gap-3 text-sm sm:grid-cols-[8rem_1fr]">
        <dt className="text-muted-foreground">{t("settings.profile.email")}</dt>
        <dd className="flex items-center gap-2">
          <span className="break-all">{user.email}</span>
          <Badge variant={user.emailVerified ? "secondary" : "outline"}>
            {user.emailVerified
              ? t("settings.profile.emailVerified")
              : t("settings.profile.emailUnverified")}
          </Badge>
        </dd>

        <dt className="text-muted-foreground">{t("settings.profile.role")}</dt>
        <dd>{t(`common.role.${user.role}`)}</dd>
      </dl>
    </div>
  )
}

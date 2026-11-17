import { CopyIcon } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Field } from "@/components/form-field"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { adminApi } from "@/lib/api"
import { describeApiError } from "@/lib/api-errors"
import type {
  AdminCreateUserInput,
  AdminCreateUserResult,
  UserRole
} from "@/lib/api-types"

/**
 * 系统管理 · 新建用户（规格 §6.1；契约见 `lib/api-types` 的 `AdminCreateUserInput`）。
 *
 * 初始密码由后端生成、只在创建响应里返回一次：这里只把它放进组件 state 展示，
 * 关闭结果块、切换二级菜单或刷新页面即丢——不写本地存储、不进提示语与 URL。
 * 角色是二选一，用分段按钮（与设置页语言/主题同款）而不是下拉。
 */
export function CreateUserSection() {
  const { t } = useTranslation()
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<UserRole>("user")
  const [displayName, setDisplayName] = useState("")
  const [emailError, setEmailError] = useState("")
  const [error, setError] = useState("")
  const [result, setResult] = useState<AdminCreateUserResult | null>(null)
  const [busy, setBusy] = useState(false)

  const resetForm = () => {
    setEmail("")
    setRole("user")
    setDisplayName("")
    setEmailError("")
    setError("")
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setEmailError(t("admin.users.create.emailRequired"))
      return
    }

    const input: AdminCreateUserInput = { email: trimmedEmail, role }
    const name = displayName.trim()
    if (name) input.displayName = name

    setBusy(true)
    setError("")
    try {
      setResult(await adminApi.createUser(input))
      resetForm()
    } catch (createError) {
      setError(describeApiError(t, createError))
    } finally {
      setBusy(false)
    }
  }

  const copyPassword = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.temporaryPassword)
      toast.success(t("admin.users.create.copied"))
    } catch {
      toast.error(t("admin.users.create.copyFailed"))
    }
  }

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h3 className="font-heading text-sm font-semibold">
        {t("admin.users.create.title")}
      </h3>

      {result ? (
        <div
          role="status"
          className="space-y-3 rounded-lg bg-muted/50 p-3 text-sm"
        >
          <p className="font-medium">{t("admin.users.create.createdTitle")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-all">{result.email}</span>
            <Badge variant="secondary">{t(`common.role.${result.role}`)}</Badge>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              {t("admin.users.create.password")}
            </p>
            <p className="font-mono break-all select-all">
              {result.temporaryPassword}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void copyPassword()}
            >
              <CopyIcon aria-hidden="true" />
              {t("admin.users.create.copy")}
            </Button>
            <Button type="button" size="sm" onClick={() => setResult(null)}>
              {t("common.actions.close")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("admin.users.create.passwordOnce")}
          </p>
        </div>
      ) : (
        <form className="space-y-3" onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              id="create-user-email"
              label={t("admin.users.create.email")}
              error={emailError || undefined}
            >
              <Input
                id="create-user-email"
                type="email"
                value={email}
                aria-invalid={emailError ? true : undefined}
                aria-describedby={
                  emailError ? "create-user-email-error" : undefined
                }
                onChange={(event) => {
                  setEmail(event.target.value)
                  setEmailError("")
                }}
              />
            </Field>

            <div className="space-y-1.5">
              <Label>{t("admin.users.create.role")}</Label>
              <ToggleGroup
                type="single"
                value={role}
                aria-label={t("admin.users.create.role")}
                onValueChange={(value) => {
                  // Radix 再点当前项会回传空串：忽略它，角色恒有值。
                  if (value === "admin" || value === "user") setRole(value)
                }}
              >
                <ToggleGroupItem value="admin" size="sm">
                  {t("common.role.admin")}
                </ToggleGroupItem>
                <ToggleGroupItem value="user" size="sm">
                  {t("common.role.user")}
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <Field
              id="create-user-display-name"
              label={t("admin.users.create.displayName")}
            >
              <Input
                id="create-user-display-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </Field>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button type="submit" size="sm" disabled={busy}>
            {busy
              ? t("admin.users.create.creating")
              : t("admin.users.create.submit")}
          </Button>
        </form>
      )}
    </section>
  )
}

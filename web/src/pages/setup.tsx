import { DatabaseIcon, Loader2Icon } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useNavigate } from "react-router"
import { AuthShell } from "@/components/auth-shell"
import { Field } from "@/components/form-field"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { currentLanguage } from "@/i18n"
import { ApiError, setupApi } from "@/lib/api"
import { describeApiError } from "@/lib/api-errors"
import type { SetupResult } from "@/lib/api-types"
import { useSetupStore } from "@/stores/setup"
import { useSiteStore } from "@/stores/site"

/**
 * 初始化页（规格 §5.3、§5.3.7；技术方案 §5A.6）。
 *
 * 三种形态：
 * - 还没有 owner（未初始化）：初始化形态（防自锁——页面开关关着也放行）；
 * - 已初始化且页面开启：升级形态，只跑幂等迁移；
 * - 已初始化且页面关闭：只显示提示，DOM 里没有密钥表单。
 *
 * 密钥只走 `X-Setup-Secret` 请求头，输入框 id/name 固定 `setup-secret`、
 * autocomplete 关闭、提交后立即清空；两种形态用不同 `key` 强制换 DOM 节点。
 */
export function SetupPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const state = useSetupStore((store) => store.state)
  const applyState = useSetupStore((store) => store.apply)
  const loadState = useSetupStore((store) => store.load)
  const info = useSiteStore((store) => store.info)
  const singleMode = info?.appMode === "single"

  const [secret, setSecret] = useState("")
  /** 初始化成功后建所有者还要用一次密钥：只留在内存，不回填输入框。 */
  const [pendingSecret, setPendingSecret] = useState("")
  const [ownerEmail, setOwnerEmail] = useState("")
  const [ownerPassword, setOwnerPassword] = useState("")
  const [ownerName, setOwnerName] = useState("")
  const [result, setResult] = useState<SetupResult | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  if (!state) {
    return (
      <AuthShell title={t("setup.title")}>
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
          {t("setup.checking")}
        </p>
      </AuthShell>
    )
  }

  const initialized = state.ownerExists
  const closed = initialized && !state.enabled
  const ownerNeeded = singleMode && result !== null && !state.ownerExists

  const submitSecret = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!secret.trim()) {
      setError(t("errors.setupSecret"))
      return
    }

    setBusy(true)
    setError("")
    const value = secret
    try {
      const outcome = await setupApi.run(value)
      setResult(outcome)
      setPendingSecret(value)
      await loadState()
    } catch (runError) {
      if (runError instanceof ApiError && runError.status === 403) {
        setError(t("errors.setupSecret"))
      } else {
        setError(describeApiError(t, runError))
      }
    } finally {
      setSecret("")
      setBusy(false)
    }
  }

  const submitOwner = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!ownerEmail.trim()) {
      setError(t("auth.validation.emailRequired"))
      return
    }
    if (ownerPassword.length < 8) {
      setError(t("auth.validation.passwordTooShort"))
      return
    }

    setBusy(true)
    setError("")
    try {
      await setupApi.createOwner(pendingSecret, {
        email: ownerEmail.trim(),
        password: ownerPassword,
        displayName: ownerName.trim(),
        language: currentLanguage()
      })
      applyState({ ...state, ownerExists: true })
      navigate("/login", { replace: true })
    } catch (ownerError) {
      setError(describeApiError(t, ownerError))
    } finally {
      setBusy(false)
      setPendingSecret("")
      setOwnerPassword("")
    }
  }

  const resultBlock = result ? (
    <div className="space-y-2 rounded-lg bg-muted/50 p-3 text-sm">
      <p className="font-medium">{t("setup.doneTitle")}</p>
      <p className="text-xs text-muted-foreground">{t("setup.tablePrefix")}</p>
      <p className="font-mono">{result.tablePrefix || t("setup.noPrefix")}</p>
      <Separator />
      <p className="text-xs text-muted-foreground">{t("setup.migrations")}</p>
      <ul className="space-y-1 text-xs">
        {result.migrations.map((migration) => (
          <li key={migration.name} className="flex justify-between gap-3">
            <span className="font-mono">{migration.name}</span>
            <span className="text-muted-foreground">
              {migration.status === "applied"
                ? t("setup.applied")
                : t("setup.skipped")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  ) : null

  const message = (text: string) =>
    text ? (
      <p role="alert" className="text-sm text-destructive">
        {text}
      </p>
    ) : null

  return (
    <AuthShell
      title={
        <span className="inline-flex items-center gap-2">
          <DatabaseIcon
            className="size-5 text-muted-foreground"
            aria-hidden="true"
          />
          {t("setup.title")}
        </span>
      }
      subtitle={
        closed
          ? undefined
          : initialized
            ? t("setup.upgradeSubtitle")
            : t("setup.initSubtitle")
      }
    >
      <div className="space-y-4">
        {closed ? (
          <div className="space-y-3 text-center text-sm">
            <p className="font-medium">{t("setup.closedTitle")}</p>
            <p className="text-muted-foreground">{t("setup.closedBody")}</p>
            <Button asChild variant="outline" className="w-full">
              <Link to="/login">{t("auth.login.title")}</Link>
            </Button>
          </div>
        ) : null}

        {!closed && !result ? (
          <form
            key={initialized ? "setup-upgrade" : "setup-init"}
            id={initialized ? "setup-upgrade" : "setup-init"}
            className="space-y-4"
            onSubmit={submitSecret}
          >
            <Field id="setup-secret" label={t("setup.secret")}>
              <Input
                id="setup-secret"
                name="setup-secret"
                type="password"
                autoComplete="off"
                value={secret}
                aria-invalid={Boolean(error)}
                onChange={(event) => setSecret(event.target.value)}
              />
            </Field>

            {message(error)}

            <Button type="submit" className="w-full" disabled={busy}>
              {busy
                ? t("common.loading")
                : initialized
                  ? t("setup.submitUpgrade")
                  : t("setup.submitInit")}
            </Button>
          </form>
        ) : null}

        {resultBlock}

        {result && !singleMode ? (
          <Button asChild className="w-full">
            <Link to="/register">{t("setup.goRegister")}</Link>
          </Button>
        ) : null}

        {ownerNeeded ? (
          <form
            key="setup-owner"
            id="setup-owner"
            className="space-y-4"
            onSubmit={submitOwner}
          >
            <div className="space-y-1">
              <p className="font-medium">{t("setup.ownerTitle")}</p>
              <p className="text-sm text-muted-foreground">
                {t("setup.ownerSubtitle")}
              </p>
            </div>

            <Field id="owner-email" label={t("common.email")}>
              <Input
                id="owner-email"
                name="email"
                type="email"
                autoComplete="username"
                value={ownerEmail}
                onChange={(event) => setOwnerEmail(event.target.value)}
              />
            </Field>

            <Field id="owner-name" label={t("setup.displayName")}>
              <Input
                id="owner-name"
                name="display-name"
                type="text"
                autoComplete="name"
                value={ownerName}
                onChange={(event) => setOwnerName(event.target.value)}
              />
            </Field>

            <Field id="owner-password" label={t("common.password")}>
              <Input
                id="owner-password"
                name="new-password"
                type="password"
                autoComplete="new-password"
                value={ownerPassword}
                onChange={(event) => setOwnerPassword(event.target.value)}
              />
            </Field>

            {message(error)}

            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? t("common.loading") : t("setup.ownerSubmit")}
            </Button>
          </form>
        ) : null}
      </div>
    </AuthShell>
  )
}

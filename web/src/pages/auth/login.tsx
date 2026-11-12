import { useState } from "react"
import { Trans, useTranslation } from "react-i18next"
import { Link, useLocation, useNavigate } from "react-router"
import { AuthShell } from "@/components/auth-shell"
import { Field } from "@/components/form-field"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useCooldown } from "@/hooks/use-cooldown"
import { currentLanguage } from "@/i18n"
import { applyAccountPreferences } from "@/lib/account-prefs"
import { ApiError, authApi } from "@/lib/api"
import { describeApiError, retryAfterSeconds } from "@/lib/api-errors"
import type { Me, TwoFactorMethod } from "@/lib/api-types"
import {
  authenticationCredential,
  isWebAuthnCancelled,
  webauthnSupported
} from "@/lib/webauthn"
import { useAuthStore } from "@/stores/auth"
import { useSiteStore } from "@/stores/site"

type Step =
  | { kind: "password" }
  | { kind: "totp"; tempToken: string; methods: TwoFactorMethod[] }
  | { kind: "verify"; email: string }

/**
 * 登录页（技术方案 §5B、规格 §6.1）：密码步 → 验证码步。
 *
 * 两条硬要求：
 * - 换步必须换 DOM 节点：两步的 `<form>` 与关键 input 带不同 `key`，防止
 *   密码管理器把第一步密码框就地改写成验证码框（§5B 补注）；
 * - 密码框独占 `type="password"`；验证码框 `type="text"` + `one-time-code` +
 *   `inputmode="numeric"`，name/id 不含 password。
 */
export function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const info = useSiteStore((state) => state.info)
  const [step, setStep] = useState<Step>({ kind: "password" })
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const cooldown = useCooldown()

  const from = (location.state as { from?: string } | null)?.from
  const canRegister =
    info?.appMode === "multi" && info?.registrationEnabled === true
  const showForgot = info?.emailConfigured === true
  const passkeyAvailable = webauthnSupported()
  const methods = step.kind === "totp" ? step.methods : []
  const canUseTotp = methods.includes("totp")
  const canUsePasskey = passkeyAvailable && methods.includes("passkey")

  const finishLogin = async (user: Me) => {
    useAuthStore.getState().setUser(user)
    await applyAccountPreferences(user, { pushLocal: true })
    navigate(from && from !== "/login" ? from : "/workbench", { replace: true })
  }

  const backToPassword = (message: string) => {
    setStep({ kind: "password" })
    setCode("")
    setError(message)
  }

  const submitPassword = async (event: React.FormEvent) => {
    event.preventDefault()
    setNotice("")
    if (!email.trim()) {
      setError(t("auth.validation.emailRequired"))
      return
    }
    if (!password) {
      setError(t("auth.validation.passwordRequired"))
      return
    }

    setBusy(true)
    setError("")
    try {
      const result = await authApi.login({ email: email.trim(), password })
      if ("requires2fa" in result) {
        setStep({
          kind: "totp",
          tempToken: result.tempToken,
          methods: result.methods
        })
        setCode("")
        return
      }
      await finishLogin(result.user)
    } catch (loginError) {
      if (
        loginError instanceof ApiError &&
        loginError.code === "EMAIL_NOT_VERIFIED"
      ) {
        setStep({ kind: "verify", email: email.trim() })
        setCode("")
        cooldown.start(0)
        return
      }
      setError(describeApiError(t, loginError))
      const retry = retryAfterSeconds(loginError)
      if (retry) cooldown.start(retry)
    } finally {
      setBusy(false)
    }
  }

  const submitTotp = async (event: React.FormEvent) => {
    event.preventDefault()
    if (step.kind !== "totp") return
    if (!/^\d{6}$/.test(code)) {
      setError(t("auth.validation.codeInvalid"))
      return
    }

    setBusy(true)
    setError("")
    try {
      const result = await authApi.verifySecondFactor({
        tempToken: step.tempToken,
        method: "totp",
        code
      })
      await finishLogin(result.user)
    } catch (verifyError) {
      if (
        verifyError instanceof ApiError &&
        verifyError.code === "TEMP_TOKEN_EXPIRED"
      ) {
        backToPassword(describeApiError(t, verifyError))
      } else {
        setError(describeApiError(t, verifyError))
      }
    } finally {
      setBusy(false)
    }
  }

  const loginWithPasskey = async () => {
    if (step.kind !== "totp") return
    setBusy(true)
    setError("")
    try {
      const options = await authApi.passkeyLoginOptions(step.tempToken)
      const credential = await authenticationCredential(options)
      const result = await authApi.passkeyLoginVerify(
        step.tempToken,
        credential
      )
      await finishLogin(result.user)
    } catch (passkeyError) {
      if (isWebAuthnCancelled(passkeyError)) return
      if (
        passkeyError instanceof ApiError &&
        passkeyError.code === "TEMP_TOKEN_EXPIRED"
      ) {
        backToPassword(describeApiError(t, passkeyError))
        return
      }
      setError(
        passkeyError instanceof ApiError
          ? describeApiError(t, passkeyError)
          : t("auth.login.passkeyFailed")
      )
    } finally {
      setBusy(false)
    }
  }

  const submitVerify = async (event: React.FormEvent) => {
    event.preventDefault()
    if (step.kind !== "verify") return
    if (!/^\d{6}$/.test(code)) {
      setError(t("auth.validation.codeInvalid"))
      return
    }

    setBusy(true)
    setError("")
    try {
      await authApi.verifyEmail({ email: step.email, code })
      setStep({ kind: "password" })
      setCode("")
      setNotice(t("auth.register.verifiedTitle"))
    } catch (verifyError) {
      setError(describeApiError(t, verifyError))
    } finally {
      setBusy(false)
    }
  }

  const resendVerification = async () => {
    if (step.kind !== "verify") return
    setBusy(true)
    setError("")
    try {
      await authApi.resendEmail({
        email: step.email,
        language: currentLanguage()
      })
      cooldown.start(60)
      setNotice(t("common.codeSent"))
    } catch (sendError) {
      setError(describeApiError(t, sendError))
      const retry = retryAfterSeconds(sendError)
      if (retry) cooldown.start(retry)
    } finally {
      setBusy(false)
    }
  }

  const message = (text: string) =>
    text ? (
      <p role="alert" className="text-sm text-destructive">
        {text}
      </p>
    ) : null

  return (
    <AuthShell title={t("auth.login.title")}>
      {step.kind === "password" ? (
        <form
          key="password-step"
          id="password-step"
          className="space-y-4"
          onSubmit={submitPassword}
        >
          {notice ? (
            <p role="status" className="text-sm text-muted-foreground">
              {notice}
            </p>
          ) : null}

          <Field id="login-email" label={t("common.email")}>
            <Input
              id="login-email"
              name="email"
              type="email"
              autoComplete="username"
              value={email}
              aria-invalid={Boolean(error)}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>

          <Field id="login-password" label={t("common.password")}>
            <Input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              aria-invalid={Boolean(error)}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          {message(error)}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? t("common.loading") : t("auth.login.submit")}
          </Button>

          <div className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
            {showForgot ? (
              <Link
                to="/forgot-password"
                className="underline-offset-4 hover:underline"
              >
                {t("auth.login.forgot")}
              </Link>
            ) : null}
            {canRegister ? (
              <Trans
                i18nKey="auth.login.noAccount"
                components={{
                  signup: (
                    <Link
                      to="/register"
                      className="underline-offset-4 hover:underline"
                    />
                  )
                }}
              />
            ) : null}
          </div>
        </form>
      ) : null}

      {step.kind === "totp" ? (
        <form
          key="totp-step"
          id="totp-step"
          className="space-y-4"
          onSubmit={submitTotp}
        >
          {canUseTotp ? (
            <>
              <p className="text-sm text-muted-foreground">
                {t("auth.login.totpTitle")}
              </p>

              <Field id="totp-code" label={t("common.code")}>
                <Input
                  id="totp-code"
                  name="totp-code"
                  type="text"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  aria-invalid={Boolean(error)}
                  onChange={(event) =>
                    setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                />
              </Field>

              {message(error)}

              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? t("common.loading") : t("auth.login.totpSubmit")}
              </Button>
            </>
          ) : null}

          {!canUseTotp && !canUsePasskey ? (
            <p role="alert" className="text-sm text-destructive">
              {t("auth.login.noMethods")}
            </p>
          ) : null}

          {canUsePasskey ? (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={busy}
              onClick={() => void loginWithPasskey()}
            >
              {t("auth.login.passkey")}
            </Button>
          ) : null}

          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => backToPassword("")}
          >
            {t("common.actions.back")}
          </Button>
        </form>
      ) : null}

      {step.kind === "verify" ? (
        <form
          key="verify-step"
          id="verify-step"
          className="space-y-4"
          onSubmit={submitVerify}
        >
          <p className="text-sm text-muted-foreground">
            {t("auth.verify.body", { email: step.email })}
          </p>

          <Field id="verify-code" label={t("common.code")}>
            <Input
              id="verify-code"
              name="verify-code"
              type="text"
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              value={code}
              aria-invalid={Boolean(error)}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
            />
          </Field>

          {message(error)}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? t("common.loading") : t("auth.verify.submit")}
          </Button>

          <Button
            type="button"
            variant="ghost"
            className="w-full"
            disabled={busy || cooldown.running}
            onClick={() => void resendVerification()}
          >
            {cooldown.running
              ? t("common.resendIn", { seconds: cooldown.seconds })
              : t("common.resend")}
          </Button>
        </form>
      ) : null}
    </AuthShell>
  )
}

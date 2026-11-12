import { useState } from "react"
import { Trans, useTranslation } from "react-i18next"
import { Link } from "react-router"
import { AuthShell } from "@/components/auth-shell"
import { Field } from "@/components/form-field"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useCooldown } from "@/hooks/use-cooldown"
import { currentLanguage } from "@/i18n"
import { authApi } from "@/lib/api"
import { describeApiError, retryAfterSeconds } from "@/lib/api-errors"
import type { RegisterResult } from "@/lib/api-types"
import { useSiteStore } from "@/stores/site"

type Step =
  | { kind: "form" }
  | { kind: "verify"; email: string; result: RegisterResult }
  | { kind: "done"; email: string; pending: boolean }

/**
 * 注册页（规格 §5.6、§6.1）：注册成功按服务端返回的两个开关决定后续——
 * 需要邮箱验证时在同一页换成验证码步；需要审核时显示待批准态。
 * 注册请求带当前界面语言，落库后账号的邮件按该语言发送（§6.5）。
 */
export function RegisterPage() {
  const { t } = useTranslation()
  const info = useSiteStore((state) => state.info)
  const [step, setStep] = useState<Step>({ kind: "form" })
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const cooldown = useCooldown()

  const registrationClosed =
    info?.appMode === "single" || info?.registrationEnabled === false

  const submitRegister = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!email.trim()) {
      setError(t("auth.validation.emailRequired"))
      return
    }
    if (password.length < 8) {
      setError(t("auth.validation.passwordTooShort"))
      return
    }

    setBusy(true)
    setError("")
    try {
      const result = await authApi.register({
        email: email.trim(),
        password,
        language: currentLanguage()
      })
      if (result.requiresEmailVerification) {
        setStep({ kind: "verify", email: email.trim(), result })
        setCode("")
        cooldown.start(60)
        return
      }
      setStep({
        kind: "done",
        email: email.trim(),
        pending: result.requiresApproval
      })
    } catch (registerError) {
      setError(describeApiError(t, registerError))
      const retry = retryAfterSeconds(registerError)
      if (retry) cooldown.start(retry)
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
      setStep({
        kind: "done",
        email: step.email,
        pending: step.result.requiresApproval
      })
    } catch (verifyError) {
      setError(describeApiError(t, verifyError))
    } finally {
      setBusy(false)
    }
  }

  const resend = async () => {
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

  if (registrationClosed) {
    return (
      <AuthShell title={t("auth.register.title")}>
        <div className="space-y-4 text-center text-sm">
          <p className="text-muted-foreground">
            {t("errors.codes.REGISTRATION_DISABLED")}
          </p>
          <Button asChild className="w-full">
            <Link to="/login">{t("auth.login.title")}</Link>
          </Button>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell title={t("auth.register.title")}>
      {step.kind === "form" ? (
        <form
          key="register-step"
          id="register-step"
          className="space-y-4"
          onSubmit={submitRegister}
        >
          <Field id="register-email" label={t("common.email")}>
            <Input
              id="register-email"
              name="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>

          <Field id="register-password" label={t("common.password")}>
            <Input
              id="register-password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          {message(error)}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? t("common.loading") : t("auth.register.submit")}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            <Trans
              i18nKey="auth.register.haveAccount"
              components={{
                signin: (
                  <Link
                    to="/login"
                    className="underline-offset-4 hover:underline"
                  />
                )
              }}
            />
          </p>
        </form>
      ) : null}

      {step.kind === "verify" ? (
        <form
          key="register-verify-step"
          id="register-verify-step"
          className="space-y-4"
          onSubmit={submitVerify}
        >
          <p className="text-sm text-muted-foreground">
            {t("auth.register.verifyBody", { email: step.email })}
          </p>

          <Field id="register-code" label={t("common.code")}>
            <Input
              id="register-code"
              name="register-code"
              type="text"
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
            />
          </Field>

          {notice ? (
            <p role="status" className="text-xs text-muted-foreground">
              {notice}
            </p>
          ) : null}
          {message(error)}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? t("common.loading") : t("auth.register.verifySubmit")}
          </Button>

          <Button
            type="button"
            variant="ghost"
            className="w-full"
            disabled={busy || cooldown.running}
            onClick={() => void resend()}
          >
            {cooldown.running
              ? t("common.resendIn", { seconds: cooldown.seconds })
              : t("common.resend")}
          </Button>
        </form>
      ) : null}

      {step.kind === "done" ? (
        <div className="space-y-4 text-center">
          <p className="font-medium">
            {step.pending
              ? t("auth.register.pendingTitle")
              : t("auth.register.doneTitle")}
          </p>
          <p className="text-sm text-muted-foreground">
            {step.pending
              ? t("auth.register.pendingBody")
              : t("auth.register.verifiedBody", { email: step.email })}
          </p>
          <Button asChild className="w-full">
            <Link to="/login">{t("auth.register.goLogin")}</Link>
          </Button>
        </div>
      ) : null}
    </AuthShell>
  )
}

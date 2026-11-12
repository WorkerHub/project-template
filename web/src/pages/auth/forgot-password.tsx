import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { AuthShell } from "@/components/auth-shell"
import { Field } from "@/components/form-field"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useCooldown } from "@/hooks/use-cooldown"
import { currentLanguage } from "@/i18n"
import { ApiError, authApi } from "@/lib/api"
import { describeApiError, retryAfterSeconds } from "@/lib/api-errors"

type Step = "email" | "code" | "password" | "done"

/**
 * 找回密码（规格 §6.1、§5.6）：输邮箱 → 验证码 → 设新密码。
 *
 * 防枚举：邮箱不存在与存在时界面文案、状态完全一致（都由服务端返回同一形态）。
 * 邮件未配置时登录页不显示入口，这里仍会给可翻译的失败提示。
 */
export function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [step, setStep] = useState<Step>("email")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const cooldown = useCooldown()

  const submitEmail = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!email.trim()) {
      setError(t("auth.validation.emailRequired"))
      return
    }

    setBusy(true)
    setError("")
    try {
      await authApi.forgotPassword({
        email: email.trim(),
        language: currentLanguage()
      })
      setStep("code")
      cooldown.start(60)
    } catch (sendError) {
      setError(describeApiError(t, sendError))
      const retry = retryAfterSeconds(sendError)
      if (retry) cooldown.start(retry)
    } finally {
      setBusy(false)
    }
  }

  const submitCode = (event: React.FormEvent) => {
    event.preventDefault()
    if (!/^\d{6}$/.test(code)) {
      setError(t("auth.validation.codeInvalid"))
      return
    }
    setError("")
    setStep("password")
  }

  const submitPassword = async (event: React.FormEvent) => {
    event.preventDefault()
    if (password.length < 8) {
      setError(t("auth.validation.passwordTooShort"))
      return
    }

    setBusy(true)
    setError("")
    try {
      await authApi.resetPassword({
        email: email.trim(),
        code,
        password
      })
      setStep("done")
    } catch (resetError) {
      const codeFailed =
        resetError instanceof ApiError &&
        (resetError.code === "INVALID_CODE" ||
          resetError.code === "CODE_EXPIRED" ||
          resetError.code === "TOO_MANY_ATTEMPTS")
      setError(describeApiError(t, resetError))
      if (codeFailed) setStep("code")
      const retry = retryAfterSeconds(resetError)
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

  if (step === "done") {
    return (
      <AuthShell title={t("auth.forgot.doneTitle")}>
        <div className="space-y-4 text-center text-sm">
          <p className="text-muted-foreground">{t("auth.forgot.doneBody")}</p>
          <Button asChild className="w-full">
            <Link to="/login">{t("auth.login.title")}</Link>
          </Button>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell title={t("auth.forgot.title")}>
      {step === "email" ? (
        <form
          key="forgot-email-step"
          id="forgot-email-step"
          className="space-y-4"
          onSubmit={submitEmail}
        >
          <p className="text-sm text-muted-foreground">
            {t("auth.forgot.emailStep")}
          </p>

          <Field id="forgot-email" label={t("common.email")}>
            <Input
              id="forgot-email"
              name="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>

          {message(error)}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? t("common.loading") : t("auth.forgot.sendCode")}
          </Button>
        </form>
      ) : null}

      {step === "code" ? (
        <form
          key="forgot-code-step"
          id="forgot-code-step"
          className="space-y-4"
          onSubmit={submitCode}
        >
          <p className="text-sm text-muted-foreground">
            {t("auth.forgot.sentBody")}
          </p>

          <Field id="forgot-code" label={t("auth.forgot.codeStep")}>
            <Input
              id="forgot-code"
              name="forgot-code"
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

          {message(error)}

          <Button type="submit" className="w-full" disabled={busy}>
            {t("common.actions.next")}
          </Button>

          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              setCode("")
              setError("")
              setStep("email")
            }}
          >
            {t("common.actions.back")}
          </Button>
        </form>
      ) : null}

      {step === "password" ? (
        <form
          key="forgot-password-step"
          id="forgot-password-step"
          className="space-y-4"
          onSubmit={submitPassword}
        >
          <p className="text-sm text-muted-foreground">
            {t("auth.forgot.passwordStep")}
          </p>

          <Field id="forgot-password" label={t("common.newPassword")}>
            <Input
              id="forgot-password"
              name="new-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          {message(error)}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? t("common.loading") : t("auth.forgot.submit")}
          </Button>
        </form>
      ) : null}

      <div className="mt-4 text-center text-xs">
        <Link
          to="/login"
          className="text-muted-foreground underline-offset-4 hover:underline"
        >
          {t("auth.login.title")}
        </Link>
      </div>
    </AuthShell>
  )
}

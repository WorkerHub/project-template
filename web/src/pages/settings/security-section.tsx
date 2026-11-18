import { QRCodeSVG } from "qrcode.react"
import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { PasswordChangeForm } from "@/components/password-change-form"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { useCooldown } from "@/hooks/use-cooldown"
import { currentLanguage } from "@/i18n"
import { authApi, meApi } from "@/lib/api"
import { describeApiError, retryAfterSeconds } from "@/lib/api-errors"
import type { PasskeySummary } from "@/lib/api-types"
import { intlLocale } from "@/lib/language"
import {
  isWebAuthnCancelled,
  registrationCredential,
  webauthnSupported
} from "@/lib/webauthn"
import { useAuthStore } from "@/stores/auth"
import { useSiteStore } from "@/stores/site"

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(intlLocale(currentLanguage()))
}

type ConfirmAction =
  | { type: "totpDisable" }
  | { type: "emailDisable" }
  | { type: "passkeyAdd" }
  | { type: "passkeyDelete"; passkey: PasskeySummary }
  | null

/**
 * 设置 · 安全：改密码、两步验证（TOTP 与邮箱验证码）、通行密钥（Passkey）。
 * 所有敏感凭据操作统一通过密码确认弹窗收集当前密码；浏览器不支持 Passkey 时不渲染入口。
 */
export function SecuritySection() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.user)
  const refresh = useAuthStore((state) => state.refresh)
  const info = useSiteStore((state) => state.info)
  const passkeySupported = webauthnSupported()

  const [totpSetup, setTotpSetup] = useState<{
    secret: string
    otpauthUrl: string
  } | null>(null)
  const [totpCode, setTotpCode] = useState("")
  const [totpBusy, setTotpBusy] = useState(false)
  const [totpError, setTotpError] = useState("")

  const [passkeys, setPasskeys] = useState<PasskeySummary[]>([])

  const [emailCodeSent, setEmailCodeSent] = useState(false)
  const [emailCode, setEmailCode] = useState("")
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailError, setEmailError] = useState("")
  const emailCooldown = useCooldown()

  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null)
  const [confirmPassword, setConfirmPassword] = useState("")
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmError, setConfirmError] = useState("")

  const emailConfigured = info?.emailConfigured === true
  const emailEnabled = user?.emailTwoFactorEnabled === true

  const loadPasskeys = useCallback(async () => {
    try {
      const result = await meApi.passkeys()
      setPasskeys(result.items)
    } catch {
      setPasskeys([])
    }
  }, [])

  useEffect(() => {
    if (passkeySupported) void loadPasskeys()
  }, [loadPasskeys, passkeySupported])

  const openConfirmDialog = (action: Exclude<ConfirmAction, null>) => {
    setConfirmAction(action)
    setConfirmPassword("")
    setConfirmError("")
    setConfirmBusy(false)
  }

  const closeConfirmDialog = () => {
    setConfirmAction(null)
    setConfirmPassword("")
    setConfirmError("")
    setConfirmBusy(false)
  }

  const handleConfirmSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!confirmAction) return

    if (!confirmPassword) {
      setConfirmError(t("auth.validation.passwordRequired"))
      return
    }

    setConfirmBusy(true)
    setConfirmError("")

    try {
      if (confirmAction.type === "totpDisable") {
        await authApi.totpDisable(confirmPassword)
        await refresh()
        closeConfirmDialog()
        toast.success(t("settings.security.totpDisabledToast"))
      } else if (confirmAction.type === "emailDisable") {
        await authApi.emailTwoFactorDisable(confirmPassword)
        await refresh()
        closeConfirmDialog()
        toast.success(t("settings.security.emailDisabledToast"))
      } else if (confirmAction.type === "passkeyAdd") {
        const options = await authApi.passkeyRegisterOptions(confirmPassword)
        const credential = await registrationCredential(options)
        await authApi.passkeyRegisterVerify(credential)
        closeConfirmDialog()
        await loadPasskeys()
        await refresh()
        toast.success(t("settings.security.passkeyAdded"))
      } else if (confirmAction.type === "passkeyDelete") {
        await meApi.deletePasskey(confirmAction.passkey.id, confirmPassword)
        closeConfirmDialog()
        await loadPasskeys()
        await refresh()
        toast.success(t("settings.security.passkeyDeleted"))
      }
    } catch (error) {
      if (confirmAction.type === "passkeyAdd" && isWebAuthnCancelled(error)) {
        closeConfirmDialog()
        return
      }
      setConfirmError(describeApiError(t, error))
    } finally {
      setConfirmBusy(false)
    }
  }

  const isDestructiveAction = (action: ConfirmAction) => {
    if (!action) return false
    return (
      action.type === "totpDisable" ||
      action.type === "emailDisable" ||
      action.type === "passkeyDelete"
    )
  }

  const startEmailEnableSend = async () => {
    setEmailBusy(true)
    setEmailError("")
    try {
      await authApi.emailTwoFactorEnableSend()
      setEmailCodeSent(true)
      emailCooldown.start(60)
      setEmailCode("")
    } catch (error) {
      setEmailError(describeApiError(t, error))
      const retry = retryAfterSeconds(error)
      if (retry) emailCooldown.start(retry)
    } finally {
      setEmailBusy(false)
    }
  }

  const confirmEmailEnable = async (event: React.FormEvent) => {
    event.preventDefault()
    setEmailBusy(true)
    setEmailError("")
    try {
      await authApi.emailTwoFactorEnable(emailCode)
      await refresh()
      setEmailCodeSent(false)
      setEmailCode("")
    } catch (error) {
      setEmailError(describeApiError(t, error))
    } finally {
      setEmailBusy(false)
    }
  }

  const startTotp = async () => {
    setTotpBusy(true)
    setTotpError("")
    try {
      const setup = await authApi.totpSetup()
      setTotpSetup(setup)
      setTotpCode("")
    } catch (error) {
      setTotpError(describeApiError(t, error))
    } finally {
      setTotpBusy(false)
    }
  }

  const confirmTotp = async (event: React.FormEvent) => {
    event.preventDefault()
    setTotpBusy(true)
    setTotpError("")
    try {
      await authApi.totpEnable(totpCode)
      await refresh()
      setTotpSetup(null)
      setTotpCode("")
    } catch (error) {
      setTotpError(describeApiError(t, error))
    } finally {
      setTotpBusy(false)
    }
  }

  const errorLine = (message: string) =>
    message ? (
      <p role="alert" className="text-sm text-destructive">
        {message}
      </p>
    ) : null

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h3 className="font-heading text-sm font-semibold">
          {t("settings.security.passwordTitle")}
        </h3>
        <PasswordChangeForm
          idPrefix="security"
          inputClassName="w-full sm:w-80"
        />
      </section>

      <Separator />

      <section className="space-y-3">
        <h3 className="font-heading text-sm font-semibold">
          {t("settings.security.totpTitle")}
        </h3>

        <div className="space-y-3">
          {/* 行 1: 验证器应用 */}
          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">
                  {t("settings.security.totpApp")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {user?.totpEnabled
                    ? t("settings.security.totpEnabled")
                    : t("settings.security.totpDisabled")}
                </p>
              </div>
              {user?.totpEnabled ? (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => openConfirmDialog({ type: "totpDisable" })}
                >
                  {t("settings.security.totpDisable")}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  disabled={totpBusy || totpSetup !== null}
                  onClick={() => void startTotp()}
                >
                  {t("settings.security.totpEnable")}
                </Button>
              )}
            </div>

            {errorLine(totpError)}

            {!user?.totpEnabled && totpSetup ? (
              <form className="space-y-3 border-t pt-2" onSubmit={confirmTotp}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="w-fit rounded-lg bg-white p-2">
                    <QRCodeSVG value={totpSetup.otpauthUrl} size={128} />
                  </div>
                  <div className="space-y-1 text-sm">
                    <p className="text-muted-foreground">
                      {t("settings.security.totpScan")}
                    </p>
                    <p className="font-mono text-xs break-all">
                      {totpSetup.secret}
                    </p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="totp-enable-code">
                    {t("settings.security.totpCode")}
                  </Label>
                  <Input
                    id="totp-enable-code"
                    name="totp-code"
                    type="text"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={6}
                    className="w-full sm:w-80"
                    value={totpCode}
                    onChange={(event) =>
                      setTotpCode(
                        event.target.value.replace(/\D/g, "").slice(0, 6)
                      )
                    }
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={totpBusy}>
                    {t("settings.security.totpConfirm")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setTotpSetup(null)
                      setTotpCode("")
                      setTotpError("")
                    }}
                  >
                    {t("common.actions.cancel")}
                  </Button>
                </div>
              </form>
            ) : null}
          </div>

          {/* 行 2: 邮箱验证码 */}
          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">
                  {t("settings.security.emailTitle")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {emailEnabled
                    ? t("settings.security.emailEnabled")
                    : emailConfigured
                      ? t("settings.security.emailDisabled")
                      : t("common.emailNotConfigured")}
                </p>
              </div>
              {emailEnabled ? (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => openConfirmDialog({ type: "emailDisable" })}
                >
                  {t("settings.security.emailDisable")}
                </Button>
              ) : emailConfigured ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={emailBusy || emailCooldown.running || emailCodeSent}
                  onClick={() => void startEmailEnableSend()}
                >
                  {emailCooldown.running
                    ? t("common.resendIn", { seconds: emailCooldown.seconds })
                    : t("settings.security.emailEnable")}
                </Button>
              ) : null}
            </div>

            {errorLine(emailError)}

            {!emailEnabled && emailConfigured && emailCodeSent ? (
              <form
                className="space-y-3 border-t pt-2"
                onSubmit={confirmEmailEnable}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="email-enable-code">{t("common.code")}</Label>
                  <Input
                    id="email-enable-code"
                    name="email-enable-code"
                    type="text"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={6}
                    className="w-full sm:w-80"
                    value={emailCode}
                    aria-invalid={Boolean(emailError)}
                    onChange={(event) =>
                      setEmailCode(
                        event.target.value.replace(/\D/g, "").slice(0, 6)
                      )
                    }
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" disabled={emailBusy}>
                    {t("settings.security.emailConfirm")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={emailBusy || emailCooldown.running}
                    onClick={() => void startEmailEnableSend()}
                  >
                    {emailCooldown.running
                      ? t("common.resendIn", {
                          seconds: emailCooldown.seconds
                        })
                      : t("common.resend")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setEmailCodeSent(false)
                      setEmailCode("")
                      setEmailError("")
                    }}
                  >
                    {t("common.actions.cancel")}
                  </Button>
                </div>
              </form>
            ) : null}
          </div>
        </div>
      </section>

      <Separator />

      <section className="space-y-3">
        <h3 className="font-heading text-sm font-semibold">
          {t("settings.security.passkeyTitle")}
        </h3>

        {!passkeySupported ? (
          <p className="text-sm text-muted-foreground">
            {t("settings.security.passkeyUnsupported")}
          </p>
        ) : (
          <div className="space-y-3">
            <ul className="space-y-2 text-sm">
              {passkeys.length === 0 ? (
                <li className="text-muted-foreground">
                  {t("settings.security.passkeyEmpty")}
                </li>
              ) : (
                passkeys.map((passkey) => (
                  <li
                    key={passkey.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
                  >
                    <div className="space-y-0.5">
                      <p>
                        {t("settings.security.passkeyCreatedAt", {
                          date: formatDate(passkey.createdAt)
                        })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {passkey.lastUsedAt
                          ? t("settings.security.passkeyLastUsed", {
                              date: formatDate(passkey.lastUsedAt)
                            })
                          : t("settings.security.passkeyNeverUsed")}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() =>
                        openConfirmDialog({
                          type: "passkeyDelete",
                          passkey
                        })
                      }
                    >
                      {t("settings.security.passkeyDelete")}
                    </Button>
                  </li>
                ))
              )}
            </ul>

            <div>
              <Button
                type="button"
                variant="outline"
                onClick={() => openConfirmDialog({ type: "passkeyAdd" })}
              >
                {t("settings.security.passkeyAdd")}
              </Button>
            </div>
          </div>
        )}
      </section>

      <Dialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeConfirmDialog()
          }
        }}
      >
        <DialogContent>
          <form className="space-y-4" onSubmit={handleConfirmSubmit}>
            <DialogHeader>
              <DialogTitle>
                {t("settings.security.confirmPasswordTitle")}
              </DialogTitle>
              <DialogDescription>
                {t("settings.security.confirmPasswordDescription")}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5">
              <Label htmlFor="confirm-action-password">
                {t("common.currentPassword")}
              </Label>
              <Input
                id="confirm-action-password"
                name="current-password"
                type="password"
                autoComplete="current-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                disabled={confirmBusy}
                autoFocus
              />
            </div>

            {confirmError ? (
              <p role="alert" className="text-sm text-destructive">
                {confirmError}
              </p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={confirmBusy}
                onClick={closeConfirmDialog}
              >
                {t("common.actions.cancel")}
              </Button>
              <Button
                type="submit"
                variant={
                  isDestructiveAction(confirmAction) ? "destructive" : "default"
                }
                disabled={confirmBusy}
              >
                {confirmBusy
                  ? t("common.actions.saving")
                  : t("common.actions.confirm")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

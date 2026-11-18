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

interface PendingAction {
  title?: string
  description?: string
  confirmText?: string
  destructive?: boolean
  execute: (password: string) => Promise<void>
}

/**
 * 设置 · 安全：改密码、两步验证（TOTP + 邮箱验证码）、Passkey 管理。
 * 敏感动作（关闭验证、添加/删除 Passkey）统一走密码确认弹窗，页面不常驻密码框。
 */
export function SecuritySection() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.user)
  const refresh = useAuthStore((state) => state.refresh)
  const info = useSiteStore((state) => state.info)
  const passkeySupported = webauthnSupported()

  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [confirmPassword, setConfirmPassword] = useState("")
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmError, setConfirmError] = useState("")

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

  const handleDialogClose = () => {
    if (confirmBusy) return
    setPendingAction(null)
    setConfirmPassword("")
    setConfirmError("")
  }

  const handleConfirmSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!pendingAction) return
    if (!confirmPassword) {
      setConfirmError(t("auth.validation.passwordRequired"))
      return
    }
    setConfirmBusy(true)
    setConfirmError("")
    try {
      await pendingAction.execute(confirmPassword)
      setPendingAction(null)
      setConfirmPassword("")
    } catch (error) {
      if (isWebAuthnCancelled(error)) {
        setPendingAction(null)
        setConfirmPassword("")
        return
      }
      setConfirmError(describeApiError(t, error))
    } finally {
      setConfirmBusy(false)
    }
  }

  const openDisableTotp = () => {
    setPendingAction({
      title: t("settings.security.verifyPasswordTitle"),
      description: t("settings.security.verifyPasswordDescription"),
      confirmText: t("common.actions.confirm"),
      destructive: true,
      execute: async (password) => {
        await authApi.totpDisable(password)
        await refresh()
        toast.success(t("settings.security.totpDisabledToast"))
      }
    })
    setConfirmPassword("")
    setConfirmError("")
  }

  const openDisableEmail = () => {
    setPendingAction({
      title: t("settings.security.verifyPasswordTitle"),
      description: t("settings.security.verifyPasswordDescription"),
      confirmText: t("common.actions.confirm"),
      destructive: true,
      execute: async (password) => {
        await authApi.emailTwoFactorDisable(password)
        await refresh()
        toast.success(t("settings.security.emailDisabledToast"))
      }
    })
    setConfirmPassword("")
    setConfirmError("")
  }

  const openAddPasskey = () => {
    setPendingAction({
      title: t("settings.security.verifyPasswordTitle"),
      description: t("settings.security.verifyPasswordDescription"),
      confirmText: t("common.actions.confirm"),
      destructive: false,
      execute: async (password) => {
        const options = await authApi.passkeyRegisterOptions(password)
        const credential = await registrationCredential(options)
        await authApi.passkeyRegisterVerify(credential)
        await loadPasskeys()
        await refresh()
        toast.success(t("settings.security.passkeyAdded"))
      }
    })
    setConfirmPassword("")
    setConfirmError("")
  }

  const openDeletePasskey = (passkey: PasskeySummary) => {
    setPendingAction({
      title: t("settings.security.verifyPasswordTitle"),
      description: t("settings.security.verifyPasswordDescription"),
      confirmText: t("common.actions.confirm"),
      destructive: true,
      execute: async (password) => {
        await meApi.deletePasskey(passkey.id, password)
        await loadPasskeys()
        await refresh()
        toast.success(t("settings.security.passkeyDeleted"))
      }
    })
    setConfirmPassword("")
    setConfirmError("")
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
          <div
            data-testid="totp-row"
            className="space-y-3 rounded-lg border p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">
                  {t("settings.security.totpItemTitle")}
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
                  size="sm"
                  onClick={openDisableTotp}
                >
                  {t("settings.security.totpDisable")}
                </Button>
              ) : !totpSetup ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={totpBusy}
                  onClick={() => void startTotp()}
                >
                  {t("settings.security.totpEnable")}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setTotpSetup(null)
                    setTotpError("")
                  }}
                >
                  {t("common.actions.cancel")}
                </Button>
              )}
            </div>

            {errorLine(totpError)}

            {totpSetup && !user?.totpEnabled ? (
              <form className="space-y-3 pt-2" onSubmit={confirmTotp}>
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
                <Button type="submit" disabled={totpBusy}>
                  {t("settings.security.totpConfirm")}
                </Button>
              </form>
            ) : null}
          </div>

          <div
            data-testid="email-row"
            className="space-y-3 rounded-lg border p-3"
          >
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
                  size="sm"
                  onClick={openDisableEmail}
                >
                  {t("settings.security.emailDisable")}
                </Button>
              ) : emailConfigured ? (
                emailCodeSent ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEmailCodeSent(false)
                      setEmailCode("")
                      setEmailError("")
                    }}
                  >
                    {t("common.actions.cancel")}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={emailBusy || emailCooldown.running}
                    onClick={() => void startEmailEnableSend()}
                  >
                    {emailCooldown.running
                      ? t("common.resendIn", {
                          seconds: emailCooldown.seconds
                        })
                      : t("settings.security.emailEnable")}
                  </Button>
                )
              ) : null}
            </div>

            {errorLine(emailError)}

            {emailConfigured && emailCodeSent && !emailEnabled ? (
              <form className="space-y-3 pt-2" onSubmit={confirmEmailEnable}>
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
                <div className="flex items-center gap-2">
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
          <>
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
                      onClick={() => openDeletePasskey(passkey)}
                    >
                      {t("settings.security.passkeyDelete")}
                    </Button>
                  </li>
                ))
              )}
            </ul>

            <div>
              <Button type="button" variant="outline" onClick={openAddPasskey}>
                {t("settings.security.passkeyAdd")}
              </Button>
            </div>
          </>
        )}
      </section>

      <Dialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open) handleDialogClose()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingAction?.title ??
                t("settings.security.verifyPasswordTitle")}
            </DialogTitle>
            {pendingAction?.description ? (
              <DialogDescription>{pendingAction.description}</DialogDescription>
            ) : null}
          </DialogHeader>

          <form className="space-y-4" onSubmit={handleConfirmSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-action-password">
                {t("common.currentPassword")}
              </Label>
              <Input
                id="confirm-action-password"
                name="current-password"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
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
                onClick={handleDialogClose}
              >
                {t("common.actions.cancel")}
              </Button>
              <Button
                type="submit"
                variant={pendingAction?.destructive ? "destructive" : "default"}
                disabled={confirmBusy}
              >
                {confirmBusy
                  ? t("common.loading")
                  : (pendingAction?.confirmText ?? t("common.actions.confirm"))}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

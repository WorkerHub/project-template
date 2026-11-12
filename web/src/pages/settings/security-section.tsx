import { QRCodeSVG } from "qrcode.react"
import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { currentLanguage } from "@/i18n"
import { authApi, meApi } from "@/lib/api"
import { describeApiError } from "@/lib/api-errors"
import type { PasskeySummary } from "@/lib/api-types"
import { intlLocale } from "@/lib/language"
import {
  isWebAuthnCancelled,
  registrationCredential,
  webauthnSupported
} from "@/lib/webauthn"
import { useAuthStore } from "@/stores/auth"

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(intlLocale(currentLanguage()))
}

/**
 * 设置 · 安全：改密码、TOTP 开关、Passkey 管理（规格 §6.1）。
 * 所有凭据操作都对齐单 B 的契约；浏览器不支持 Passkey 时不渲染入口。
 */
export function SecuritySection() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.user)
  const refresh = useAuthStore((state) => state.refresh)
  const passkeySupported = webauthnSupported()

  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordError, setPasswordError] = useState("")

  const [totpSetup, setTotpSetup] = useState<{
    secret: string
    otpauthUrl: string
  } | null>(null)
  const [totpCode, setTotpCode] = useState("")
  const [totpPassword, setTotpPassword] = useState("")
  const [totpBusy, setTotpBusy] = useState(false)
  const [totpError, setTotpError] = useState("")

  const [passkeys, setPasskeys] = useState<PasskeySummary[]>([])
  const [passkeyPassword, setPasskeyPassword] = useState("")
  const [passkeyBusy, setPasskeyBusy] = useState(false)
  const [passkeyError, setPasskeyError] = useState("")
  const [deleting, setDeleting] = useState<PasskeySummary | null>(null)
  const [deletePassword, setDeletePassword] = useState("")

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

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault()
    if (newPassword.length < 8) {
      setPasswordError(t("auth.validation.passwordTooShort"))
      return
    }
    setPasswordBusy(true)
    setPasswordError("")
    try {
      await meApi.changePassword({ currentPassword, newPassword })
      setCurrentPassword("")
      setNewPassword("")
      toast.success(t("settings.security.passwordChanged"))
    } catch (error) {
      setPasswordError(describeApiError(t, error))
    } finally {
      setPasswordBusy(false)
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

  const disableTotp = async (event: React.FormEvent) => {
    event.preventDefault()
    setTotpBusy(true)
    setTotpError("")
    try {
      await authApi.totpDisable(totpPassword)
      await refresh()
      setTotpPassword("")
      toast.success(t("settings.security.totpDisabledToast"))
    } catch (error) {
      setTotpError(describeApiError(t, error))
    } finally {
      setTotpBusy(false)
    }
  }

  const addPasskey = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!passkeyPassword) {
      setPasskeyError(t("auth.validation.passwordRequired"))
      return
    }
    setPasskeyBusy(true)
    setPasskeyError("")
    try {
      const options = await authApi.passkeyRegisterOptions(passkeyPassword)
      const credential = await registrationCredential(options)
      await authApi.passkeyRegisterVerify(credential)
      setPasskeyPassword("")
      await loadPasskeys()
      await refresh()
      toast.success(t("settings.security.passkeyAdded"))
    } catch (error) {
      if (isWebAuthnCancelled(error)) return
      setPasskeyError(describeApiError(t, error))
    } finally {
      setPasskeyBusy(false)
    }
  }

  const deletePasskey = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!deleting) return
    setPasskeyBusy(true)
    setPasskeyError("")
    try {
      await meApi.deletePasskey(deleting.id, deletePassword)
      setDeleting(null)
      setDeletePassword("")
      await loadPasskeys()
      await refresh()
      toast.success(t("settings.security.passkeyDeleted"))
    } catch (error) {
      setPasskeyError(describeApiError(t, error))
    } finally {
      setPasskeyBusy(false)
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
        <form className="space-y-3" onSubmit={changePassword}>
          <div className="space-y-1.5">
            <Label htmlFor="security-current-password">
              {t("common.currentPassword")}
            </Label>
            <Input
              id="security-current-password"
              name="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="security-new-password">
              {t("common.newPassword")}
            </Label>
            <Input
              id="security-new-password"
              name="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </div>
          {errorLine(passwordError)}
          <Button type="submit" disabled={passwordBusy}>
            {passwordBusy
              ? t("common.actions.saving")
              : t("settings.security.passwordSubmit")}
          </Button>
        </form>
      </section>

      <Separator />

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="font-heading text-sm font-semibold">
            {t("settings.security.totpTitle")}
          </h3>
          <span className="text-xs text-muted-foreground">
            {user?.totpEnabled
              ? t("settings.security.totpEnabled")
              : t("settings.security.totpDisabled")}
          </span>
        </div>

        {user?.totpEnabled ? (
          <form className="space-y-3" onSubmit={disableTotp}>
            <div className="space-y-1.5">
              <Label htmlFor="totp-disable-password">
                {t("common.currentPassword")}
              </Label>
              <Input
                id="totp-disable-password"
                name="current-password"
                type="password"
                autoComplete="current-password"
                value={totpPassword}
                onChange={(event) => setTotpPassword(event.target.value)}
              />
            </div>
            {errorLine(totpError)}
            <Button type="submit" variant="outline" disabled={totpBusy}>
              {t("settings.security.totpDisable")}
            </Button>
          </form>
        ) : totpSetup ? (
          <form className="space-y-3" onSubmit={confirmTotp}>
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
                value={totpCode}
                onChange={(event) =>
                  setTotpCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
              />
            </div>
            {errorLine(totpError)}
            <Button type="submit" disabled={totpBusy}>
              {t("settings.security.totpConfirm")}
            </Button>
          </form>
        ) : (
          <div className="space-y-3">
            {errorLine(totpError)}
            <Button
              type="button"
              variant="outline"
              disabled={totpBusy}
              onClick={() => void startTotp()}
            >
              {t("settings.security.totpEnable")}
            </Button>
          </div>
        )}
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
                      {passkey.lastUsedAt ? (
                        <p className="text-xs text-muted-foreground">
                          {t("settings.security.passkeyLastUsed", {
                            date: formatDate(passkey.lastUsedAt)
                          })}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDeleting(passkey)
                        setDeletePassword("")
                        setPasskeyError("")
                      }}
                    >
                      {t("settings.security.passkeyDelete")}
                    </Button>
                  </li>
                ))
              )}
            </ul>

            {deleting ? (
              <form
                className="space-y-3 rounded-lg border p-3"
                onSubmit={deletePasskey}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="passkey-delete-password">
                    {t("common.currentPassword")}
                  </Label>
                  <Input
                    id="passkey-delete-password"
                    name="current-password"
                    type="password"
                    autoComplete="current-password"
                    value={deletePassword}
                    onChange={(event) => setDeletePassword(event.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    variant="destructive"
                    disabled={passkeyBusy}
                  >
                    {t("settings.security.passkeyDelete")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setDeleting(null)}
                  >
                    {t("common.actions.cancel")}
                  </Button>
                </div>
              </form>
            ) : null}

            <form className="space-y-3" onSubmit={addPasskey}>
              <div className="space-y-1.5">
                <Label htmlFor="passkey-add-password">
                  {t("common.currentPassword")}
                </Label>
                <Input
                  id="passkey-add-password"
                  name="current-password"
                  type="password"
                  autoComplete="current-password"
                  value={passkeyPassword}
                  onChange={(event) => setPasskeyPassword(event.target.value)}
                />
              </div>
              {errorLine(passkeyError)}
              <Button type="submit" variant="outline" disabled={passkeyBusy}>
                {t("settings.security.passkeyAdd")}
              </Button>
            </form>
          </>
        )}
      </section>
    </div>
  )
}

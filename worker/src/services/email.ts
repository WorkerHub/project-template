/**
 * 邮件发送的唯一抽象（规格 §5.5A）：业务只调 `sendEmail(env, {to, subject, html, text})`，
 * 不感知通道；通道由 `system_settings.email_provider` 单选决定（none / smtp / resend），
 * 不做双通道也不做自动故障转移。
 *
 * `isEmailConfigured()` 是全站「邮件是否可用」的**唯一判定**：provider 为 none/缺键、
 * smtp 缺 host、resend 缺 api_key，都算未配置。依赖邮件的功能（找回密码入口、
 * 「注册需邮箱验证」开关）只读这个布尔值，绝不各判一套，也就不会出现「开了功能却
 * 发不出码」的自锁态。
 *
 * 凭据只写不读：接口读回只有 `passwordSet` / `apiKeySet`，保存时留空表示不改。
 */
import { PROJECT_NAME } from "../config/project"
import { getSetting, setSetting } from "../lib/setup"
import { getTablePrefix } from "../lib/table-prefix"
import type { Env } from "../types"

const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

/** 收件人/发件人地址校验（eNotify 同款），额外拒绝 CR/LF 头注入。 */
export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email) && !email.includes("\r") && !email.includes("\n")
}

export type EmailProvider = "none" | "smtp" | "resend"

export interface EmailMessage {
  to: string
  subject: string
  html: string
  /** 纯文本替代体（验证码邮件用它兜底不支持 HTML 的客户端）。 */
  text?: string
}

export interface SendEmailResult {
  success: boolean
  /** 失败原因；provider 的原始错误原文（测试邮件与日志要看到它，不吞错）。 */
  error?: string
}

export interface SmtpConfig {
  host: string
  port: number
  username: string
  password: string
  from: string
  from_name: string
}

export interface ResendConfig {
  api_key: string
  from: string
  from_name: string
}

async function readJsonSetting<T>(env: Env, key: string): Promise<T | null> {
  const raw = await getSetting(env.DB, getTablePrefix(env), key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function readEmailProvider(env: Env): Promise<EmailProvider> {
  const raw = await getSetting(env.DB, getTablePrefix(env), "email_provider")
  if (raw === "smtp" || raw === "resend") return raw
  return "none"
}

export async function readSmtpConfig(env: Env): Promise<SmtpConfig | null> {
  return readJsonSetting<SmtpConfig>(env, "smtp_config")
}

export async function readResendConfig(env: Env): Promise<ResendConfig | null> {
  return readJsonSetting<ResendConfig>(env, "resend_config")
}

/**
 * 全站唯一的「邮件能否真正发出去」判断。永不抛错：配置坏了也不能把登录/找回
 * 密码整个拖垮。
 */
export async function isEmailConfigured(env: Env): Promise<boolean> {
  try {
    const provider = await readEmailProvider(env)
    if (provider === "none") return false
    if (provider === "resend") {
      const config = await readResendConfig(env)
      return Boolean(config?.api_key)
    }
    const config = await readSmtpConfig(env)
    return Boolean(config?.host)
  } catch {
    return false
  }
}

function senderFrom(config: { from?: string; from_name?: string }): {
  from: string
  fromName: string
} {
  const from = config.from || "noreply@example.com"
  const fromName = (config.from_name || PROJECT_NAME).replace(/[\r\n]/g, "")
  return { from, fromName }
}

export async function sendEmail(
  env: Env,
  message: EmailMessage
): Promise<SendEmailResult> {
  if (!isValidEmail(message.to)) {
    return { success: false, error: "Invalid recipient email address" }
  }

  const provider = await readEmailProvider(env)
  if (provider === "none") {
    return { success: false, error: "No email provider configured" }
  }
  if (provider === "resend") return sendViaResend(env, message)
  return sendViaSmtp(env, message)
}

async function sendViaResend(
  env: Env,
  message: EmailMessage
): Promise<SendEmailResult> {
  const config = await readResendConfig(env)
  if (!config) return { success: false, error: "Resend not configured" }
  if (!config.api_key) {
    return { success: false, error: "Resend API key not configured" }
  }
  const sender = senderFrom(config)

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.api_key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: `${sender.fromName} <${sender.from}>`,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      ...(message.text ? { text: message.text } : {})
    })
  })

  if (!response.ok) {
    // 原文回显：管理面的「发送测试邮件」要把 Resend 的真实报错给管理员看。
    const error = await response.text()
    return { success: false, error: `Resend error: ${error}` }
  }
  return { success: true }
}

async function sendViaSmtp(
  env: Env,
  message: EmailMessage
): Promise<SendEmailResult> {
  const config = await readSmtpConfig(env)
  if (!config) return { success: false, error: "SMTP not configured" }
  if (!config.host) return { success: false, error: "SMTP host not configured" }
  const sender = senderFrom(config)

  // 延迟加载：`cloudflare:sockets` 只在真的走 SMTP 时求值，测试与纯配置路径不受影响。
  const { sendSmtpMessage } = await import("./smtp-transport")
  return sendSmtpMessage(
    {
      host: config.host,
      port: Number(config.port) || 587,
      username: config.username,
      password: config.password
    },
    {
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      from: sender.from,
      fromName: sender.fromName
    }
  )
}

// ─── 系统管理侧的读取（脱敏）与保存 ────────────────────────────────────────────

export interface EmailSettingsView {
  provider: EmailProvider
  configured: boolean
  smtp: {
    host: string
    port: number
    username: string
    from: string
    fromName: string
    /** 是否已存密码；密码本身永不返回。 */
    passwordSet: boolean
  }
  resend: {
    from: string
    fromName: string
    /** 是否已存 API key；key 本身永不返回。 */
    apiKeySet: boolean
  }
}

export async function readEmailSettings(env: Env): Promise<EmailSettingsView> {
  const provider = await readEmailProvider(env)
  const smtp = await readSmtpConfig(env)
  const resend = await readResendConfig(env)
  return {
    provider,
    configured: await isEmailConfigured(env),
    smtp: {
      host: smtp?.host ?? "",
      port: Number(smtp?.port) || 587,
      username: smtp?.username ?? "",
      from: smtp?.from ?? "",
      fromName: smtp?.from_name ?? "",
      passwordSet: Boolean(smtp?.password)
    },
    resend: {
      from: resend?.from ?? "",
      fromName: resend?.from_name ?? "",
      apiKeySet: Boolean(resend?.api_key)
    }
  }
}

export interface EmailSettingsPatch {
  provider?: EmailProvider
  smtp?: {
    host?: string
    port?: number
    username?: string
    /** 空串/缺省 = 不改已存密码。 */
    password?: string
    from?: string
    fromName?: string
  }
  resend?: {
    /** 空串/缺省 = 不改已存 key。 */
    apiKey?: string
    from?: string
    fromName?: string
  }
}

export type SaveEmailSettingsResult =
  | { ok: true }
  | { ok: false; error: string }

const PROVIDERS: EmailProvider[] = ["none", "smtp", "resend"]

function hasHeaderInjection(value: string): boolean {
  return /[\r\n]/.test(value)
}

function validateFrom(value: string, label: string): string | null {
  if (value.length === 0) return null
  if (!isValidEmail(value)) return `${label} is not a valid email address`
  return null
}

async function writeJsonSetting(
  env: Env,
  key: string,
  value: Record<string, unknown>
): Promise<void> {
  await setSetting(env.DB, getTablePrefix(env), key, JSON.stringify(value))
}

/**
 * 保存邮件配置。规则：
 * - provider 必须三态之一；
 * - 只应用给出的字段；凭据字段留空/缺省表示保留原值（接口永远读不回它）；
 * - 地址类字段做 CR/LF 与邮箱格式校验（头部注入拦截）；
 * - 存一个不完整的配置是允许的（`email_configured` 会如实为假），但字段值本身必须合法。
 */
export async function saveEmailSettings(
  env: Env,
  patch: EmailSettingsPatch
): Promise<SaveEmailSettingsResult> {
  if (patch.provider !== undefined && !PROVIDERS.includes(patch.provider)) {
    return { ok: false, error: "Unknown email provider" }
  }

  if (patch.smtp !== undefined) {
    const existing = (await readSmtpConfig(env)) ?? {
      host: "",
      port: 587,
      username: "",
      password: "",
      from: "",
      from_name: ""
    }
    const next: SmtpConfig = { ...existing }

    const stringFields: Array<["host" | "username", string | undefined]> = [
      ["host", patch.smtp.host],
      ["username", patch.smtp.username]
    ]
    for (const [field, value] of stringFields) {
      if (value === undefined) continue
      if (hasHeaderInjection(value)) {
        return { ok: false, error: `smtp.${field} must not contain CR/LF` }
      }
      next[field] = value.trim()
    }

    if (patch.smtp.port !== undefined) {
      const port = Number(patch.smtp.port)
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        return { ok: false, error: "smtp.port must be 1-65535" }
      }
      next.port = port
    }

    if (patch.smtp.from !== undefined) {
      if (hasHeaderInjection(patch.smtp.from)) {
        return { ok: false, error: "smtp.from must not contain CR/LF" }
      }
      const invalid = validateFrom(patch.smtp.from.trim(), "smtp.from")
      if (invalid) return { ok: false, error: invalid }
      next.from = patch.smtp.from.trim()
    }
    if (patch.smtp.fromName !== undefined) {
      if (hasHeaderInjection(patch.smtp.fromName)) {
        return { ok: false, error: "smtp.fromName must not contain CR/LF" }
      }
      next.from_name = patch.smtp.fromName.trim()
    }
    if (patch.smtp.password !== undefined && patch.smtp.password !== "") {
      if (hasHeaderInjection(patch.smtp.password)) {
        return { ok: false, error: "smtp.password must not contain CR/LF" }
      }
      next.password = patch.smtp.password
    }

    await writeJsonSetting(
      env,
      "smtp_config",
      next as unknown as Record<string, unknown>
    )
  }

  if (patch.resend !== undefined) {
    const existing = (await readResendConfig(env)) ?? {
      api_key: "",
      from: "",
      from_name: ""
    }
    const next: ResendConfig = { ...existing }

    if (patch.resend.from !== undefined) {
      if (hasHeaderInjection(patch.resend.from)) {
        return { ok: false, error: "resend.from must not contain CR/LF" }
      }
      const invalid = validateFrom(patch.resend.from.trim(), "resend.from")
      if (invalid) return { ok: false, error: invalid }
      next.from = patch.resend.from.trim()
    }
    if (patch.resend.fromName !== undefined) {
      if (hasHeaderInjection(patch.resend.fromName)) {
        return { ok: false, error: "resend.fromName must not contain CR/LF" }
      }
      next.from_name = patch.resend.fromName.trim()
    }
    if (patch.resend.apiKey !== undefined && patch.resend.apiKey !== "") {
      if (hasHeaderInjection(patch.resend.apiKey)) {
        return { ok: false, error: "resend.apiKey must not contain CR/LF" }
      }
      next.api_key = patch.resend.apiKey.trim()
    }

    await writeJsonSetting(
      env,
      "resend_config",
      next as unknown as Record<string, unknown>
    )
  }

  if (patch.provider !== undefined) {
    await setSetting(
      env.DB,
      getTablePrefix(env),
      "email_provider",
      patch.provider
    )
  }

  return { ok: true }
}

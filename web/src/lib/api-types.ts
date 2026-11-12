/**
 * 前后端接口契约的 DTO（与单 B 冻结的形态一致）。
 *
 * 只放 wire 形状；页面自己的视图状态不进这里。所有时间为 ISO 字符串。
 */

export type AppMode = "multi" | "single"

/** GET /api/public：公开数据，可缓存。 */
export interface PublicInfo {
  name: string
  tagline: string
  repositoryUrl: string
  version: string
  appMode: AppMode
  registrationEnabled: boolean
  emailConfigured: boolean
}

/** GET /api/setup/state：不含任何密钥/哈希。 */
export interface SetupState {
  enabled: boolean
  ownerExists: boolean
  tablePrefix: string
}

export interface MigrationResult {
  name: string
  status: "applied" | "skipped"
}

export interface SetupResult {
  success: true
  tablePrefix: string
  migrations: MigrationResult[]
}

export interface SetupOwnerInput {
  email: string
  password: string
  displayName: string
  language: string
}

export type TwoFactorMethod = "totp" | "passkey"

export interface Me {
  id: number
  email: string
  displayName: string
  role: "admin" | "user"
  status: "active" | "pending" | "disabled"
  emailVerified: boolean
  language: string
  /** 账号侧取值：system / light / dark（界面上的「自动」= system）。 */
  theme: string
  timezone: string
  totpEnabled: boolean
  passkeyCount: number
}

export type LoginResult =
  | { success: true; user: Me }
  | { requires2fa: true; tempToken: string; methods: TwoFactorMethod[] }

export interface RegisterResult {
  requiresApproval: boolean
  requiresEmailVerification: boolean
}

export interface MeUpdateInput {
  displayName?: string
  language?: string
  theme?: string
  timezone?: string
}

export interface PasskeySummary {
  id: number
  createdAt: string
  lastUsedAt: string | null
  transports?: string[]
}

export type EmailProvider = "none" | "smtp" | "resend"

export interface SmtpSettings {
  host: string
  port: string
  username: string
  /** 只读：是否已保存过密码；保存时 password 留空表示不改。 */
  passwordSet: boolean
  from: string
  fromName: string
}

export interface ResendSettings {
  apiKeySet: boolean
  from: string
  fromName: string
}

export interface EmailSettings {
  provider: EmailProvider
  smtp: SmtpSettings
  resend: ResendSettings
  configured: boolean
}

export interface RegistrationSettings {
  enabled: boolean
  approvalRequired: boolean
  emailVerification: boolean
}

export interface AdminSettings {
  /** 单人档不涉及注册：整个段为 null，页面据此隐藏。 */
  registration: RegistrationSettings | null
  setupPageEnabled: boolean
  tablePrefix: string
  email: EmailSettings
}

export interface SmtpUpdateInput {
  host: string
  port: string
  username: string
  /** 留空 = 不修改已保存的密码。 */
  password?: string
  from: string
  fromName: string
}

export interface ResendUpdateInput {
  from: string
  fromName: string
  /** 留空 = 不修改已保存的 key。 */
  apiKey?: string
}

export interface AdminSettingsUpdate {
  registration?: RegistrationSettings
  setupPageEnabled?: boolean
  email?: {
    provider: EmailProvider
    smtp: SmtpUpdateInput
    resend: ResendUpdateInput
  }
}

export interface PendingUser {
  id: number
  email: string
  displayName: string
  createdAt: string
}

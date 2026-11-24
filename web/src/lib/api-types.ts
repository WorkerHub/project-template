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

export type TwoFactorMethod = "totp" | "passkey" | "email"

export type UserRole = "admin" | "user"

export interface Me {
  id: number
  email: string
  displayName: string
  role: UserRole
  status: "active" | "pending" | "disabled"
  emailVerified: boolean
  /** 首次登录强制改密（管理员建号等场景）；true 时前端引导强制改密后再放行。 */
  mustChangePassword: boolean
  language: string
  timezone: string
  totpEnabled: boolean
  totpLabel: string | null
  emailTwoFactorEnabled: boolean
  passkeyCount: number
  /** 个人资料修改锁（后端强制拦截的开关状态，前端据此灰掉编辑按钮）。 */
  profileLocks: {
    displayNameLocked: boolean
  }
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
  timezone?: string
}

export interface PasskeySummary {
  id: number
  name: string | null
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
  profileLocks: {
    displayNameLocked: boolean
  }
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
  profileLocks?: {
    displayNameLocked?: boolean
  }
  setupPageEnabled?: boolean
  email?: {
    provider: EmailProvider
    smtp: SmtpUpdateInput
    resend: ResendUpdateInput
  }
}

/** GET /api/admin/users 列表项：全量用户（`?status=pending` 时为其中待批准子集）。 */
export interface AdminUser {
  id: number
  email: string
  displayName: string
  role: UserRole
  status: "active" | "pending" | "disabled"
  emailVerified: boolean
  createdAt: string
}

/** POST /api/admin/users：管理员手动新建用户（后端生成一次性初始密码）。 */
export interface AdminCreateUserInput {
  email: string
  role: UserRole
  /** 缺省 ''。 */
  displayName?: string
  /** 缺省 'zh'。 */
  language?: string
  /** IANA 时区，缺省 'Asia/Shanghai'。 */
  timezone?: string
}

/** POST /api/admin/users 响应：直接激活；一次性密码仅此响应返回。 */
export interface AdminCreateUserResult {
  id: number
  email: string
  role: UserRole
  status: "active"
  /** 系统生成的一次性初始密码，仅本次响应返回，之后任何接口不回显、不落明文库。 */
  temporaryPassword: string
}

/** POST /api/admin/users/:id/reset-password：管理员重置密码，返回新一次性密码。 */
export interface AdminResetPasswordResult {
  id: number
  email: string
  /** 系统生成的一次性初始密码，仅本次响应返回，之后任何接口不回显、不落明文库。 */
  temporaryPassword: string
}

/** POST /api/admin/users/:id/role：变更角色（普通用户 ↔ 管理员）。 */
export interface AdminChangeRoleInput {
  role: UserRole
}

/** 停用 / 启用 / 变更角色 / 删除用户成功时的统一结果。 */
export interface AdminUserActionResult {
  success: true
}

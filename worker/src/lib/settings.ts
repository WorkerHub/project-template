/**
 * 站点设置的读写与对外组装（规格 §5.5 / §5.5A / §5.6 / §6.1）。
 *
 * 键名沿用 setup 单播种的那一套（`lib/setup.ts` 的 DEFAULT_SETTINGS），本文件只负责
 * 业务语义与两个对外形状：公开引导端点（`/api/public`）与管理面设置文档
 * （`GET/PUT /api/admin/settings`）。凭据类字段一律只输出 `passwordSet` / `apiKeySet`。
 */
import {
  APP_MODE,
  PROJECT_NAME,
  PROJECT_REPOSITORY_URL,
  PROJECT_TAGLINE
} from "../config/project"
import { isSigningSecretConfigured } from "../core/auth"
import { getSetting, isSetupPageEnabled, setSetting } from "./setup"
import { getTablePrefix } from "./table-prefix"
import { isEmailConfigured, readEmailSettings } from "../services/email"
import type { EmailSettingsView } from "../services/email"
import type { Env } from "../types"

/** 构建信息未注入时的兜底版本号：必须非空、且仍是 `git describe` 的形态。 */
export const UNKNOWN_VERSION = "v0.0.0-0-unknown"

export interface RegistrationSettings {
  enabled: boolean
  approvalRequired: boolean
  emailVerificationRequired: boolean
}

async function getFlag(
  env: Env,
  key: string,
  fallback: boolean
): Promise<boolean> {
  const value = await getSetting(env.DB, getTablePrefix(env), key)
  if (value === null) return fallback
  return value === "true"
}

async function setFlag(env: Env, key: string, value: boolean): Promise<void> {
  await setSetting(env.DB, getTablePrefix(env), key, value ? "true" : "false")
}

export async function readRegistrationSettings(
  env: Env
): Promise<RegistrationSettings> {
  return {
    enabled: await getFlag(env, "registration_enabled", true),
    approvalRequired: await getFlag(
      env,
      "registration_approval_required",
      true
    ),
    emailVerificationRequired: await getFlag(
      env,
      "registration_email_verification_enabled",
      false
    )
  }
}

/**
 * 「注册需邮箱验证」是否**真的能执行**：开关开着、邮件已配置、签名钥也在。
 * 注册与登录都按这个有效值判定，所以 provider 事后被清空也不会把已注册未验证的
 * 用户锁死（规格 §5.6 第 4 条）。开关本身保持原值不动。
 */
export async function emailVerificationEnforced(env: Env): Promise<boolean> {
  const registration = await readRegistrationSettings(env)
  if (!registration.emailVerificationRequired) return false
  if (!isSigningSecretConfigured(env.SIGNING_SECRET)) return false
  return isEmailConfigured(env)
}

export interface RegistrationSettingsPatch {
  enabled?: boolean
  approvalRequired?: boolean
  emailVerificationRequired?: boolean
}

export interface SettingsWriteResult {
  ok: boolean
  error?: string
  code?: "EMAIL_NOT_CONFIGURED" | "MODE_CONFLICT"
}

/** 写注册相关开关；单人档不写（调用方先拦），邮件未配置时不许开启验证。 */
export async function writeRegistrationSettings(
  env: Env,
  patch: RegistrationSettingsPatch
): Promise<SettingsWriteResult> {
  if (APP_MODE !== "multi") {
    return {
      ok: false,
      code: "MODE_CONFLICT",
      error: "Registration is not available in single-user mode"
    }
  }
  if (
    patch.emailVerificationRequired === true &&
    !(await isEmailConfigured(env))
  ) {
    return {
      ok: false,
      code: "EMAIL_NOT_CONFIGURED",
      error:
        "Email delivery is not configured; the verification requirement cannot be enabled"
    }
  }

  if (patch.enabled !== undefined) {
    await setFlag(env, "registration_enabled", patch.enabled)
  }
  if (patch.approvalRequired !== undefined) {
    await setFlag(env, "registration_approval_required", patch.approvalRequired)
  }
  if (patch.emailVerificationRequired !== undefined) {
    await setFlag(
      env,
      "registration_email_verification_enabled",
      patch.emailVerificationRequired
    )
  }
  return { ok: true }
}

/** 公开引导端点：只放公开、非敏感事实，一个请求够前端首屏用。 */
export interface PublicBootstrap {
  name: string
  tagline: string
  repositoryUrl: string
  version: string
  appMode: typeof APP_MODE
  registrationEnabled: boolean
  emailConfigured: boolean
}

export async function buildPublicBootstrap(env: Env): Promise<PublicBootstrap> {
  const registration = await readRegistrationSettings(env)
  return {
    name: PROJECT_NAME,
    tagline: PROJECT_TAGLINE,
    repositoryUrl: PROJECT_REPOSITORY_URL,
    version: (env.APP_VERSION ?? "").trim() || UNKNOWN_VERSION,
    appMode: APP_MODE,
    registrationEnabled: APP_MODE === "multi" && registration.enabled,
    emailConfigured: await isEmailConfigured(env)
  }
}

/** 管理面设置文档：结构化、凭据脱敏；单人档不暴露注册段。 */
export interface AdminSettings {
  appMode: typeof APP_MODE
  tablePrefix: string
  registration: RegistrationSettings | null
  setup: { pageEnabled: boolean }
  email: EmailSettingsView
}

export async function buildAdminSettings(env: Env): Promise<AdminSettings> {
  const prefix = getTablePrefix(env)
  return {
    appMode: APP_MODE,
    tablePrefix: prefix,
    registration:
      APP_MODE === "multi" ? await readRegistrationSettings(env) : null,
    setup: { pageEnabled: await isSetupPageEnabled(env.DB, prefix) },
    email: await readEmailSettings(env)
  }
}

/** setup 页面开关（初始化完成后写关，管理员可重开）。 */
export async function writeSetupPageEnabled(
  env: Env,
  enabled: boolean
): Promise<void> {
  await setSetting(
    env.DB,
    getTablePrefix(env),
    "setup_page_enabled",
    enabled ? "1" : "0"
  )
}

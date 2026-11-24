import { PROJECT_NAME, PROJECT_TAGLINE } from "@worker/config/project"
import type {
  AdminCreateUserResult,
  AdminSettings,
  AdminUser,
  Me,
  PublicInfo,
  SetupState
} from "@/lib/api-types"

export { PROJECT_NAME, PROJECT_TAGLINE }

/** 测试用的 DTO 形状：默认值只覆盖页面关心的字段，用例按需覆盖。 */

export function publicInfo(overrides: Partial<PublicInfo> = {}): PublicInfo {
  return {
    name: PROJECT_NAME,
    tagline: PROJECT_TAGLINE,
    repositoryUrl: "https://example.com/template",
    version: "v1.0.0-0-test",
    appMode: "multi",
    registrationEnabled: true,
    emailConfigured: true,
    ...overrides
  }
}

export function me(overrides: Partial<Me> = {}): Me {
  return {
    id: 1,
    email: "owner@example.com",
    displayName: "Owner",
    role: "admin",
    status: "active",
    emailVerified: true,
    mustChangePassword: false,
    language: "zh",
    timezone: "Asia/Shanghai",
    totpEnabled: false,
    totpLabel: null,
    emailTwoFactorEnabled: false,
    passkeyCount: 0,
    profileLocks: { displayNameLocked: false },
    ...overrides
  }
}

export function setupState(overrides: Partial<SetupState> = {}): SetupState {
  return {
    enabled: true,
    ownerExists: false,
    tablePrefix: "template_",
    ...overrides
  }
}

export function adminSettings(
  overrides: Partial<AdminSettings> = {}
): AdminSettings {
  return {
    registration: {
      enabled: true,
      approvalRequired: true,
      emailVerification: false
    },
    profileLocks: { displayNameLocked: false },
    setupPageEnabled: true,
    tablePrefix: "template_",
    email: {
      provider: "smtp",
      smtp: {
        host: "smtp.example.com",
        port: "587",
        username: "mailer",
        passwordSet: true,
        from: "noreply@example.com",
        fromName: PROJECT_NAME
      },
      resend: { apiKeySet: false, from: "", fromName: "" },
      configured: true
    },
    ...overrides
  }
}

export function adminUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 2,
    email: "user@example.com",
    displayName: "User",
    role: "user",
    status: "active",
    emailVerified: true,
    createdAt: "2026-01-02T03:04:05.000Z",
    ...overrides
  }
}

export function adminCreatedUser(
  overrides: Partial<AdminCreateUserResult> = {}
): AdminCreateUserResult {
  return {
    id: 9,
    email: "new@example.com",
    role: "user",
    status: "active",
    temporaryPassword: "temp-2026",
    ...overrides
  }
}

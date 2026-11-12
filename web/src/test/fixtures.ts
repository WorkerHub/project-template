import type {
  AdminSettings,
  Me,
  PendingUser,
  PublicInfo,
  SetupState
} from "@/lib/api-types"

/** 测试用的 DTO 形状：默认值只覆盖页面关心的字段，用例按需覆盖。 */

export function publicInfo(overrides: Partial<PublicInfo> = {}): PublicInfo {
  return {
    name: "Template",
    tagline: "A thin WorkerHub skeleton",
    repositoryUrl: "https://example.com/template",
    version: "v0.0.0-0-test",
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
    language: "zh",
    theme: "system",
    timezone: "Asia/Shanghai",
    totpEnabled: false,
    passkeyCount: 0,
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
        fromName: "Template"
      },
      resend: { apiKeySet: false, from: "", fromName: "" },
      configured: true
    },
    ...overrides
  }
}

export function pendingUser(overrides: Partial<PendingUser> = {}): PendingUser {
  return {
    id: 2,
    email: "pending@example.com",
    displayName: "Pending",
    createdAt: "2026-01-02T03:04:05.000Z",
    ...overrides
  }
}

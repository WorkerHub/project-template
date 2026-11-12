/**
 * WebAuthn（Passkey）浏览器侧封装：直接用 `@simplewebauthn/browser`，
 * 不手搓 navigator.credentials 的编解码。
 *
 * 后端的 options 端点是 WebAuthn 的 JSON 形态（challenge / allowCredentials
 * 等是 base64url 字符串），正好是 `startAuthentication` / `startRegistration`
 * 的 optionsJSON 入参；也兼容外面再包一层 `options` 或 `publicKey`。
 */
import {
  type AuthenticationResponseJSON,
  browserSupportsWebAuthn,
  type RegistrationResponseJSON,
  startAuthentication,
  startRegistration
} from "@simplewebauthn/browser"

type JsonRecord = Record<string, unknown>

function unwrapOptions(raw: JsonRecord): JsonRecord {
  const candidate = (raw.options ?? raw.publicKey ?? raw) as
    | JsonRecord
    | undefined
  if (!candidate || typeof candidate.challenge !== "string") {
    throw new Error("Missing WebAuthn challenge")
  }
  return candidate
}

/** 浏览器是否支持 Passkey；不支持时设置页与登录页不渲染入口。 */
export function webauthnSupported(): boolean {
  return typeof window !== "undefined" && browserSupportsWebAuthn()
}

export function authenticationCredential(
  raw: JsonRecord
): Promise<AuthenticationResponseJSON> {
  return startAuthentication({ optionsJSON: unwrapOptions(raw) as never })
}

export function registrationCredential(
  raw: JsonRecord
): Promise<RegistrationResponseJSON> {
  return startRegistration({ optionsJSON: unwrapOptions(raw) as never })
}

/** 用户取消（点了取消/超时）不是错误，不该弹红条。 */
export function isWebAuthnCancelled(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name
  return name === "NotAllowedError" || name === "AbortError"
}

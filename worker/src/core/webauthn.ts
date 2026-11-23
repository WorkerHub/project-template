/**
 * 通行密钥（WebAuthn）的唯一封装：把 `@simplewebauthn/server` 的四个调用与
 * 「挑战放哪」收在一处，路由只做鉴权与落库。
 *
 * 挑战不用表也不用 KV：它只在两次请求之间活 5 分钟，放一个 HttpOnly 签名 Cookie
 * （Hono 原生 `setSignedCookie`，密钥 `SIGNING_SECRET`）即可，且表单加路径限定到
 * `/api`。规格没有为本项目分配 KV，也不许新增表。
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse as verifyAuthenticationResponseLib,
  verifyRegistrationResponse as verifyRegistrationResponseLib
} from "@simplewebauthn/server"
import { isoBase64URL, isoUint8Array } from "@simplewebauthn/server/helpers"
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie"
import type { Context } from "hono"
import { PROJECT_NAME } from "../config/project"
import type { HonoEnv } from "../types"

export const PASSKEY_CHALLENGE_COOKIE = "passkey_challenge"

const CHALLENGE_TTL_SECONDS = 300

export type ChallengePurpose = "register" | "authenticate" | "login"

export interface RelyingParty {
  rpID: string
  origin: string
}

/** WebAuthn 的 rpID/origin 就是当前站点的 host 与 origin，不额外配置。 */
export function relyingParty(c: Context<HonoEnv>): RelyingParty {
  const url = new URL(c.req.url)
  return { rpID: url.hostname, origin: url.origin }
}

export async function setChallengeCookie(
  c: Context<HonoEnv>,
  secret: string,
  challenge: string,
  purpose: ChallengePurpose
): Promise<void> {
  const payload = JSON.stringify({
    challenge,
    purpose,
    exp: Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SECONDS
  })
  await setSignedCookie(c, PASSKEY_CHALLENGE_COOKIE, payload, secret, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/api",
    maxAge: CHALLENGE_TTL_SECONDS
  })
}

export async function readChallengeCookie(
  c: Context<HonoEnv>,
  secret: string,
  purpose: ChallengePurpose
): Promise<string | null> {
  const raw = await getSignedCookie(c, secret, PASSKEY_CHALLENGE_COOKIE)
  if (typeof raw !== "string") return null
  try {
    const payload = JSON.parse(raw) as {
      challenge?: unknown
      purpose?: unknown
      exp?: unknown
    }
    if (payload.purpose !== purpose) return null
    if (typeof payload.exp !== "number") return null
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null
    return typeof payload.challenge === "string" ? payload.challenge : null
  } catch {
    return null
  }
}

export function clearChallengeCookie(c: Context<HonoEnv>): void {
  deleteCookie(c, PASSKEY_CHALLENGE_COOKIE, { path: "/api" })
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export interface CredentialDescriptor {
  id: string
  publicKey: string
  counter: number
}

export interface RegistrationCredential {
  id: string
  /** base64（标准字母表）编码的公钥，库里只存这个。 */
  publicKey: string
  counter: number
  transports: string[]
}

export type VerifyFailureReason = "challenge_mismatch" | "verification_failed"

export type VerifyRegistrationResult =
  | { verified: true; credential: RegistrationCredential }
  | { verified: false; reason: VerifyFailureReason }

export type VerifyAuthenticationResult =
  | { verified: true; newCounter: number }
  | { verified: false; reason: VerifyFailureReason }

export function isChallengeMismatchError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    return (
      msg.includes("response challenge") ||
      (msg.includes("challenge") &&
        (msg.includes("expected") ||
          msg.includes("mismatch") ||
          msg.includes("not equal")))
    )
  }
  return false
}

/** 注册选项：排除已注册凭据，避免同一认证器重复登记。 */
export async function createRegistrationOptions(input: {
  rp: RelyingParty
  userName: string
  userDisplayName: string
  userId?: number
  excludeCredentialIds: string[]
}): Promise<Awaited<ReturnType<typeof generateRegistrationOptions>>> {
  return generateRegistrationOptions({
    rpName: PROJECT_NAME,
    rpID: input.rp.rpID,
    userName: input.userName,
    userID:
      input.userId !== undefined
        ? isoUint8Array.fromUTF8String(String(input.userId))
        : undefined,
    userDisplayName: input.userDisplayName || input.userName,
    attestationType: "none",
    excludeCredentials: input.excludeCredentialIds.map((id) => ({
      id,
      type: "public-key" as const
    })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required"
    }
  })
}

export async function verifyRegistration(input: {
  response: unknown
  expectedChallenge: string
  rp: RelyingParty
}): Promise<VerifyRegistrationResult> {
  try {
    const result = await verifyRegistrationResponseLib({
      response: input.response as Parameters<
        typeof verifyRegistrationResponseLib
      >[0]["response"],
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: input.rp.origin,
      expectedRPID: input.rp.rpID,
      requireUserVerification: true
    })
    if (!result.verified) {
      return { verified: false, reason: "verification_failed" }
    }
    const credential = result.registrationInfo.credential
    return {
      verified: true,
      credential: {
        id: credential.id,
        publicKey: bytesToBase64(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ?? []
      }
    }
  } catch (err) {
    if (isChallengeMismatchError(err)) {
      return { verified: false, reason: "challenge_mismatch" }
    }
    return { verified: false, reason: "verification_failed" }
  }
}

/** 断言选项：支持第二因子（带 allowCredentialIds）与直接登录（留空 allowCredentialIds，UV required）。 */
export async function createAuthenticationOptions(input: {
  rp: RelyingParty
  allowCredentialIds?: string[]
  userVerification?: "required" | "preferred" | "discouraged"
}): Promise<Awaited<ReturnType<typeof generateAuthenticationOptions>>> {
  return generateAuthenticationOptions({
    rpID: input.rp.rpID,
    allowCredentials: input.allowCredentialIds
      ? input.allowCredentialIds.map((id) => ({
          id,
          type: "public-key" as const
        }))
      : undefined,
    userVerification: input.userVerification ?? "preferred"
  })
}

export async function verifyAuthentication(input: {
  response: unknown
  expectedChallenge: string
  rp: RelyingParty
  credential: CredentialDescriptor
  requireUserVerification?: boolean
}): Promise<VerifyAuthenticationResult> {
  try {
    const result = await verifyAuthenticationResponseLib({
      response: input.response as Parameters<
        typeof verifyAuthenticationResponseLib
      >[0]["response"],
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: input.rp.origin,
      expectedRPID: input.rp.rpID,
      credential: {
        id: input.credential.id,
        publicKey: base64ToBytes(input.credential.publicKey),
        counter: input.credential.counter
      },
      requireUserVerification: input.requireUserVerification ?? false
    })
    if (!result.verified) {
      return { verified: false, reason: "verification_failed" }
    }
    return { verified: true, newCounter: result.authenticationInfo.newCounter }
  } catch (err) {
    if (isChallengeMismatchError(err)) {
      return { verified: false, reason: "challenge_mismatch" }
    }
    return { verified: false, reason: "verification_failed" }
  }
}

/**
 * 解析认证断言中的 userHandle（可发现凭证中通常为用户主键 UTF-8 字节的 base64url 编码）。
 */
export function parseUserHandle(userHandle: unknown): string | null {
  if (userHandle instanceof Uint8Array) {
    try {
      return new TextDecoder().decode(userHandle)
    } catch {
      return null
    }
  }
  if (typeof userHandle !== "string" || !userHandle.trim()) {
    return null
  }
  const trimmed = userHandle.trim()
  try {
    const text = isoBase64URL.toUTF8String(trimmed)
    if (text && !text.includes("\uFFFD")) {
      return text
    }
  } catch {}
  return trimmed || null
}

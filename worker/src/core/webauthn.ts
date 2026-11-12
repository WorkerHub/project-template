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
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie"
import type { Context } from "hono"
import { PROJECT_NAME } from "../config/project"
import type { HonoEnv } from "../types"

export const PASSKEY_CHALLENGE_COOKIE = "passkey_challenge"

const CHALLENGE_TTL_SECONDS = 300

export type ChallengePurpose = "register" | "authenticate"

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

/** 注册选项：排除已注册凭据，避免同一认证器重复登记。 */
export async function createRegistrationOptions(input: {
  rp: RelyingParty
  userName: string
  userDisplayName: string
  excludeCredentialIds: string[]
}): Promise<Awaited<ReturnType<typeof generateRegistrationOptions>>> {
  return generateRegistrationOptions({
    rpName: PROJECT_NAME,
    rpID: input.rp.rpID,
    userName: input.userName,
    userDisplayName: input.userDisplayName || input.userName,
    attestationType: "none",
    excludeCredentials: input.excludeCredentialIds.map((id) => ({
      id,
      type: "public-key" as const
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred"
    }
  })
}

export async function verifyRegistration(input: {
  response: unknown
  expectedChallenge: string
  rp: RelyingParty
}): Promise<
  { verified: true; credential: RegistrationCredential } | { verified: false }
> {
  const result = await verifyRegistrationResponseLib({
    response: input.response as Parameters<
      typeof verifyRegistrationResponseLib
    >[0]["response"],
    expectedChallenge: input.expectedChallenge,
    expectedOrigin: input.rp.origin,
    expectedRPID: input.rp.rpID,
    requireUserVerification: false
  })
  if (!result.verified) return { verified: false }
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
}

/** 断言选项：只允许该用户已登记的凭据。 */
export async function createAuthenticationOptions(input: {
  rp: RelyingParty
  allowCredentialIds: string[]
}): Promise<Awaited<ReturnType<typeof generateAuthenticationOptions>>> {
  return generateAuthenticationOptions({
    rpID: input.rp.rpID,
    allowCredentials: input.allowCredentialIds.map((id) => ({
      id,
      type: "public-key" as const
    })),
    userVerification: "preferred"
  })
}

export async function verifyAuthentication(input: {
  response: unknown
  expectedChallenge: string
  rp: RelyingParty
  credential: CredentialDescriptor
}): Promise<{ verified: true; newCounter: number } | { verified: false }> {
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
    requireUserVerification: false
  })
  if (!result.verified) return { verified: false }
  return { verified: true, newCounter: result.authenticationInfo.newCounter }
}

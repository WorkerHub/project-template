/**
 * 邮件验证码的唯一服务（规格 §5.6 第 1 条）：注册邮箱验证与找回密码共用同一份
 * 规矩与同一张表 `email_verification_codes`，不各写一套。
 *
 * 6 位数字；库里只存 HMAC-SHA256（密钥 `SIGNING_SECRET`，见 core/auth.ts），
 * 不是裸哈希——6 位码熵低，裸哈希库被读即可枚举。有效期 10 分钟、单码最多 5 次
 * 尝试、单次使用；发放新码时同邮箱同用途的旧码一律置失效。60 秒重发冷却与按 IP
 * 限流都走计数表，与登录限流同一套机制。
 */
import { hmacSignatureHex, safeEqual } from "./auth"
import { enforceRateLimit, type RateLimitVerdict } from "./rate-limit"
import { getTablePrefix } from "../lib/table-prefix"
import { emailCodesTable } from "../lib/tables"
import type { Env } from "../types"

export type CodePurpose = "register_verify" | "password_reset"

export const CODE_TTL_SECONDS = 10 * 60
export const CODE_MAX_ATTEMPTS = 5
export const CODE_RESEND_COOLDOWN_SECONDS = 60

export interface IssuedCode {
  code: string
  expiresAt: number
}

export type CodeFailureReason =
  | "missing"
  | "expired"
  | "too_many_attempts"
  | "mismatch"

export type CodeVerification =
  | { ok: true }
  | { ok: false; reason: CodeFailureReason }

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function requireSigningSecret(env: Env): string {
  const secret = env.SIGNING_SECRET
  if (typeof secret !== "string" || secret.trim().length === 0) {
    throw new Error("SIGNING_SECRET is not configured")
  }
  return secret
}

async function hashCode(
  secret: string,
  purpose: CodePurpose,
  email: string,
  code: string
): Promise<string> {
  return hmacSignatureHex(secret, `${purpose}:${email}:${code}`)
}

function randomCode(): string {
  const buffer = new Uint32Array(1)
  crypto.getRandomValues(buffer)
  return String(100_000 + (buffer[0] % 900_000))
}

/**
 * 发放验证码：作废旧码、写新行、返回明文码（只进邮件，不落库、不回接口）。
 * 调用方负责冷却/限流与邮件发送。
 */
export async function issueVerificationCode(
  env: Env,
  input: { email: string; purpose: CodePurpose },
  now = nowSeconds()
): Promise<IssuedCode> {
  const secret = requireSigningSecret(env)
  const prefix = getTablePrefix(env)
  const table = emailCodesTable(prefix)
  const code = randomCode()
  const expiresAt = now + CODE_TTL_SECONDS
  const codeHash = await hashCode(secret, input.purpose, input.email, code)

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE ${table} SET used_at = ?
        WHERE email = ? AND purpose = ? AND used_at IS NULL`
    ).bind(now, input.email, input.purpose),
    env.DB.prepare(
      `DELETE FROM ${table} WHERE email = ? AND purpose = ? AND expires_at <= ?`
    ).bind(input.email, input.purpose, now),
    env.DB.prepare(
      `INSERT INTO ${table}
        (email, purpose, code_hash, expires_at, attempts, used_at, created_at)
       VALUES (?, ?, ?, ?, 0, NULL, ?)`
    ).bind(input.email, input.purpose, codeHash, expiresAt, now)
  ])

  return { code, expiresAt }
}

/**
 * 校验验证码。错码累加尝试次数（达到上限即作废），对码则一次性核销。
 * 不区分「过期 / 次数用尽 / 不存在」——调用方统一回同一个错误码，防枚举。
 */
export async function verifyVerificationCode(
  env: Env,
  input: { email: string; purpose: CodePurpose; code: string },
  now = nowSeconds()
): Promise<CodeVerification> {
  const secret = requireSigningSecret(env)
  const prefix = getTablePrefix(env)
  const table = emailCodesTable(prefix)
  const row = await env.DB.prepare(
    `SELECT id, code_hash, expires_at, attempts, used_at
       FROM ${table}
      WHERE email = ? AND purpose = ?
      ORDER BY id DESC LIMIT 1`
  )
    .bind(input.email, input.purpose)
    .first<{
      id: number
      code_hash: string
      expires_at: number
      attempts: number
      used_at: number | null
    }>()

  if (!row || row.used_at !== null) return { ok: false, reason: "missing" }
  if (row.expires_at <= now) return { ok: false, reason: "expired" }
  if (row.attempts >= CODE_MAX_ATTEMPTS) {
    return { ok: false, reason: "too_many_attempts" }
  }

  const candidate = await hashCode(
    secret,
    input.purpose,
    input.email,
    input.code
  )
  if (!(await safeEqual(candidate, row.code_hash))) {
    await env.DB.prepare(
      `UPDATE ${table} SET attempts = attempts + 1
        WHERE id = ? AND used_at IS NULL AND attempts < ?`
    )
      .bind(row.id, CODE_MAX_ATTEMPTS)
      .run()
    return { ok: false, reason: "mismatch" }
  }

  // 单次使用：只有把 used_at 从 NULL 改成时间的那一次算成功（并发下只有一条）。
  const consumed = await env.DB.prepare(
    `UPDATE ${table} SET used_at = ?
      WHERE id = ? AND used_at IS NULL AND attempts < ?`
  )
    .bind(now, row.id, CODE_MAX_ATTEMPTS)
    .run()
  if (consumed.meta.changes !== 1) return { ok: false, reason: "mismatch" }
  return { ok: true }
}

/** 60 秒重发冷却（按邮箱 + 用途）；在账号查询之前调用，避免枚举。 */
export async function checkResendCooldown(
  env: Env,
  input: { email: string; purpose: CodePurpose },
  now = nowSeconds()
): Promise<RateLimitVerdict> {
  return enforceRateLimit(
    env.DB,
    getTablePrefix(env),
    {
      action: `code_cooldown:${input.purpose}`,
      account: input.email,
      windowSeconds: CODE_RESEND_COOLDOWN_SECONDS,
      max: 1
    },
    now
  )
}

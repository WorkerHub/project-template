/**
 * 两步登录的 tempToken（规格 §5.4 / §5B 的两步呈现）。
 *
 * 密码核验通过后若还有第二因子，登录响应带一个 5 分钟签名令牌；校验第二因子的
 * 端点凭它认人。刻意不用服务端会话：规格只要求会话 Cookie，其余不新增表、不新增
 * 资源。代价是它不在 HttpOnly 里，所以只承载用户 id 与过期时间，且用后作废
 * （单次使用由 core/counters.ts 的 stepup_used 计数判定，见路由）。
 *
 * 签名钥是 SIGNING_SECRET，与 setup 密钥分开（绝不复用 SETUP_SECRET）。
 */
import { hmacSignatureHex, safeEqual } from "./auth"

const encoder = new TextEncoder()

export const TEMP_TOKEN_TTL_SECONDS = 300

export interface TempTokenPayload {
  /** 令牌用途，防止与其它签名物互串。 */
  typ: "2fa"
  /** 用户 id（库内 INTEGER 主键）。 */
  sub: number
  /** 一次性标识：单次使用判定按它计数。 */
  jti: string
  /** 过期时刻（epoch 秒）。 */
  exp: number
}

function base64urlEncode(value: string): string {
  const bytes = encoder.encode(value)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function base64urlDecode(value: string): string | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    const rest = padded.length % 4
    return atob(rest ? padded + "=".repeat(4 - rest) : padded)
  } catch {
    return null
  }
}

export async function signTempToken(
  userId: number,
  secret: string,
  ttlSeconds = TEMP_TOKEN_TTL_SECONDS,
  now = Math.floor(Date.now() / 1000)
): Promise<string> {
  const payload: TempTokenPayload = {
    typ: "2fa",
    sub: userId,
    jti: crypto.randomUUID(),
    exp: now + ttlSeconds
  }
  const encoded = base64urlEncode(JSON.stringify(payload))
  return `${encoded}.${await hmacSignatureHex(secret, encoded)}`
}

export async function verifyTempToken(
  token: unknown,
  secret: string,
  now = Math.floor(Date.now() / 1000)
): Promise<TempTokenPayload | null> {
  if (typeof token !== "string" || token.length === 0) return null
  const parts = token.split(".")
  if (parts.length !== 2) return null
  const [encoded, signature] = parts
  if (!encoded || !signature) return null

  const expected = await hmacSignatureHex(secret, encoded)
  if (!(await safeEqual(signature, expected))) return null

  const decoded = base64urlDecode(encoded)
  if (!decoded) return null
  let payload: unknown
  try {
    payload = JSON.parse(decoded)
  } catch {
    return null
  }
  if (typeof payload !== "object" || payload === null) return null
  const candidate = payload as Partial<TempTokenPayload>
  if (candidate.typ !== "2fa") return null
  if (typeof candidate.sub !== "number" || !Number.isInteger(candidate.sub)) {
    return null
  }
  if (typeof candidate.jti !== "string" || candidate.jti.length === 0) {
    return null
  }
  if (typeof candidate.exp !== "number" || candidate.exp <= now) return null
  return {
    typ: "2fa",
    sub: candidate.sub,
    jti: candidate.jti,
    exp: candidate.exp
  }
}

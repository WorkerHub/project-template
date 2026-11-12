/**
 * TOTP（RFC 6238）：用 `otpauth` 依赖，不手写 base32/HMAC。
 *
 * 参数固定 SHA1 / 6 位 / 30 秒，校验窗口 ±1 个步长（容忍客户端时钟偏差），与
 * eNotify 现行实现同口径；密钥本身只存 `user_2fa.totp_secret`，接口只在 setup
 * 那一次把它交还给用户。
 */
import { TOTP } from "otpauth"
import { PROJECT_NAME } from "../config/project"

const PERIOD_SECONDS = 30
const DIGITS = 6
const WINDOW = 1

function buildTotp(secret?: string, label = "user"): TOTP {
  return new TOTP({
    issuer: PROJECT_NAME,
    label,
    algorithm: "SHA1",
    digits: DIGITS,
    period: PERIOD_SECONDS,
    ...(secret ? { secret } : {})
  })
}

/** 新密钥（不传 secret 时 otpauth 自己生成 20 字节随机密钥）。 */
export function generateTotpSecret(email: string): {
  secret: string
  uri: string
} {
  const totp = buildTotp(undefined, email)
  return { secret: totp.secret.base32, uri: totp.toString() }
}

/** 当前时间步（epoch 秒 / 30）。 */
export function currentTotpStep(nowMs = Date.now()): number {
  return TOTP.counter({ period: PERIOD_SECONDS, timestamp: nowMs })
}

/**
 * 校验验证码，成功返回命中的绝对步长（用于重放判定），失败返回 null。
 */
export function verifyTotpCode(
  secret: string,
  code: string,
  nowMs = Date.now()
): number | null {
  const token = code.trim()
  if (!/^\d{6}$/.test(token)) return null
  const delta = buildTotp(secret).validate({ token, window: WINDOW })
  if (delta === null) return null
  return currentTotpStep(nowMs) + delta
}

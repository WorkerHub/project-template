/**
 * `user_2fa` 的读写：TOTP 状态。密钥列只在该用户自己的 setup 响应里出现一次，
 * 其余任何 DTO 都不返回它。
 */
import { user2faTable } from "../../lib/tables"

export interface TwoFactorRow {
  user_id: number
  totp_secret: string | null
  totp_enabled: number
  updated_at: string
}

export async function getTwoFactor(
  db: D1Database,
  prefix: string,
  userId: number
): Promise<TwoFactorRow | null> {
  return db
    .prepare(
      `SELECT user_id, totp_secret, totp_enabled, updated_at
         FROM ${user2faTable(prefix)} WHERE user_id = ?`
    )
    .bind(userId)
    .first<TwoFactorRow>()
}

export async function upsertTwoFactor(
  db: D1Database,
  prefix: string,
  userId: number,
  patch: { totpSecret?: string | null; totpEnabled: number }
): Promise<void> {
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO ${user2faTable(prefix)} (user_id, totp_secret, totp_enabled, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         totp_secret = excluded.totp_secret,
         totp_enabled = excluded.totp_enabled,
         updated_at = excluded.updated_at`
    )
    .bind(userId, patch.totpSecret ?? null, patch.totpEnabled, now)
    .run()
}

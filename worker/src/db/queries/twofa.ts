/**
 * `user_2fa` 的读写：TOTP 状态。密钥列只在该用户自己的 setup 响应里出现一次，
 * 其余任何 DTO 都不返回它。
 */
import { user2faTable } from "../../lib/tables"

export interface TwoFactorRow {
  user_id: number
  totp_secret: string | null
  totp_enabled: number
  email_2fa_enabled: number
  totp_label: string | null
  updated_at: string
}

export async function getTwoFactor(
  db: D1Database,
  prefix: string,
  userId: number
): Promise<TwoFactorRow | null> {
  return db
    .prepare(
      `SELECT user_id, totp_secret, totp_enabled, email_2fa_enabled, totp_label, updated_at
         FROM ${user2faTable(prefix)} WHERE user_id = ?`
    )
    .bind(userId)
    .first<TwoFactorRow>()
}

export async function upsertTwoFactor(
  db: D1Database,
  prefix: string,
  userId: number,
  patch: {
    totpSecret?: string | null
    totpEnabled: number
    totpLabel?: string | null
  }
): Promise<void> {
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO ${user2faTable(prefix)} (user_id, totp_secret, totp_enabled, totp_label, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         totp_secret = excluded.totp_secret,
         totp_enabled = excluded.totp_enabled,
         totp_label = excluded.totp_label,
         updated_at = excluded.updated_at`
    )
    .bind(
      userId,
      patch.totpSecret ?? null,
      patch.totpEnabled,
      patch.totpLabel ?? null,
      now
    )
    .run()
}

export async function updateTotpLabel(
  db: D1Database,
  prefix: string,
  userId: number,
  label: string | null
): Promise<void> {
  const now = new Date().toISOString()
  await db
    .prepare(
      `UPDATE ${user2faTable(prefix)}
          SET totp_label = ?, updated_at = ?
        WHERE user_id = ? AND totp_enabled = 1`
    )
    .bind(label, now, userId)
    .run()
}

/** 开关邮箱第二因子；冲突分支只动 email 标志与更新时间，不碰 TOTP 字段。 */
export async function setEmailTwoFactorEnabled(
  db: D1Database,
  prefix: string,
  userId: number,
  enabled: boolean
): Promise<void> {
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO ${user2faTable(prefix)} (user_id, totp_secret, totp_enabled, email_2fa_enabled, updated_at)
       VALUES (?, NULL, 0, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         email_2fa_enabled = excluded.email_2fa_enabled,
         updated_at = excluded.updated_at`
    )
    .bind(userId, enabled ? 1 : 0, now)
    .run()
}

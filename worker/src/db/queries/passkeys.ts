/**
 * 通行密钥凭据的读写（表 `passkey_credentials`，结构对齐 eNotify）。
 *
 * 公钥与 credential_id 只进数据库、不进任何面向用户的 DTO；列表接口只暴露
 * id / 创建时间 / 最近使用时间 / transports，供设置页展示与删除。
 */
import { passkeysTable } from "../../lib/tables"

export interface PasskeyRow {
  id: number
  user_id: number
  credential_id: string
  public_key: string
  counter: number
  transports: string
  created_at: string
  last_used_at: string | null
}

export interface PasskeyView {
  id: number
  createdAt: string
  lastUsedAt: string | null
  transports: string[]
}

function toView(row: PasskeyRow): PasskeyView {
  return {
    id: row.id,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    transports: row.transports
      ? row.transports
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : []
  }
}

export async function listPasskeys(
  db: D1Database,
  prefix: string,
  userId: number
): Promise<PasskeyRow[]> {
  const rows = await db
    .prepare(
      `SELECT id, user_id, credential_id, public_key, counter, transports,
              created_at, last_used_at
         FROM ${passkeysTable(prefix)}
        WHERE user_id = ?
        ORDER BY id ASC`
    )
    .bind(userId)
    .all<PasskeyRow>()
  return rows.results
}

export async function listPasskeyViews(
  db: D1Database,
  prefix: string,
  userId: number
): Promise<PasskeyView[]> {
  return (await listPasskeys(db, prefix, userId)).map(toView)
}

export async function countPasskeys(
  db: D1Database,
  prefix: string,
  userId: number
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total FROM ${passkeysTable(prefix)} WHERE user_id = ?`
    )
    .bind(userId)
    .first<{ total: number }>()
  return Number(row?.total ?? 0)
}

export async function findPasskeyByCredentialId(
  db: D1Database,
  prefix: string,
  userId: number,
  credentialId: string
): Promise<PasskeyRow | null> {
  return db
    .prepare(
      `SELECT id, user_id, credential_id, public_key, counter, transports,
              created_at, last_used_at
         FROM ${passkeysTable(prefix)}
        WHERE user_id = ? AND credential_id = ?`
    )
    .bind(userId, credentialId)
    .first<PasskeyRow>()
}

export async function insertPasskey(
  db: D1Database,
  prefix: string,
  input: {
    userId: number
    credentialId: string
    publicKey: string
    counter: number
    transports: string[]
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ${passkeysTable(prefix)}
        (user_id, credential_id, public_key, counter, transports, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`
    )
    .bind(
      input.userId,
      input.credentialId,
      input.publicKey,
      input.counter,
      input.transports.join(","),
      new Date().toISOString()
    )
    .run()
}

/** 记一次成功断言：更新签名计数器与最近使用时间（防重放）。 */
export async function touchPasskey(
  db: D1Database,
  prefix: string,
  id: number,
  counter: number
): Promise<void> {
  await db
    .prepare(
      `UPDATE ${passkeysTable(prefix)}
          SET counter = ?, last_used_at = ?
        WHERE id = ?`
    )
    .bind(counter, new Date().toISOString(), id)
    .run()
}

export async function deletePasskey(
  db: D1Database,
  prefix: string,
  userId: number,
  id: number
): Promise<boolean> {
  const result = await db
    .prepare(
      `DELETE FROM ${passkeysTable(prefix)} WHERE id = ? AND user_id = ?`
    )
    .bind(id, userId)
    .run()
  return result.meta.changes === 1
}

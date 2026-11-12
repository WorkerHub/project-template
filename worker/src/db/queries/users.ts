/**
 * 用户的 SQL 读写（表名一律经 `lib/tables.ts` 拼前缀）。
 *
 * 注册用一条 `INSERT … SELECT` 原子地算出「是否首个用户」：首个用户必须是
 * admin + active + 已验证，之后才按开关决定待批准/待验证。这样两个并发首注册
 * 不会各建一个管理员（SQLite 在一条语句里判 `NOT EXISTS`）。
 */
import { emailCodesTable, usersTable } from "../../lib/tables"

export type UserStatus = "pending" | "active" | "disabled"
export type UserRole = "admin" | "user"

export interface UserRow {
  id: number
  email: string
  password_hash: string
  role: UserRole
  status: UserStatus
  email_verified: number
  language: string
  display_name: string
  timezone: string
  theme: string
  created_at: string
  updated_at: string
}

const USER_COLUMNS = `id, email, password_hash, role, status, email_verified, language,
  display_name, timezone, theme, created_at, updated_at`

export async function findUserByEmail(
  db: D1Database,
  prefix: string,
  email: string
): Promise<UserRow | null> {
  return db
    .prepare(
      `SELECT ${USER_COLUMNS} FROM ${usersTable(prefix)} WHERE email = ?`
    )
    .bind(email)
    .first<UserRow>()
}

export async function findUserById(
  db: D1Database,
  prefix: string,
  id: number
): Promise<UserRow | null> {
  return db
    .prepare(`SELECT ${USER_COLUMNS} FROM ${usersTable(prefix)} WHERE id = ?`)
    .bind(id)
    .first<UserRow>()
}

export interface NewUserInput {
  email: string
  passwordHash: string
  language: string
  approvalRequired: boolean
  /** 是否要求邮箱验证（只对非首个用户生效；首个管理员永远直接已验证）。 */
  emailVerificationRequired: boolean
}

/** 注册写入：一条语句决定角色/状态/是否已验证，随后读回整行。 */
export async function insertRegisteredUser(
  db: D1Database,
  prefix: string,
  input: NewUserInput
): Promise<UserRow> {
  const table = usersTable(prefix)
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO ${table}
        (email, password_hash, role, status, email_verified, language,
         display_name, timezone, theme, created_at, updated_at)
       SELECT ?, ?,
         CASE WHEN NOT EXISTS (SELECT 1 FROM ${table}) THEN 'admin' ELSE 'user' END,
         CASE WHEN NOT EXISTS (SELECT 1 FROM ${table}) THEN 'active'
              WHEN ? = 1 THEN 'pending' ELSE 'active' END,
         CASE WHEN NOT EXISTS (SELECT 1 FROM ${table}) THEN 1
              WHEN ? = 1 THEN 0 ELSE 1 END,
         ?, '', 'Asia/Shanghai', 'system', ?, ?`
    )
    .bind(
      input.email,
      input.passwordHash,
      input.approvalRequired ? 1 : 0,
      input.emailVerificationRequired ? 1 : 0,
      input.language,
      now,
      now
    )
    .run()

  const user = await findUserByEmail(db, prefix, input.email)
  if (!user) throw new Error("registered user row missing after insert")
  return user
}

const UPDATABLE_FIELDS = [
  "password_hash",
  "role",
  "status",
  "email_verified",
  "language",
  "display_name",
  "timezone",
  "theme"
] as const

export type UpdatableField = (typeof UPDATABLE_FIELDS)[number]

/** 白名单字段更新；未列出的键直接忽略（不拼进 SQL）。 */
export async function updateUserFields(
  db: D1Database,
  prefix: string,
  id: number,
  patch: Partial<Record<UpdatableField, string | number>>
): Promise<void> {
  const assignments: string[] = []
  const values: Array<string | number> = []
  for (const field of UPDATABLE_FIELDS) {
    const value = patch[field]
    if (value === undefined) continue
    assignments.push(`${field} = ?`)
    values.push(value)
  }
  if (assignments.length === 0) return
  assignments.push("updated_at = ?")
  values.push(new Date().toISOString())
  await db
    .prepare(
      `UPDATE ${usersTable(prefix)} SET ${assignments.join(", ")} WHERE id = ?`
    )
    .bind(...values, id)
    .run()
}

export interface PendingUserView {
  id: number
  email: string
  displayName: string
  language: string
  createdAt: string
}

export async function listPendingUsers(
  db: D1Database,
  prefix: string
): Promise<PendingUserView[]> {
  const rows = await db
    .prepare(
      `SELECT id, email, display_name, language, created_at
         FROM ${usersTable(prefix)}
        WHERE status = 'pending'
        ORDER BY id ASC`
    )
    .all<{
      id: number
      email: string
      display_name: string
      language: string
      created_at: string
    }>()
  return rows.results.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    language: row.language,
    createdAt: row.created_at
  }))
}

/** 批准待批准用户；不是 pending 时返回 false（路由据此回 409）。 */
export async function approveUser(
  db: D1Database,
  prefix: string,
  id: number
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE ${usersTable(prefix)}
          SET status = 'active', updated_at = ?
        WHERE id = ? AND status = 'pending'`
    )
    .bind(new Date().toISOString(), id)
    .run()
  return result.meta.changes === 1
}

/**
 * 拒绝待批准用户 = 删除该行与该邮箱的验证码。
 * 只有 pending 行可删（已启用账号不接受「拒绝」语义）；否则返回 false。
 */
export async function deletePendingUser(
  db: D1Database,
  prefix: string,
  id: number
): Promise<boolean> {
  const user = await findUserById(db, prefix, id)
  if (user?.status !== "pending") return false
  const results = await db.batch([
    db
      .prepare(`DELETE FROM ${emailCodesTable(prefix)} WHERE email = ?`)
      .bind(user.email),
    db
      .prepare(
        `DELETE FROM ${usersTable(prefix)} WHERE id = ? AND status = 'pending'`
      )
      .bind(id)
  ])
  return results[1]?.meta.changes === 1
}

/** 是否已有可用的管理员（单人档建所有者时防重复）。 */
export async function activeAdminExists(
  db: D1Database,
  prefix: string
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM ${usersTable(prefix)}
        WHERE role = 'admin' AND status = 'active' LIMIT 1`
    )
    .first<{ ok: number }>()
  return row !== null
}

/**
 * 单人档的所有者：直接写 admin + active + 已验证（规格 §6.4 的「setup 同页建唯一
 * 所有者」）。调用方先确认库里还没有可用管理员。
 */
export async function insertOwner(
  db: D1Database,
  prefix: string,
  input: { email: string; passwordHash: string; language: string }
): Promise<UserRow> {
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO ${usersTable(prefix)}
        (email, password_hash, role, status, email_verified, language,
         display_name, timezone, theme, created_at, updated_at)
       VALUES (?, ?, 'admin', 'active', 1, ?, '', 'Asia/Shanghai', 'system', ?, ?)`
    )
    .bind(input.email, input.passwordHash, input.language, now, now)
    .run()

  const user = await findUserByEmail(db, prefix, input.email)
  if (!user) throw new Error("owner row missing after insert")
  return user
}

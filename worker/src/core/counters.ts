/**
 * 限流 / 连续失败锁定的唯一权威（规格 §5.2 的 auth_counters 表）：D1 计数表，
 * 按「动作 + 账号 + IP」以单条 UPSERT 原子自增。
 *
 * 为什么不是进程内计数：多副本 / 重启后计数就失效，setup 密钥面与登录面都能被
 * 绕过——那是近似限流，不是限流。为什么不是 KV：KV 最终一致且要每个生成项目另建
 * 一个命名空间并配 ID；D1 计数表不新增云资源、跨副本一致，也是舰队现行做法。
 *
 * setup 限流在数据库初始化之前就要生效，所以这里用 schema.ts 的同一份 DDL 先把
 * 计数表幂等建出来（不另抄结构），迁移里的 CREATE IF NOT EXISTS 之后是空操作。
 */
import { AUTH_COUNTERS_INDEX_DDL, AUTH_COUNTERS_TABLE_DDL } from "../lib/schema"
import { countersTable } from "../lib/tables"

export interface CounterKey {
  action: string
  account?: string
  ip?: string
}

export interface CounterState {
  count: number
  windowStart: number
  lockedUntil: number | null
}

/** 计数键：`<action>:<account>:<ip>`（空段保留，避免键之间互相覆盖）。 */
function keyOf({ action, account = "", ip = "" }: CounterKey): string {
  return `${action}:${account}:${ip}`
}

/** 建计数表（幂等）；迁移之前也能用，与基线 DDL 同源。 */
export async function ensureCountersTable(
  db: D1Database,
  prefix: string
): Promise<void> {
  const sql = `${AUTH_COUNTERS_TABLE_DDL.replaceAll(
    "{table}",
    countersTable(prefix)
  )};\n${AUTH_COUNTERS_INDEX_DDL.replaceAll("{prefix}", prefix)}`
  for (const statement of sql
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)) {
    await db.prepare(statement).run()
  }
}

/**
 * 消费一次额度：返回自增后的计数与锁定时间。
 * 窗口过期（window_start <= now - windowSeconds）时重新从 1 计。
 *
 * `now` 可注入，测试用它推进窗口而不必真等 10 分钟。
 */
export async function consumeCounter(
  db: D1Database,
  prefix: string,
  key: CounterKey & { windowSeconds: number },
  now: number = Math.floor(Date.now() / 1000)
): Promise<CounterState> {
  const table = countersTable(prefix)
  const composite = keyOf(key)
  const threshold = now - key.windowSeconds
  await db
    .prepare(
      `INSERT INTO ${table} (key, action, account, ip, count, window_start, locked_until, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, NULL, ?)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN window_start <= ? THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN window_start <= ? THEN ? ELSE window_start END,
         updated_at = excluded.updated_at`
    )
    .bind(
      composite,
      key.action,
      key.account ?? "",
      key.ip ?? "",
      now,
      now,
      threshold,
      threshold,
      now
    )
    .run()

  const row = await db
    .prepare(
      `SELECT count, window_start, locked_until FROM ${table} WHERE key = ?`
    )
    .bind(composite)
    .first<{
      count: number
      window_start: number
      locked_until: number | null
    }>()
  if (!row) throw new Error(`counter row missing after upsert: ${composite}`)
  return {
    count: row.count,
    windowStart: row.window_start,
    lockedUntil: row.locked_until
  }
}

/** 写入锁定截止时间（连续失败锁定用；登录面复用同一张表）。 */
export async function lockCounter(
  db: D1Database,
  prefix: string,
  key: CounterKey,
  seconds: number,
  now: number = Math.floor(Date.now() / 1000)
): Promise<void> {
  const table = countersTable(prefix)
  const composite = keyOf(key)
  const lockedUntil = now + seconds
  await db
    .prepare(
      `INSERT INTO ${table} (key, action, account, ip, count, window_start, locked_until, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET locked_until = excluded.locked_until, updated_at = excluded.updated_at`
    )
    .bind(
      composite,
      key.action,
      key.account ?? "",
      key.ip ?? "",
      now,
      lockedUntil,
      now
    )
    .run()
}

/**
 * 只读当前计数（登录锁定判定用）。表还没建或没有该键 → null。
 * 不写库：读路径（每次登录都读一次锁状态）不制造写放大。
 */
export async function readCounter(
  db: D1Database,
  prefix: string,
  key: CounterKey
): Promise<CounterState | null> {
  try {
    const row = await db
      .prepare(
        `SELECT count, window_start, locked_until FROM ${countersTable(prefix)} WHERE key = ?`
      )
      .bind(keyOf(key))
      .first<{
        count: number
        window_start: number
        locked_until: number | null
      }>()
    if (!row) return null
    return {
      count: row.count,
      windowStart: row.window_start,
      lockedUntil: row.locked_until
    }
  } catch {
    // 表不存在（未初始化）：视为没有计数。
    return null
  }
}

/** 清零一个计数键（登录成功后解除失败计数与锁定）。 */
export async function clearCounter(
  db: D1Database,
  prefix: string,
  key: CounterKey
): Promise<void> {
  await db
    .prepare(`DELETE FROM ${countersTable(prefix)} WHERE key = ?`)
    .bind(keyOf(key))
    .run()
}

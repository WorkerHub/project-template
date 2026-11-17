/**
 * 用户管理操作列（规格 §5.6.2 用户管理操作列）：五个端点的契约、护栏与幂等口径。
 *
 * - 五个端点全部仅管理员可用：未登录 401、非管理员 403。
 * - 重置密码复用一次性密码机制：只回一次、置 must_change_password、会话全部失效。
 * - 停用/启用：停用禁止登录并清会话；启用恢复；重复停用/启用幂等 200。
 * - 变更角色：普通用户 ↔ 管理员；角色未变化幂等 200。
 * - 删除用户：硬删并级联清 sessions / user_2fa / passkey_credentials。
 * - 护栏：自删/自停用 403 SELF_ACTION_FORBIDDEN（优先级最高）；
 *   删除/停用/降级命中最后一个可登录管理员 409 LAST_ADMIN（只算 role=admin 且 status=active）。
 */
import { describe, expect, it } from "vitest"
import {
  passkeysTable,
  sessionsTable,
  user2faTable,
  usersTable
} from "../src/lib/tables"
import {
  activePrefix,
  initializedContext,
  postJson,
  request,
  seedSession
} from "./support/app"

async function seedAdmin(
  db: Parameters<typeof seedSession>[0],
  prefix: string
) {
  return seedSession(db, prefix, {
    role: "admin",
    status: "active",
    email: "owner@example.test"
  })
}
const ACTIONS = [
  "reset-password",
  "disable",
  "enable",
  "role",
  "delete"
] as const

describe("用户管理操作列：鉴权", () => {
  it("五个端点未登录 401、非管理员 403", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const admin = await seedAdmin(db, prefix)
    const member = await seedSession(db, prefix, {
      role: "user",
      status: "active",
      email: "member@example.test"
    })

    for (const action of ACTIONS) {
      const path = `/api/admin/users/${admin.userId}/${action}`
      const unauth = await postJson(env, path, {})
      expect(unauth.status).toBe(401)

      const forbidden = await postJson(env, path, {}, { cookie: member.cookie })
      expect(forbidden.status).toBe(403)
    }
  })

  it("目标不存在 404 USER_NOT_FOUND", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const admin = await seedAdmin(db, prefix)

    for (const action of ACTIONS) {
      // role 端点要求合法角色体；其余四个端点不读请求体。
      const body = action === "role" ? { role: "user" } : {}
      const res = await postJson(env, `/api/admin/users/9999/${action}`, body, {
        cookie: admin.cookie
      })
      expect(res.status).toBe(404)
      expect(await res.json()).toMatchObject({ code: "USER_NOT_FOUND" })
    }
  })
})

describe("用户管理操作列：重置密码", () => {
  it("返回一次性密码、置强制改密、使现有会话全部失效", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const admin = await seedAdmin(db, prefix)
    const target = await seedSession(db, prefix, {
      role: "user",
      status: "active",
      email: "victim@example.test"
    })

    // 目标原有可用会话。
    expect(
      (await request(env, "/api/me", { headers: { cookie: target.cookie } }))
        .status
    ).toBe(200)

    const res = await postJson(
      env,
      `/api/admin/users/${target.userId}/reset-password`,
      {},
      { cookie: admin.cookie }
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      id: number
      email: string
      temporaryPassword: string
    }
    expect(body).toMatchObject({
      id: target.userId,
      email: "victim@example.test"
    })
    expect(body.temporaryPassword.length).toBeGreaterThanOrEqual(8)

    // 库里只存哈希、置首登强制改密。
    const row = db.db
      .prepare(
        `SELECT password_hash, must_change_password
           FROM ${usersTable(prefix)} WHERE id = ?`
      )
      .get(target.userId) as {
      password_hash: string
      must_change_password: number
    }
    expect(row.password_hash).not.toContain(body.temporaryPassword)
    expect(row.must_change_password).toBe(1)

    // 目标会话全部失效。
    expect(
      (await request(env, "/api/me", { headers: { cookie: target.cookie } }))
        .status
    ).toBe(401)

    // 一次性密码可登录（重置后新密码即为该临时密码）。
    const login = await postJson(env, "/api/auth/login", {
      email: "victim@example.test",
      password: body.temporaryPassword
    })
    expect(login.status).toBe(200)
  })
})

describe("用户管理操作列：停用 / 启用", () => {
  it("停用禁止登录并清会话，重复停用幂等；启用恢复，重复启用幂等", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const admin = await seedAdmin(db, prefix)
    const target = await seedSession(db, prefix, {
      role: "user",
      status: "active",
      email: "victim@example.test"
    })

    const disable = await postJson(
      env,
      `/api/admin/users/${target.userId}/disable`,
      {},
      { cookie: admin.cookie }
    )
    expect(disable.status).toBe(200)
    expect(await disable.json()).toEqual({ success: true })

    const disabled = db.db
      .prepare(`SELECT status FROM ${usersTable(prefix)} WHERE id = ?`)
      .get(target.userId) as { status: string }
    expect(disabled.status).toBe("disabled")

    // 会话已失效。
    expect(
      (await request(env, "/api/me", { headers: { cookie: target.cookie } }))
        .status
    ).toBe(401)

    // 幂等：重复停用。
    const again = await postJson(
      env,
      `/api/admin/users/${target.userId}/disable`,
      {},
      { cookie: admin.cookie }
    )
    expect(again.status).toBe(200)

    // 启用恢复。
    const enable = await postJson(
      env,
      `/api/admin/users/${target.userId}/enable`,
      {},
      { cookie: admin.cookie }
    )
    expect(enable.status).toBe(200)
    const active = db.db
      .prepare(`SELECT status FROM ${usersTable(prefix)} WHERE id = ?`)
      .get(target.userId) as { status: string }
    expect(active.status).toBe("active")

    // 幂等：重复启用。
    const againEnable = await postJson(
      env,
      `/api/admin/users/${target.userId}/enable`,
      {},
      { cookie: admin.cookie }
    )
    expect(againEnable.status).toBe(200)
  })
})

describe("用户管理操作列：变更角色", () => {
  it("普通用户 ↔ 管理员，角色未变化幂等 200，非法角色 400", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const admin = await seedAdmin(db, prefix)
    const target = await seedSession(db, prefix, {
      role: "user",
      status: "active",
      email: "member@example.test"
    })

    // 非法角色。
    const bad = await postJson(
      env,
      `/api/admin/users/${target.userId}/role`,
      { role: "super" },
      { cookie: admin.cookie }
    )
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ code: "INVALID_ROLE" })

    // 角色未变化（target 仍是 user）。
    const unchanged = await postJson(
      env,
      `/api/admin/users/${target.userId}/role`,
      { role: "user" },
      { cookie: admin.cookie }
    )
    expect(unchanged.status).toBe(200)

    // 提升为管理员。
    const promote = await postJson(
      env,
      `/api/admin/users/${target.userId}/role`,
      { role: "admin" },
      { cookie: admin.cookie }
    )
    expect(promote.status).toBe(200)
    let row = db.db
      .prepare(`SELECT role FROM ${usersTable(prefix)} WHERE id = ?`)
      .get(target.userId) as { role: string }
    expect(row.role).toBe("admin")

    // 降回普通用户（此时有 2 个活跃管理员，不命中 LAST_ADMIN）。
    const demote = await postJson(
      env,
      `/api/admin/users/${target.userId}/role`,
      { role: "user" },
      { cookie: admin.cookie }
    )
    expect(demote.status).toBe(200)
    row = db.db
      .prepare(`SELECT role FROM ${usersTable(prefix)} WHERE id = ?`)
      .get(target.userId) as { role: string }
    expect(row.role).toBe("user")
  })
})

describe("用户管理操作列：删除用户", () => {
  it("硬删并级联清 sessions / user_2fa / passkey_credentials", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const admin = await seedAdmin(db, prefix)
    const target = await seedSession(db, prefix, {
      role: "user",
      status: "active",
      email: "victim@example.test"
    })

    // 给目标用户挂一条 2FA 与一条通行密钥。
    const now = new Date().toISOString()
    db.db
      .prepare(
        `INSERT INTO ${user2faTable(prefix)}
          (user_id, totp_secret, totp_enabled, updated_at) VALUES (?, ?, 1, ?)`
      )
      .run(target.userId, "secret", now)
    db.db
      .prepare(
        `INSERT INTO ${passkeysTable(prefix)}
          (user_id, credential_id, public_key, counter, transports, created_at)
         VALUES (?, ?, ?, 0, '', ?)`
      )
      .run(target.userId, "cred-1", "pubkey", now)

    const res = await postJson(
      env,
      `/api/admin/users/${target.userId}/delete`,
      {},
      { cookie: admin.cookie }
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })

    const usersLeft = db.db
      .prepare(`SELECT COUNT(*) AS n FROM ${usersTable(prefix)} WHERE id = ?`)
      .get(target.userId) as { n: number }
    const sessionsLeft = db.db
      .prepare(
        `SELECT COUNT(*) AS n FROM ${sessionsTable(prefix)} WHERE user_id = ?`
      )
      .get(target.userId) as { n: number }
    const twofaLeft = db.db
      .prepare(
        `SELECT COUNT(*) AS n FROM ${user2faTable(prefix)} WHERE user_id = ?`
      )
      .get(target.userId) as { n: number }
    const passkeysLeft = db.db
      .prepare(
        `SELECT COUNT(*) AS n FROM ${passkeysTable(prefix)} WHERE user_id = ?`
      )
      .get(target.userId) as { n: number }

    expect(usersLeft.n).toBe(0)
    expect(sessionsLeft.n).toBe(0)
    expect(twofaLeft.n).toBe(0)
    expect(passkeysLeft.n).toBe(0)
  })
})

describe("用户管理操作列：护栏", () => {
  it("对自己停用/删除一律 403 SELF_ACTION_FORBIDDEN，优先级高于 LAST_ADMIN", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    // 唯一管理员：同时命中「自己」与「最后管理员」，应回 403 而非 409。
    const admin = await seedAdmin(db, prefix)

    const disable = await postJson(
      env,
      `/api/admin/users/${admin.userId}/disable`,
      {},
      { cookie: admin.cookie }
    )
    expect(disable.status).toBe(403)
    expect(await disable.json()).toMatchObject({
      code: "SELF_ACTION_FORBIDDEN"
    })

    const del = await postJson(
      env,
      `/api/admin/users/${admin.userId}/delete`,
      {},
      { cookie: admin.cookie }
    )
    expect(del.status).toBe(403)
    expect(await del.json()).toMatchObject({ code: "SELF_ACTION_FORBIDDEN" })
  })

  it("最后一个可登录管理员降级自己 409 LAST_ADMIN", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const admin = await seedAdmin(db, prefix)

    const res = await postJson(
      env,
      `/api/admin/users/${admin.userId}/role`,
      { role: "user" },
      { cookie: admin.cookie }
    )
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "LAST_ADMIN" })

    // 角色未变。
    const row = db.db
      .prepare(`SELECT role FROM ${usersTable(prefix)} WHERE id = ?`)
      .get(admin.userId) as { role: string }
    expect(row.role).toBe("admin")
  })

  it("「最后一个管理员」只算能登录的：删除停用的管理员不触发 LAST_ADMIN", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const admin = await seedAdmin(db, prefix)
    // 一个已停用的管理员（不能登录，不计入「最后一个管理员」）。
    const disabledAdmin = await seedSession(db, prefix, {
      role: "admin",
      status: "disabled",
      email: "retired@example.test"
    })

    const res = await postJson(
      env,
      `/api/admin/users/${disabledAdmin.userId}/delete`,
      {},
      { cookie: admin.cookie }
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
  })
})

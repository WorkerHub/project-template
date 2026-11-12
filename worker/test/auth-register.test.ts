/**
 * 规格 §7-6（一）：注册与审核。
 *
 * - 首个注册用户 = 管理员、直接批准、邮箱已验证；
 * - 其后用户按开关待批准，批准前不得登录，批准后可登录；
 * - 注册开关即时生效；拒绝 = 删除待批准用户（可重新注册）；
 * - 已停用账号不能登录。
 */
import { describe, expect, it } from "vitest"
import { usersTable } from "../src/lib/tables"
import type { Env } from "../src/types"
import {
  activePrefix,
  cookieFrom,
  initializedContext,
  loginUser,
  makeContext,
  postJson,
  registerUser,
  request,
  TEST_PASSWORD,
  writeSetting
} from "./support/app"

async function adminCookie(
  env: Env,
  email = "owner@example.test"
): Promise<string> {
  return cookieFrom(await loginUser(env, { email }))
}

describe("注册：首个用户与审核", () => {
  it("首个注册用户是管理员、直接批准、邮箱已验证，并可登录", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)

    const res = await registerUser(env, { email: "owner@example.test" })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      requiresApproval: false,
      requiresEmailVerification: false
    })

    const row = db.db
      .prepare(
        `SELECT role, status, email_verified FROM ${usersTable(prefix)} WHERE email = ?`
      )
      .get("owner@example.test")
    expect(row).toEqual({ role: "admin", status: "active", email_verified: 1 })

    const login = await loginUser(env, { email: "owner@example.test" })
    expect(login.status).toBe(200)
    const body = (await login.json()) as {
      requires2fa: boolean
      user: { email: string; role: string }
    }
    expect(body.requires2fa).toBe(false)
    expect(body.user).toMatchObject({
      email: "owner@example.test",
      role: "admin"
    })
  })

  it("第二个用户默认待批准，批准前 403，批准后可登录", async () => {
    const { env } = await initializedContext()
    await registerUser(env, { email: "owner@example.test" })
    const admin = await adminCookie(env)

    const res = await registerUser(env, { email: "member@example.test" })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      requiresApproval: true,
      requiresEmailVerification: false
    })

    const blocked = await loginUser(env, { email: "member@example.test" })
    expect(blocked.status).toBe(403)
    expect(((await blocked.json()) as { code: string }).code).toBe(
      "ACCOUNT_PENDING"
    )

    const pending = await request(env, "/api/admin/users?status=pending", {
      headers: { cookie: admin }
    })
    const pendingBody = (await pending.json()) as {
      users: Array<{ id: number; email: string }>
    }
    expect(pendingBody.users).toHaveLength(1)
    const memberId = pendingBody.users[0].id

    const approve = await postJson(
      env,
      `/api/admin/users/${memberId}/approve`,
      {},
      { cookie: admin }
    )
    expect(approve.status).toBe(200)

    const allowed = await loginUser(env, { email: "member@example.test" })
    expect(allowed.status).toBe(200)
  })

  it("注册开关即时生效（关闭后 403，重开后又可以注册）", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    await registerUser(env, { email: "owner@example.test" })
    const admin = await adminCookie(env)

    const off = await request(env, "/api/admin/settings", {
      method: "PUT",
      headers: { cookie: admin, "content-type": "application/json" },
      body: JSON.stringify({ registration: { enabled: false } })
    })
    expect(off.status).toBe(200)

    const blocked = await registerUser(env, { email: "late@example.test" })
    expect(blocked.status).toBe(403)
    expect(((await blocked.json()) as { code: string }).code).toBe(
      "REGISTRATION_DISABLED"
    )

    writeSetting(db, prefix, "registration_enabled", "true")
    const ok = await registerUser(env, { email: "late@example.test" })
    expect(ok.status).toBe(201)
  })

  it("拒绝待批准用户 = 删除该行，之后同一邮箱可以重新注册", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    await registerUser(env, { email: "owner@example.test" })
    const admin = await adminCookie(env)

    await registerUser(env, { email: "spam@example.test" })
    const pending = (await (
      await request(env, "/api/admin/users", { headers: { cookie: admin } })
    ).json()) as { users: Array<{ id: number }> }
    const id = pending.users[0].id

    const reject = await postJson(
      env,
      `/api/admin/users/${id}/reject`,
      {},
      { cookie: admin }
    )
    expect(reject.status).toBe(200)

    const rows = db.db
      .prepare(
        `SELECT COUNT(*) AS n FROM ${usersTable(prefix)} WHERE email = ?`
      )
      .get("spam@example.test") as { n: number }
    expect(rows.n).toBe(0)

    // 同一个 id 再批准 → 404（行已不存在）
    const again = await postJson(
      env,
      `/api/admin/users/${id}/approve`,
      {},
      { cookie: admin }
    )
    expect(again.status).toBe(404)

    const retry = await registerUser(env, { email: "spam@example.test" })
    expect(retry.status).toBe(201)
  })

  it("已停用账号不能登录", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    await registerUser(env, { email: "owner@example.test" })

    db.db
      .prepare(
        `UPDATE ${usersTable(prefix)} SET status = 'disabled' WHERE email = ?`
      )
      .run("owner@example.test")

    const login = await loginUser(env, { email: "owner@example.test" })
    expect(login.status).toBe(403)
    expect(((await login.json()) as { code: string }).code).toBe(
      "ACCOUNT_DISABLED"
    )
  })

  it("非法邮箱 / 短密码 / 重复邮箱被拒", async () => {
    const { env } = await initializedContext()
    const bad = await postJson(env, "/api/auth/register", {
      email: "not-an-email",
      password: TEST_PASSWORD
    })
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as { code: string }).code).toBe("INVALID_EMAIL")

    const weak = await registerUser(env, {
      email: "a@example.test",
      password: "short"
    })
    expect(weak.status).toBe(400)
    expect(((await weak.json()) as { code: string }).code).toBe("WEAK_PASSWORD")

    expect((await registerUser(env, { email: "a@example.test" })).status).toBe(
      201
    )
    const dup = await registerUser(env, { email: "a@example.test" })
    expect(dup.status).toBe(409)
    expect(((await dup.json()) as { code: string }).code).toBe("EMAIL_TAKEN")
  })

  it("数据库未初始化时 409 SETUP_REQUIRED（不是 500）", async () => {
    const { env } = makeContext()
    const res = await registerUser(env, { email: "a@example.test" })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe("SETUP_REQUIRED")

    const login = await postJson(env, "/api/auth/login", {
      email: "a@example.test",
      password: TEST_PASSWORD
    })
    expect(login.status).toBe(409)
    expect(((await login.json()) as { code: string }).code).toBe(
      "SETUP_REQUIRED"
    )
  })
})

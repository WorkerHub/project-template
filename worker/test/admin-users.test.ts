/**
 * 系统管理面：菜单隐藏 + 接口 403 双层里的服务端一层；设置文档形状与凭据脱敏；
 * setup 页面开关；待批准用户列表/批准/拒绝的边界；多用户档下不提供所有者端点。
 */
import { describe, expect, it } from "vitest"
import { usersTable } from "../src/lib/tables"
import {
  activePrefix,
  cookieFrom,
  initializedContext,
  loginUser,
  postJson,
  putJson,
  registerUser,
  request,
  TEST_SETUP_SECRET
} from "./support/app"

async function adminCookie(
  env: Parameters<typeof loginUser>[0]
): Promise<string> {
  return cookieFrom(await loginUser(env, { email: "owner@example.test" }))
}

describe("系统管理面", () => {
  it("未登录 401、非管理员 403", async () => {
    const { env, db } = await initializedContext()
    expect((await request(env, "/api/admin/settings")).status).toBe(401)
    expect((await request(env, "/api/admin/users")).status).toBe(401)

    await registerUser(env, { email: "owner@example.test" })
    await registerUser(env, { email: "member@example.test" })
    // 直接把第二人放行为普通用户（审核流程在外层用例覆盖）
    db.db
      .prepare(
        `UPDATE ${usersTable(activePrefix(env))} SET status = 'active' WHERE email = ?`
      )
      .run("member@example.test")
    const member = cookieFrom(
      await loginUser(env, { email: "member@example.test" })
    )

    const res = await request(env, "/api/admin/settings", {
      headers: { cookie: member }
    })
    expect(res.status).toBe(403)
    const list = await request(env, "/api/admin/users", {
      headers: { cookie: member }
    })
    expect(list.status).toBe(403)
  })

  it("GET 设置文档：结构化、凭据脱敏、开关默认值符合规格", async () => {
    const { env } = await initializedContext()
    await registerUser(env, { email: "owner@example.test" })
    const admin = await adminCookie(env)

    const res = await request(env, "/api/admin/settings", {
      headers: { cookie: admin }
    })
    expect(res.status).toBe(200)
    const raw = await res.text()
    const body = JSON.parse(raw) as {
      appMode: string
      tablePrefix: string
      registration: {
        enabled: boolean
        approvalRequired: boolean
        emailVerificationRequired: boolean
      }
      setup: { pageEnabled: boolean }
      email: {
        provider: string
        configured: boolean
        smtp: { passwordSet: boolean }
        resend: { apiKeySet: boolean }
      }
    }
    expect(body.appMode).toBe("multi")
    expect(body.tablePrefix).toBe(activePrefix(env))
    expect(body.registration).toEqual({
      enabled: true,
      approvalRequired: true,
      emailVerificationRequired: false
    })
    expect(body.setup.pageEnabled).toBe(false)
    expect(body.email.provider).toBe("none")
    expect(body.email.configured).toBe(false)
    expect(body.email.smtp.passwordSet).toBe(false)
    expect(body.email.resend.apiKeySet).toBe(false)
    expect(raw).not.toContain('password":')
    expect(raw).not.toContain("api_key")
  })

  it("PUT 设置：setup 页面开合即时反映到 /api/setup/state", async () => {
    const { env } = await initializedContext()
    await registerUser(env, { email: "owner@example.test" })
    const admin = await adminCookie(env)

    const open = await putJson(
      env,
      "/api/admin/settings",
      { setup: { pageEnabled: true } },
      { cookie: admin }
    )
    expect(open.status).toBe(200)
    const state = (await (await request(env, "/api/setup/state")).json()) as {
      enabled: boolean
    }
    expect(state.enabled).toBe(true)

    await putJson(
      env,
      "/api/admin/settings",
      { setup: { pageEnabled: false } },
      { cookie: admin }
    )
    const closed = (await (await request(env, "/api/setup/state")).json()) as {
      enabled: boolean
    }
    expect(closed.enabled).toBe(false)
  })

  it("批准/拒绝的边界：不存在 404、非待批准 409", async () => {
    const { env } = await initializedContext()
    await registerUser(env, { email: "owner@example.test" })
    const admin = await adminCookie(env)

    const missing = await postJson(
      env,
      "/api/admin/users/9999/approve",
      {},
      { cookie: admin }
    )
    expect(missing.status).toBe(404)
    expect(((await missing.json()) as { code: string }).code).toBe(
      "USER_NOT_FOUND"
    )

    const me = (await (
      await request(env, "/api/me", { headers: { cookie: admin } })
    ).json()) as { id: number }
    const notPending = await postJson(
      env,
      `/api/admin/users/${me.id}/reject`,
      {},
      { cookie: admin }
    )
    expect(notPending.status).toBe(409)
    expect(((await notPending.json()) as { code: string }).code).toBe(
      "USER_NOT_PENDING"
    )
  })

  it("多用户档不提供所有者端点；数据库维护仍走 A 单契约", async () => {
    const { env } = await initializedContext()
    const owner = await postJson(
      env,
      "/api/setup/owner",
      { email: "owner@example.test", password: "owner-password-123" },
      { "x-setup-secret": TEST_SETUP_SECRET }
    )
    expect(owner.status).toBe(404)
    expect(((await owner.json()) as { code: string }).code).toBe(
      "MODE_UNSUPPORTED"
    )

    await registerUser(env, { email: "owner@example.test" })
    const admin = await adminCookie(env)
    const maintenance = await postJson(
      env,
      "/api/admin/setup",
      {},
      { cookie: admin }
    )
    expect(maintenance.status).toBe(200)
    const body = (await maintenance.json()) as {
      success: boolean
      tablePrefix: string
      migrations: Array<{ name: string; status: string }>
    }
    expect(body.success).toBe(true)
    expect(body.tablePrefix).toBe(activePrefix(env))
    expect(body.migrations).toEqual([{ name: "schema_v1", status: "skipped" }])
  })
})

describe("全量用户列表", () => {
  it("返回管理员自己、待批准与停用账号，按 id 升序且只含契约字段", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    await registerUser(env, { email: "owner@example.test" })
    const admin = await adminCookie(env)
    await registerUser(env, { email: "pending@example.test" })
    await registerUser(env, { email: "gone@example.test" })
    db.db
      .prepare(
        `UPDATE ${usersTable(prefix)} SET status = 'disabled' WHERE email = ?`
      )
      .run("gone@example.test")

    const res = await request(env, "/api/admin/users", {
      headers: { cookie: admin }
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      items: Array<Record<string, unknown>>
    }

    expect(body.items.map((item) => item.email)).toEqual([
      "owner@example.test",
      "pending@example.test",
      "gone@example.test"
    ])
    expect(body.items.map((item) => item.status)).toEqual([
      "active",
      "pending",
      "disabled"
    ])
    expect(body.items.map((item) => item.role)).toEqual([
      "admin",
      "user",
      "user"
    ])
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual([
        "createdAt",
        "displayName",
        "email",
        "emailVerified",
        "id",
        "role",
        "status"
      ])
      expect(typeof item.emailVerified).toBe("boolean")
      expect(item).not.toHaveProperty("password_hash")
      expect(item).not.toHaveProperty("language")
    }
  })

  it("status 过滤：pending 只回待批准，未知值 400", async () => {
    const { env } = await initializedContext()
    await registerUser(env, { email: "owner@example.test" })
    const admin = await adminCookie(env)
    await registerUser(env, { email: "pending@example.test" })

    const pending = await request(env, "/api/admin/users?status=pending", {
      headers: { cookie: admin }
    })
    expect(pending.status).toBe(200)
    const pendingBody = (await pending.json()) as {
      items: Array<{ email: string }>
    }
    expect(pendingBody.items.map((item) => item.email)).toEqual([
      "pending@example.test"
    ])

    const invalid = await request(env, "/api/admin/users?status=bogus", {
      headers: { cookie: admin }
    })
    expect(invalid.status).toBe(400)
    const invalidBody = (await invalid.json()) as { code: string }
    expect(invalidBody.code).toBe("INVALID_STATUS")
  })
})

describe("管理员手动建号", () => {
  it("建号返回一次性密码，首登 mustChangePassword=true，改密后清除", async () => {
    const { env, db } = await initializedContext()
    await registerUser(env, { email: "owner@example.test" })
    const admin = await adminCookie(env)

    const res = await postJson(
      env,
      "/api/admin/users",
      { email: "newbie@example.test", role: "user" },
      { cookie: admin }
    )
    expect(res.status).toBe(200)
    const created = (await res.json()) as {
      id: number
      email: string
      role: string
      status: string
      temporaryPassword: string
    }
    expect(created).toMatchObject({
      email: "newbie@example.test",
      role: "user",
      status: "active"
    })
    expect(created.temporaryPassword.length).toBeGreaterThanOrEqual(8)

    // 库里只存哈希，不存明文；首登标记置 1，直接激活 + 已验证。
    const row = db.db
      .prepare(
        `SELECT password_hash, must_change_password, status, email_verified
           FROM ${usersTable(activePrefix(env))} WHERE email = ?`
      )
      .get("newbie@example.test") as {
      password_hash: string
      must_change_password: number
      status: string
      email_verified: number
    }
    expect(row.password_hash).not.toContain(created.temporaryPassword)
    expect(row.must_change_password).toBe(1)
    expect(row.status).toBe("active")
    expect(row.email_verified).toBe(1)

    // 一次性密码可登录，且下发 mustChangePassword=true。
    const login = await loginUser(env, {
      email: "newbie@example.test",
      password: created.temporaryPassword
    })
    expect(login.status).toBe(200)
    const loginBody = (await login.json()) as {
      success: boolean
      user: { mustChangePassword: boolean }
    }
    expect(loginBody.success).toBe(true)
    expect(loginBody.user.mustChangePassword).toBe(true)
    const cookie = cookieFrom(login)

    // 改密成功后标记清除。
    const changed = await putJson(
      env,
      "/api/me/password",
      {
        currentPassword: created.temporaryPassword,
        newPassword: "new-strong-password"
      },
      { cookie }
    )
    expect(changed.status).toBe(200)

    const me = await request(env, "/api/me", { headers: { cookie } })
    expect(me.status).toBe(200)
    const meBody = (await me.json()) as { mustChangePassword: boolean }
    expect(meBody.mustChangePassword).toBe(false)
  })

  it("建号校验：非法邮箱 / 非法角色 / 重复邮箱", async () => {
    const { env } = await initializedContext()
    await registerUser(env, { email: "owner@example.test" })
    const admin = await adminCookie(env)

    const badEmail = await postJson(
      env,
      "/api/admin/users",
      { email: "not-an-email", role: "user" },
      { cookie: admin }
    )
    expect(badEmail.status).toBe(400)
    expect(await badEmail.json()).toMatchObject({ code: "INVALID_EMAIL" })

    const badRole = await postJson(
      env,
      "/api/admin/users",
      { email: "x@example.test", role: "super" },
      { cookie: admin }
    )
    expect(badRole.status).toBe(400)
    expect(await badRole.json()).toMatchObject({ code: "INVALID_ROLE" })

    const dup = await postJson(
      env,
      "/api/admin/users",
      { email: "owner@example.test", role: "user" },
      { cookie: admin }
    )
    expect(dup.status).toBe(409)
    expect(await dup.json()).toMatchObject({ code: "EMAIL_TAKEN" })
  })

  it("role=admin 且带全部可选字段：写入库并回显", async () => {
    const { env, db } = await initializedContext()
    await registerUser(env, { email: "owner@example.test" })
    const admin = await adminCookie(env)

    const res = await postJson(
      env,
      "/api/admin/users",
      {
        email: "boss@example.test",
        role: "admin",
        displayName: "Boss Liu",
        language: "en",
        timezone: "America/New_York"
      },
      { cookie: admin }
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      email: "boss@example.test",
      role: "admin",
      status: "active"
    })

    const row = db.db
      .prepare(
        `SELECT role, status, display_name, language, timezone,
                email_verified, must_change_password
           FROM ${usersTable(activePrefix(env))} WHERE email = ?`
      )
      .get("boss@example.test") as {
      role: string
      status: string
      display_name: string
      language: string
      timezone: string
      email_verified: number
      must_change_password: number
    }
    expect(row).toMatchObject({
      role: "admin",
      status: "active",
      display_name: "Boss Liu",
      language: "en",
      timezone: "America/New_York",
      email_verified: 1,
      must_change_password: 1
    })
  })

  it("可选字段校验：非法语言 / 时区；body 里多余的 username 被忽略", async () => {
    const { env } = await initializedContext()
    await registerUser(env, { email: "owner@example.test" })
    const admin = await adminCookie(env)

    const ignored = await postJson(
      env,
      "/api/admin/users",
      { email: "u1@example.test", role: "user", username: "a" },
      { cookie: admin }
    )
    expect(ignored.status).toBe(200)
    expect(await ignored.json()).toMatchObject({
      email: "u1@example.test",
      status: "active"
    })

    const badLanguage = await postJson(
      env,
      "/api/admin/users",
      { email: "u2@example.test", role: "user", language: "fr" },
      { cookie: admin }
    )
    expect(badLanguage.status).toBe(400)
    expect(await badLanguage.json()).toMatchObject({ code: "INVALID_LANGUAGE" })

    const badTimezone = await postJson(
      env,
      "/api/admin/users",
      { email: "u3@example.test", role: "user", timezone: "Not/AZone" },
      { cookie: admin }
    )
    expect(badTimezone.status).toBe(400)
    expect(await badTimezone.json()).toMatchObject({ code: "INVALID_TIMEZONE" })
  })
})

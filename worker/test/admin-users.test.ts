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

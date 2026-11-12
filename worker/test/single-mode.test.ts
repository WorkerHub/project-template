/**
 * 规格 §6.4 的单人档后端行为（本文件把 APP_MODE 固定成 single）：
 * - 注册接口关闭；
 * - 管理面不暴露注册/审核开关，写入回 400 MODE_CONFLICT；
 * - setup 同页建唯一所有者走独立端点（不改冻结的 POST /api/setup）；
 * - 页脚版本、设置/关于、数据库维护照常（这里验证数据库维护与登录）。
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("../src/config/project", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config/project")>()
  return { ...actual, APP_MODE: "single" }
})

import {
  cookieFrom,
  initializedContext,
  loginUser,
  makeContext,
  postJson,
  putJson,
  registerUser,
  request,
  TEST_PASSWORD,
  TEST_SETUP_SECRET
} from "./support/app"

const SECRET_HEADER = { "x-setup-secret": TEST_SETUP_SECRET }

describe("单人档", () => {
  it("注册接口关闭（403 REGISTRATION_DISABLED）", async () => {
    const { env } = await initializedContext()
    const res = await registerUser(env, { email: "someone@example.test" })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { code: string }).code).toBe(
      "REGISTRATION_DISABLED"
    )
  })

  it("公开引导端点：appMode=single、registrationEnabled=false", async () => {
    const { env } = await initializedContext()
    const body = (await (await request(env, "/api/public")).json()) as {
      appMode: string
      registrationEnabled: boolean
    }
    expect(body.appMode).toBe("single")
    expect(body.registrationEnabled).toBe(false)
  })

  it("建所有者：未初始化 409、错钥 403、成功 201、重复 409", async () => {
    const { env } = makeContext()
    const beforeSetup = await postJson(
      env,
      "/api/setup/owner",
      { email: "owner@example.test", password: TEST_PASSWORD },
      SECRET_HEADER
    )
    expect(beforeSetup.status).toBe(409)
    expect(((await beforeSetup.json()) as { code: string }).code).toBe(
      "SETUP_REQUIRED"
    )

    const initialized = await initializedContext()
    const wrongSecret = await postJson(
      initialized.env,
      "/api/setup/owner",
      { email: "owner@example.test", password: TEST_PASSWORD },
      { "x-setup-secret": "not-the-secret" }
    )
    expect(wrongSecret.status).toBe(403)

    const created = await postJson(
      initialized.env,
      "/api/setup/owner",
      { email: "owner@example.test", password: TEST_PASSWORD },
      SECRET_HEADER
    )
    expect(created.status).toBe(201)

    const again = await postJson(
      initialized.env,
      "/api/setup/owner",
      { email: "second@example.test", password: TEST_PASSWORD },
      SECRET_HEADER
    )
    expect(again.status).toBe(409)
    expect(((await again.json()) as { code: string }).code).toBe("OWNER_EXISTS")

    // 所有者可以正常登录，且是管理员
    const login = await loginUser(initialized.env, {
      email: "owner@example.test"
    })
    expect(login.status).toBe(200)
    const body = (await login.json()) as { user: { role: string } }
    expect(body.user.role).toBe("admin")
    const cookie = cookieFrom(login)

    const me = (await (
      await request(initialized.env, "/api/me", { headers: { cookie } })
    ).json()) as { id: number }
    expect(me.id).toBeGreaterThan(0)

    const maintenance = await postJson(
      initialized.env,
      "/api/admin/setup",
      {},
      { cookie }
    )
    expect(maintenance.status).toBe(200)
  })

  it("管理面不展示注册/审核开关，写入回 MODE_CONFLICT", async () => {
    const { env } = await initializedContext()
    await postJson(
      env,
      "/api/setup/owner",
      { email: "owner@example.test", password: TEST_PASSWORD },
      SECRET_HEADER
    )
    const cookie = cookieFrom(
      await loginUser(env, { email: "owner@example.test" })
    )

    const view = (await (
      await request(env, "/api/admin/settings", { headers: { cookie } })
    ).json()) as { registration: unknown; setup: { pageEnabled: boolean } }
    expect(view.registration).toBeNull()

    const write = await putJson(
      env,
      "/api/admin/settings",
      { registration: { enabled: true } },
      { cookie }
    )
    expect(write.status).toBe(400)
    expect(((await write.json()) as { code: string }).code).toBe(
      "MODE_CONFLICT"
    )

    // 单人档下数据库维护与 setup 页面开关照常
    const setupToggle = await putJson(
      env,
      "/api/admin/settings",
      { setup: { pageEnabled: true } },
      { cookie }
    )
    expect(setupToggle.status).toBe(200)
  })
})

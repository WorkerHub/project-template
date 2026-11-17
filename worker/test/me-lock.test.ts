/**
 * 个人资料修改锁（冻结契约）：昵称锁默认关闭；开启后 `/api/me` 对被禁字段
 * 整单拒绝（403 专属错误码），`GET /api/me` 与登录同形状下发 profileLocks；
 * 管理面 `PUT /api/admin/settings` 可读写开关。用户名已不是账号字段，旧开关被忽略。
 */
import { describe, expect, it } from "vitest"
import { settingsTable } from "../src/lib/tables"
import {
  activePrefix,
  cookieFrom,
  initializedContext,
  loginUser,
  patchJson,
  putJson,
  registerAndLogin,
  registerUser,
  request,
  writeSetting
} from "./support/app"

async function adminCookie(
  env: Parameters<typeof loginUser>[0]
): Promise<string> {
  return cookieFrom(await loginUser(env, { email: "owner@example.test" }))
}

describe("个人资料修改锁", () => {
  it("默认关闭：GET /api/me 下发 profileLocks=false，改昵称照常", async () => {
    const { env } = await initializedContext()
    const { cookie } = await registerAndLogin(env, {
      email: "owner@example.test"
    })

    const me = await request(env, "/api/me", { headers: { cookie } })
    expect(me.status).toBe(200)
    expect(await me.json()).toMatchObject({
      profileLocks: { displayNameLocked: false }
    })

    const ok = await putJson(
      env,
      "/api/me",
      { displayName: "船长" },
      { cookie }
    )
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ displayName: "船长" })
  })

  it("开启「禁止修改昵称」：PATCH 昵称回 403 DISPLAY_NAME_LOCKED", async () => {
    const { env, db } = await initializedContext()
    const { cookie } = await registerAndLogin(env, {
      email: "owner@example.test"
    })
    const prefix = activePrefix(env)
    writeSetting(db, prefix, "profile_display_name_locked", "true")

    const locked = await patchJson(
      env,
      "/api/me",
      { displayName: "新昵称" },
      { cookie }
    )
    expect(locked.status).toBe(403)
    expect(await locked.json()).toMatchObject({ code: "DISPLAY_NAME_LOCKED" })
  })

  it("混合请求体：被禁字段与合法字段同单，整单拒绝", async () => {
    const { env, db } = await initializedContext()
    const { cookie } = await registerAndLogin(env, {
      email: "owner@example.test"
    })
    const prefix = activePrefix(env)
    writeSetting(db, prefix, "profile_display_name_locked", "true")

    const mixed = await patchJson(
      env,
      "/api/me",
      { displayName: "新昵称", timezone: "Europe/London" },
      { cookie }
    )
    expect(mixed.status).toBe(403)
    expect(await mixed.json()).toMatchObject({ code: "DISPLAY_NAME_LOCKED" })

    // 时区未落库（整单拒绝，合法字段一并拒绝）
    const me = await request(env, "/api/me", { headers: { cookie } })
    expect(await me.json()).toMatchObject({ timezone: "Asia/Shanghai" })
  })

  it("管理员也受限：管理员自己 PATCH 昵称同样 403", async () => {
    const { env, db } = await initializedContext()
    await registerUser(env, { email: "owner@example.test" })
    const admin = await adminCookie(env)
    const prefix = activePrefix(env)
    writeSetting(db, prefix, "profile_display_name_locked", "true")

    const res = await patchJson(
      env,
      "/api/me",
      { displayName: "老板" },
      { cookie: admin }
    )
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: "DISPLAY_NAME_LOCKED" })
  })

  it("管理面读写往返：PUT profileLocks 回显，并即时拦截", async () => {
    const { env } = await initializedContext()
    await registerUser(env, { email: "owner@example.test" })
    const admin = await adminCookie(env)

    const put = await putJson(
      env,
      "/api/admin/settings",
      { profileLocks: { displayNameLocked: true } },
      { cookie: admin }
    )
    expect(put.status).toBe(200)
    expect(await put.json()).toMatchObject({
      profileLocks: { displayNameLocked: true }
    })

    const got = await request(env, "/api/admin/settings", {
      headers: { cookie: admin }
    })
    expect(await got.json()).toMatchObject({
      profileLocks: { displayNameLocked: true }
    })

    // 关掉：验证缺省字段不动
    const partial = await putJson(
      env,
      "/api/admin/settings",
      { profileLocks: { displayNameLocked: false } },
      { cookie: admin }
    )
    expect(await partial.json()).toMatchObject({
      profileLocks: { displayNameLocked: false }
    })
  })

  it("旧用户名锁字段被忽略：响应不含 usernameLocked，也不落设置", async () => {
    const { env, db } = await initializedContext()
    await registerUser(env, { email: "owner@example.test" })
    const admin = await adminCookie(env)

    const put = await putJson(
      env,
      "/api/admin/settings",
      { profileLocks: { usernameLocked: true } },
      { cookie: admin }
    )
    expect(put.status).toBe(200)
    const body = (await put.json()) as {
      profileLocks: Record<string, unknown>
    }
    expect(body.profileLocks).not.toHaveProperty("usernameLocked")
    expect(
      db.db
        .prepare(
          `SELECT value FROM ${settingsTable(activePrefix(env))} WHERE key = ?`
        )
        .get("profile_username_locked")
    ).toBeUndefined()
  })
})

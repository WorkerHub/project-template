/**
 * 规格 §5.6 第 4 条「未配置守卫」：
 * - 邮件未配置时「注册需邮箱验证」开关不可开启（后端拒绝，前端置灰靠
 *   `/api/public.emailConfigured`）；
 * - 开关已开但 provider 被清空 → 验证要求按未配置处理，已注册未验证的用户
 *   不会被锁死（登录自动按未验证口径放行并自愈标记）。
 */
import { afterEach, describe, expect, it } from "vitest"
import { usersTable } from "../src/lib/tables"
import {
  activePrefix,
  codeFromEmail,
  configureResend,
  cookieFrom,
  initializedContext,
  loginUser,
  postJson,
  putJson,
  registerUser,
  request,
  stubResend,
  writeSetting,
  type FetchStub
} from "./support/app"

let stub: FetchStub | null = null

afterEach(() => {
  stub?.restore()
  stub = null
})

async function adminCookie(
  env: Parameters<typeof loginUser>[0]
): Promise<string> {
  return cookieFrom(await loginUser(env, { email: "owner@example.test" }))
}

describe("邮件未配置守卫", () => {
  it("邮件未配置时不允许开启「注册需邮箱验证」", async () => {
    const { env } = await initializedContext()
    await registerUser(env, { email: "owner@example.test" })
    const admin = await adminCookie(env)

    const res = await putJson(
      env,
      "/api/admin/settings",
      { registration: { emailVerificationRequired: true } },
      { cookie: admin }
    )
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe(
      "EMAIL_NOT_CONFIGURED"
    )

    const view = (await (
      await request(env, "/api/admin/settings", { headers: { cookie: admin } })
    ).json()) as { registration: { emailVerificationRequired: boolean } }
    expect(view.registration.emailVerificationRequired).toBe(false)
  })

  it("开启后新注册用户必须验证邮箱才能登录；验证后放行", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    configureResend(db, prefix)
    stub = stubResend()
    await registerUser(env, { email: "owner@example.test" })
    const admin = await adminCookie(env)

    const enable = await putJson(
      env,
      "/api/admin/settings",
      {
        registration: {
          emailVerificationRequired: true,
          approvalRequired: false
        }
      },
      { cookie: admin }
    )
    expect(enable.status).toBe(200)

    const registered = await registerUser(env, {
      email: "second@example.test",
      language: "en"
    })
    expect(registered.status).toBe(201)
    expect(await registered.json()).toEqual({
      requiresApproval: false,
      requiresEmailVerification: true
    })

    const row = db.db
      .prepare(
        `SELECT email_verified FROM ${usersTable(prefix)} WHERE email = ?`
      )
      .get("second@example.test") as { email_verified: number }
    expect(row.email_verified).toBe(0)

    const blocked = await loginUser(env, { email: "second@example.test" })
    expect(blocked.status).toBe(403)
    expect(((await blocked.json()) as { code: string }).code).toBe(
      "EMAIL_NOT_VERIFIED"
    )

    expect(stub.sent).toHaveLength(1)
    expect(stub.sent[0].subject.toLowerCase()).toContain("verification code")
    const code = codeFromEmail(stub.sent[0])

    const verified = await postJson(env, "/api/auth/email/verify", {
      email: "second@example.test",
      code
    })
    expect(verified.status).toBe(200)

    expect(
      (await loginUser(env, { email: "second@example.test" })).status
    ).toBe(200)
  })

  it("provider 被清空后：注册不再强制验证，已验证标记可自愈，用户不被锁死", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    configureResend(db, prefix)
    stub = stubResend()
    await registerUser(env, { email: "owner@example.test" })
    const admin = await adminCookie(env)
    await putJson(
      env,
      "/api/admin/settings",
      {
        registration: {
          emailVerificationRequired: true,
          approvalRequired: false
        }
      },
      { cookie: admin }
    )

    // 关掉邮件通道，但验证开关仍然是开着的
    writeSetting(db, prefix, "email_provider", "none")
    const publicBody = (await (await request(env, "/api/public")).json()) as {
      emailConfigured: boolean
    }
    expect(publicBody.emailConfigured).toBe(false)

    // 新注册用户：按未配置口径直接视为已验证，不发码
    const registered = await registerUser(env, {
      email: "late@example.test"
    })
    expect(await registered.json()).toEqual({
      requiresApproval: false,
      requiresEmailVerification: false
    })

    // 已经处于「未验证」但邮件撤走的老用户：登录放行并自愈
    db.db
      .prepare(
        `UPDATE ${usersTable(prefix)} SET email_verified = 0 WHERE email = ?`
      )
      .run("late@example.test")
    expect((await loginUser(env, { email: "late@example.test" })).status).toBe(
      200
    )
    const healed = db.db
      .prepare(
        `SELECT email_verified FROM ${usersTable(prefix)} WHERE email = ?`
      )
      .get("late@example.test") as { email_verified: number }
    expect(healed.email_verified).toBe(1)
  })

  it("重发冷却 60 秒：同一邮箱第二次立刻重发回 429 CODE_COOLDOWN", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    configureResend(db, prefix)
    stub = stubResend()
    await registerUser(env, { email: "owner@example.test" })
    const admin = await adminCookie(env)
    await putJson(
      env,
      "/api/admin/settings",
      {
        registration: {
          emailVerificationRequired: true,
          approvalRequired: false
        }
      },
      { cookie: admin }
    )
    await registerUser(env, { email: "second@example.test" })
    const sentAfterRegistration = stub.sent.length

    // 每次换一个出口 IP，避免 3 次/300s 的 IP 桶先耗尽、把冷却断言盖掉。
    const first = await postJson(
      env,
      "/api/auth/email/resend",
      { email: "second@example.test" },
      { "cf-connecting-ip": "203.0.113.1" }
    )
    expect(first.status).toBe(200)
    expect(stub.sent.length).toBe(sentAfterRegistration + 1)

    const second = await postJson(
      env,
      "/api/auth/email/resend",
      { email: "second@example.test" },
      { "cf-connecting-ip": "203.0.113.2" }
    )
    expect(second.status).toBe(429)
    const body = (await second.json()) as { code: string; retryAfter: number }
    expect(body.code).toBe("CODE_COOLDOWN")
    expect(body.retryAfter).toBeGreaterThan(0)
    // 冷却期内不再发信
    expect(stub.sent.length).toBe(sentAfterRegistration + 1)

    // 不存在的邮箱走同一冷却：两次探测形状一致，不构成枚举信号
    const ghostFirst = await postJson(
      env,
      "/api/auth/email/resend",
      { email: "ghost@example.test" },
      { "cf-connecting-ip": "203.0.113.3" }
    )
    expect(ghostFirst.status).toBe(200)
    const ghostSecond = await postJson(
      env,
      "/api/auth/email/resend",
      { email: "ghost@example.test" },
      { "cf-connecting-ip": "203.0.113.4" }
    )
    expect(ghostSecond.status).toBe(429)
    expect(((await ghostSecond.json()) as { code: string }).code).toBe(
      "CODE_COOLDOWN"
    )
  })

  it("注册邮箱验证码重发：未配置时 503，且不泄露账号是否存在", async () => {
    const { env } = await initializedContext()
    const res = await postJson(env, "/api/auth/email/resend", {
      email: "whoever@example.test"
    })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { code: string }).code).toBe(
      "EMAIL_NOT_CONFIGURED"
    )
  })
})

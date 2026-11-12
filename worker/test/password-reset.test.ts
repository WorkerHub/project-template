/**
 * 规格 §7-9（找回密码）：
 * - 发码 → 验码 → 改密，成功后该用户全部会话失效；
 * - 防枚举：存在与不存在的邮箱返回同一状态与同一文案，且都不泄露；
 * - 未配置邮件时 503 `EMAIL_NOT_CONFIGURED`（入口由 /api/public 隐藏）；
 * - 验证码邮件按请求时界面语言渲染（无账号场景）。
 */
import { afterEach, describe, expect, it } from "vitest"
import {
  activePrefix,
  codeFromEmail,
  configureResend,
  cookieFrom,
  initializedContext,
  loginUser,
  postJson,
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

async function meStatus(
  env: Parameters<typeof request>[0],
  cookie: string
): Promise<number> {
  return (await request(env, "/api/me", { headers: { cookie } })).status
}

describe("找回密码", () => {
  it("全流程：发码 → 验码 → 改密，旧会话全部失效", async () => {
    const { env, db } = await initializedContext()
    configureResend(db, activePrefix(env))
    stub = stubResend()

    await registerUser(env, { email: "owner@example.test" })
    const first = cookieFrom(
      await loginUser(env, { email: "owner@example.test" })
    )
    const second = cookieFrom(
      await loginUser(env, { email: "owner@example.test" })
    )
    expect(await meStatus(env, first)).toBe(200)

    const forgot = await postJson(env, "/api/auth/password/forgot", {
      email: "owner@example.test",
      language: "zh"
    })
    expect(forgot.status).toBe(200)
    expect(stub.sent).toHaveLength(1)
    expect(stub.sent[0].to).toBe("owner@example.test")
    const code = codeFromEmail(stub.sent[0])

    const wrong = await postJson(env, "/api/auth/password/reset", {
      email: "owner@example.test",
      code: code === "000000" ? "111111" : "000000",
      newPassword: "new-password-12345"
    })
    expect(wrong.status).toBe(400)
    expect(((await wrong.json()) as { code: string }).code).toBe("INVALID_CODE")

    const reset = await postJson(env, "/api/auth/password/reset", {
      email: "owner@example.test",
      code,
      newPassword: "new-password-12345"
    })
    expect(reset.status).toBe(200)

    expect(await meStatus(env, first)).toBe(401)
    expect(await meStatus(env, second)).toBe(401)

    const oldPassword = await loginUser(env, { email: "owner@example.test" })
    expect(oldPassword.status).toBe(401)
    const newPassword = await loginUser(env, {
      email: "owner@example.test",
      password: "new-password-12345"
    })
    expect(newPassword.status).toBe(200)

    // 同一个码不能再换一次密码
    const reuse = await postJson(env, "/api/auth/password/reset", {
      email: "owner@example.test",
      code,
      newPassword: "yet-another-password"
    })
    expect(reuse.status).toBe(400)
  })

  it("防枚举：存在与不存在的邮箱同状态同文案，且不发给不存在的人", async () => {
    const { env, db } = await initializedContext()
    configureResend(db, activePrefix(env))
    stub = stubResend()
    await registerUser(env, { email: "owner@example.test" })

    const known = await postJson(env, "/api/auth/password/forgot", {
      email: "owner@example.test"
    })
    const unknown = await postJson(env, "/api/auth/password/forgot", {
      email: "nobody@example.test"
    })
    expect(known.status).toBe(200)
    expect(unknown.status).toBe(200)
    expect(await known.text()).toBe(await unknown.text())
    expect(stub.sent).toHaveLength(1)
    expect(stub.sent[0].to).toBe("owner@example.test")

    // 不存在账号的 reset 与错码同形
    const resetUnknown = await postJson(env, "/api/auth/password/reset", {
      email: "nobody@example.test",
      code: "123456",
      newPassword: "third-password-123"
    })
    expect(resetUnknown.status).toBe(400)
    expect(((await resetUnknown.json()) as { code: string }).code).toBe(
      "INVALID_CODE"
    )
  })

  it("未配置邮件时 503 EMAIL_NOT_CONFIGURED", async () => {
    const { env } = await initializedContext()
    const res = await postJson(env, "/api/auth/password/forgot", {
      email: "owner@example.test"
    })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { code: string }).code).toBe(
      "EMAIL_NOT_CONFIGURED"
    )
  })

  it("无账号场景按请求语言发英文模板", async () => {
    const { env, db } = await initializedContext()
    configureResend(db, activePrefix(env))
    stub = stubResend()
    await registerUser(env, { email: "owner@example.test", language: "en" })

    const res = await postJson(env, "/api/auth/password/forgot", {
      email: "owner@example.test",
      language: "en"
    })
    expect(res.status).toBe(200)
    expect(stub.sent[0].subject.toLowerCase()).toContain("password reset")
    expect(stub.sent[0].text).toContain("Your password reset code is")
  })

  it("重发冷却 60 秒（CODE_COOLDOWN），冷却判定在账号查询之前", async () => {
    const { env, db } = await initializedContext()
    configureResend(db, activePrefix(env))
    stub = stubResend()
    await registerUser(env, { email: "owner@example.test" })
    writeSetting(db, activePrefix(env), "email_provider", "resend")

    expect(
      (
        await postJson(env, "/api/auth/password/forgot", {
          email: "owner@example.test"
        })
      ).status
    ).toBe(200)
    const second = await postJson(env, "/api/auth/password/forgot", {
      email: "owner@example.test"
    })
    expect(second.status).toBe(429)
    const body = (await second.json()) as { code: string; retryAfter: number }
    expect(body.code).toBe("CODE_COOLDOWN")
    expect(body.retryAfter).toBeGreaterThan(0)

    // 不存在的邮箱同样被冷却（不泄露账号是否存在）
    const unknownFirst = await postJson(env, "/api/auth/password/forgot", {
      email: "nobody@example.test"
    })
    const unknownSecond = await postJson(env, "/api/auth/password/forgot", {
      email: "nobody@example.test"
    })
    expect(unknownFirst.status).toBe(200)
    expect(unknownSecond.status).toBe(429)
  })

  it("登录页找回入口依赖 public.emailConfigured", async () => {
    const { env, db } = await initializedContext()
    const before = (await (await request(env, "/api/public")).json()) as {
      emailConfigured: boolean
    }
    expect(before.emailConfigured).toBe(false)

    configureResend(db, activePrefix(env))
    const after = (await (await request(env, "/api/public")).json()) as {
      emailConfigured: boolean
    }
    expect(after.emailConfigured).toBe(true)
  })
})

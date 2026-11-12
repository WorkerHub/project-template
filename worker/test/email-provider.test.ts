/**
 * 规格 §7-9（邮件子系统）：
 * - provider 单选生效：smtp 与 resend 各以 stub 跑通成功与错误路径；
 * - `email_configured` 的三种未配置形态；
 * - 凭据读回脱敏、保存留空不改；
 * - 测试邮件把 provider 原文错误回显（`detail`）。
 */
import { afterEach, describe, expect, it, vi } from "vitest"

const smtpMock = vi.hoisted(() => ({
  sendSmtpMessage: vi.fn(async (_config: unknown, _message: unknown) => ({
    success: true
  }))
}))

vi.mock("../src/services/smtp-transport", () => smtpMock)

import {
  isEmailConfigured,
  readEmailSettings,
  readSmtpConfig,
  saveEmailSettings,
  sendEmail
} from "../src/services/email"
import type { Env } from "../src/types"
import {
  activePrefix,
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
  type FetchStub,
  type TestContext
} from "./support/app"

let stub: FetchStub | null = null

afterEach(() => {
  stub?.restore()
  stub = null
  smtpMock.sendSmtpMessage.mockReset()
  smtpMock.sendSmtpMessage.mockResolvedValue({ success: true })
})

function configureSmtp(context: TestContext): void {
  const prefix = activePrefix(context.env)
  writeSetting(context.db, prefix, "email_provider", "smtp")
  writeSetting(
    context.db,
    prefix,
    "smtp_config",
    JSON.stringify({
      host: "smtp.example.test",
      port: 587,
      username: "mailer",
      password: "smtp-secret",
      from: "noreply@example.test",
      from_name: "Template"
    })
  )
}

describe("email_configured 单一判断", () => {
  it("provider=none / smtp 缺 host / resend 缺 api_key 都算未配置", async () => {
    const context = await initializedContext()
    const { env, db } = context
    const prefix = activePrefix(env)

    expect(await isEmailConfigured(env)).toBe(false)

    writeSetting(db, prefix, "email_provider", "smtp")
    writeSetting(db, prefix, "smtp_config", JSON.stringify({ host: "" }))
    expect(await isEmailConfigured(env)).toBe(false)

    writeSetting(db, prefix, "email_provider", "resend")
    writeSetting(db, prefix, "resend_config", JSON.stringify({ api_key: "" }))
    expect(await isEmailConfigured(env)).toBe(false)

    configureResend(db, prefix)
    expect(await isEmailConfigured(env)).toBe(true)
  })
})

describe("发送通道", () => {
  it("resend：成功与错误原文回显", async () => {
    const { env, db } = await initializedContext()
    configureResend(db, activePrefix(env))

    stub = stubResend()
    const ok = await sendEmail(env, {
      to: "user@example.test",
      subject: "hi",
      html: "<p>hi</p>",
      text: "hi"
    })
    expect(ok).toEqual({ success: true })
    expect(stub.sent[0]).toMatchObject({
      to: "user@example.test",
      subject: "hi",
      text: "hi",
      from: "Template <noreply@example.test>"
    })
    stub.restore()

    stub = stubResend({
      fail: { status: 422, body: '{"message":"invalid from"}' }
    })
    const failed = await sendEmail(env, {
      to: "user@example.test",
      subject: "hi",
      html: "<p>hi</p>"
    })
    expect(failed.success).toBe(false)
    expect(failed.error).toContain("invalid from")
  })

  it("smtp：走移植的传输层，成功与错误都原样返回", async () => {
    const context = await initializedContext()
    configureSmtp(context)

    const ok = await sendEmail(context.env, {
      to: "user@example.test",
      subject: "hi",
      html: "<p>hi</p>",
      text: "hi"
    })
    expect(ok).toEqual({ success: true })
    expect(smtpMock.sendSmtpMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.example.test",
        port: 587,
        username: "mailer",
        password: "smtp-secret"
      }),
      expect.objectContaining({
        to: "user@example.test",
        from: "noreply@example.test",
        fromName: "Template"
      })
    )

    smtpMock.sendSmtpMessage.mockResolvedValueOnce({
      success: false,
      error: "SMTP error: 550 mailbox unavailable"
    })
    const failed = await sendEmail(context.env, {
      to: "user@example.test",
      subject: "hi",
      html: "<p>hi</p>"
    })
    expect(failed.error).toContain("550 mailbox unavailable")
  })

  it("provider 单选：两套配置都在时只走生效的那一个", async () => {
    const context = await initializedContext()
    const { env, db } = context
    const prefix = activePrefix(env)
    configureSmtp(context)
    writeSetting(
      db,
      prefix,
      "resend_config",
      JSON.stringify({ api_key: "re_key", from: "a@b.c" })
    )
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    await sendEmail(env, { to: "user@example.test", subject: "s", html: "h" })
    expect(smtpMock.sendSmtpMessage).toHaveBeenCalledTimes(1)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it("收件人非法直接失败，不发请求", async () => {
    const context = await initializedContext()
    configureSmtp(context)
    const result = await sendEmail(context.env, {
      to: "not-an-email",
      subject: "s",
      html: "h"
    })
    expect(result.success).toBe(false)
    expect(smtpMock.sendSmtpMessage).not.toHaveBeenCalled()
  })
})

describe("配置读写", () => {
  it("读回只给 passwordSet/apiKeySet，密钥本体不出现在任何视图里", async () => {
    const { env } = await initializedContext()
    const saved = await saveEmailSettings(env, {
      provider: "smtp",
      smtp: {
        host: "smtp.example.test",
        port: 465,
        username: "mailer",
        password: "smtp-secret",
        from: "noreply@example.test",
        fromName: "Template"
      }
    })
    expect(saved.ok).toBe(true)

    const view = await readEmailSettings(env)
    expect(view.provider).toBe("smtp")
    expect(view.smtp.passwordSet).toBe(true)
    expect(JSON.stringify(view)).not.toContain("smtp-secret")
  })

  it("保存时留空 = 不改已存凭据；切回 none 不清空配置", async () => {
    const { env } = await initializedContext()
    await saveEmailSettings(env, {
      provider: "smtp",
      smtp: { host: "smtp.example.test", password: "smtp-secret" }
    })
    await saveEmailSettings(env, { smtp: { password: "" } })
    expect((await readSmtpConfig(env))?.password).toBe("smtp-secret")

    await saveEmailSettings(env, { provider: "none" })
    expect(await isEmailConfigured(env)).toBe(false)
    expect((await readSmtpConfig(env))?.password).toBe("smtp-secret")
  })

  it("配置校验：非法邮箱、CR/LF、端口范围都拒绝", async () => {
    const { env } = await initializedContext()
    const badFrom = await saveEmailSettings(env, {
      smtp: { from: "not-an-email" }
    })
    expect(badFrom.ok).toBe(false)

    const injection = await saveEmailSettings(env, {
      smtp: { fromName: "x\r\nBcc: evil@example.test" }
    })
    expect(injection.ok).toBe(false)

    const badPort = await saveEmailSettings(env, { smtp: { port: 70_000 } })
    expect(badPort.ok).toBe(false)
  })
})

describe("管理面发送测试邮件", () => {
  async function adminEnv(): Promise<{
    env: Env
    cookie: string
    context: TestContext
  }> {
    const context = await initializedContext()
    await registerUser(context.env, { email: "owner@example.test" })
    const cookie = cookieFrom(
      await loginUser(context.env, { email: "owner@example.test" })
    )
    return { env: context.env, cookie, context }
  }

  it("未配置 → 409 EMAIL_NOT_CONFIGURED", async () => {
    const { env, cookie } = await adminEnv()
    const res = await postJson(
      env,
      "/api/admin/settings/test-email",
      { to: "user@example.test" },
      { cookie }
    )
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe(
      "EMAIL_NOT_CONFIGURED"
    )
  })

  it("provider 报错 → 502 EMAIL_SEND_FAILED 且带 detail 原文", async () => {
    const { env, cookie, context } = await adminEnv()
    configureResend(context.db, activePrefix(env))
    stub = stubResend({
      fail: { status: 401, body: '{"message":"API key is invalid"}' }
    })

    const res = await postJson(
      env,
      "/api/admin/settings/test-email",
      { to: "user@example.test" },
      { cookie }
    )
    expect(res.status).toBe(502)
    const body = (await res.json()) as { code: string; detail: string }
    expect(body.code).toBe("EMAIL_SEND_FAILED")
    expect(body.detail).toContain("API key is invalid")
  })

  it("成功 → 200 {success:true}", async () => {
    const { env, cookie, context } = await adminEnv()
    configureResend(context.db, activePrefix(env))
    stub = stubResend()

    const res = await postJson(
      env,
      "/api/admin/settings/test-email",
      { to: "user@example.test" },
      { cookie }
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(stub.sent).toHaveLength(1)
  })

  it("管理面保存配置后读回仍脱敏", async () => {
    const { env, cookie } = await adminEnv()
    const put = await putJson(
      env,
      "/api/admin/settings",
      {
        email: {
          provider: "resend",
          resend: {
            apiKey: "re_live_key",
            from: "noreply@example.test",
            fromName: "Template"
          }
        }
      },
      { cookie }
    )
    expect(put.status).toBe(200)
    const body = (await put.json()) as {
      email: { configured: boolean; resend: { apiKeySet: boolean } }
    }
    expect(body.email.configured).toBe(true)
    expect(body.email.resend.apiKeySet).toBe(true)
    expect(JSON.stringify(body)).not.toContain("re_live_key")
    void request
  })
})

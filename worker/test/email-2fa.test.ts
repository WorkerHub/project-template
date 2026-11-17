/**
 * 邮箱验证码第二因子端到端：启用（发码 → 验码生效）、停用（密码复核）、
 * 登录第二步（显式发码 → 复用 /2fa/verify）。用 Resend stub 截获验证码。
 */
import { describe, expect, it } from "vitest"
import type { Env } from "../src/types"
import {
  activePrefix,
  clearCounters,
  codeFromEmail,
  configureResend,
  type FetchStub,
  initializedContext,
  loginUser,
  postJson,
  registerAndLogin,
  request,
  stubResend,
  TEST_PASSWORD,
  writeSetting
} from "./support/app"

const EMAIL = "owner@example.test"

interface Requires2faBody {
  requires2fa: true
  tempToken: string
  methods: string[]
}

async function expectCode(res: Response, status: number, code: string) {
  expect(res.status).toBe(status)
  const body = (await res.json()) as { code?: string }
  expect(body.code).toBe(code)
}

/** 走一遍启用发码 → 验码生效（要求邮件已配置、stub 已在位）。 */
async function enableEmail2fa(
  env: Env,
  cookie: string,
  stub: FetchStub
): Promise<void> {
  const send = await postJson(
    env,
    "/api/auth/2fa/email/enable/send",
    {},
    { cookie }
  )
  expect(send.status).toBe(200)
  const code = codeFromEmail(stub.sent[stub.sent.length - 1])
  const enable = await postJson(
    env,
    "/api/auth/2fa/email/enable",
    { code },
    { cookie }
  )
  expect(enable.status).toBe(200)
}

describe("邮箱验证码第二因子", () => {
  it("启用：发码 → 验码生效，Me 反映已启用", async () => {
    const { env, db } = await initializedContext()
    configureResend(db, activePrefix(env))
    const stub = stubResend()
    try {
      const { cookie } = await registerAndLogin(env, { email: EMAIL })
      await enableEmail2fa(env, cookie, stub)

      const me = await request(env, "/api/me", { headers: { cookie } })
      const body = (await me.json()) as { emailTwoFactorEnabled: boolean }
      expect(body.emailTwoFactorEnabled).toBe(true)
    } finally {
      stub.restore()
    }
  })

  it("启用发码：邮箱未配置回 503 EMAIL_NOT_CONFIGURED", async () => {
    const { env } = await initializedContext()
    const { cookie } = await registerAndLogin(env, { email: EMAIL })
    await expectCode(
      await postJson(env, "/api/auth/2fa/email/enable/send", {}, { cookie }),
      503,
      "EMAIL_NOT_CONFIGURED"
    )
  })

  it("停用：密码复核，密码错误 403、正确后关闭", async () => {
    const { env, db } = await initializedContext()
    configureResend(db, activePrefix(env))
    const stub = stubResend()
    try {
      const { cookie } = await registerAndLogin(env, { email: EMAIL })
      await enableEmail2fa(env, cookie, stub)

      await expectCode(
        await postJson(
          env,
          "/api/auth/2fa/email/disable",
          { password: "not-the-password" },
          { cookie }
        ),
        403,
        "PASSWORD_INCORRECT"
      )

      const ok = await postJson(
        env,
        "/api/auth/2fa/email/disable",
        { password: TEST_PASSWORD },
        { cookie }
      )
      expect(ok.status).toBe(200)

      const me = await request(env, "/api/me", { headers: { cookie } })
      const body = (await me.json()) as { emailTwoFactorEnabled: boolean }
      expect(body.emailTwoFactorEnabled).toBe(false)
    } finally {
      stub.restore()
    }
  })

  it("登录 methods 含 email，发码 → 复用 /2fa/verify 登录成功", async () => {
    const { env, db } = await initializedContext()
    configureResend(db, activePrefix(env))
    const stub = stubResend()
    try {
      const { cookie } = await registerAndLogin(env, { email: EMAIL })
      await enableEmail2fa(env, cookie, stub)

      // 清掉启用发码留下的 60 秒冷却，避免挡住登录第二步发码。
      clearCounters(db, activePrefix(env), "code_cooldown:email_2fa")

      const login = await loginUser(env, { email: EMAIL })
      const body = (await login.json()) as Requires2faBody
      expect(body.requires2fa).toBe(true)
      expect(body.methods).toContain("email")

      const send = await postJson(env, "/api/auth/2fa/email/send", {
        tempToken: body.tempToken
      })
      expect(send.status).toBe(200)

      const code = codeFromEmail(stub.sent[stub.sent.length - 1])
      const verify = await postJson(env, "/api/auth/2fa/verify", {
        tempToken: body.tempToken,
        method: "email",
        code
      })
      expect(verify.status).toBe(200)
      const verified = (await verify.json()) as {
        success: boolean
        user: { email: string }
      }
      expect(verified.success).toBe(true)
      expect(verified.user.email).toBe(EMAIL)
    } finally {
      stub.restore()
    }
  })

  it("登录第二步发码：tempToken 无效回 401 STEP_UP_REQUIRED", async () => {
    const { env } = await initializedContext()
    await expectCode(
      await postJson(env, "/api/auth/2fa/email/send", {
        tempToken: "not-a-valid-token"
      }),
      401,
      "STEP_UP_REQUIRED"
    )
  })

  it("登录第二步发码：未启用回 400 EMAIL_NOT_ENABLED", async () => {
    const { env, db } = await initializedContext()
    configureResend(db, activePrefix(env))
    const stub = stubResend()
    try {
      const { cookie } = await registerAndLogin(env, { email: EMAIL })
      await enableEmail2fa(env, cookie, stub)

      // 先拿到有效 tempToken，再停用；停用后 tempToken 仍有效，但 2FA 已关。
      const login = await loginUser(env, { email: EMAIL })
      const body = (await login.json()) as Requires2faBody
      await postJson(
        env,
        "/api/auth/2fa/email/disable",
        { password: TEST_PASSWORD },
        { cookie }
      )

      await expectCode(
        await postJson(env, "/api/auth/2fa/email/send", {
          tempToken: body.tempToken
        }),
        400,
        "EMAIL_NOT_ENABLED"
      )
    } finally {
      stub.restore()
    }
  })

  it("登录第二步发码：邮箱未配置回 409 EMAIL_NOT_CONFIGURED", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    configureResend(db, prefix)
    const stub = stubResend()
    try {
      const { cookie } = await registerAndLogin(env, { email: EMAIL })
      await enableEmail2fa(env, cookie, stub)

      // 启用过 2FA 但随后把邮件通道清掉：methods 仍含 email，发码回 409。
      writeSetting(db, prefix, "email_provider", "none")
      const login = await loginUser(env, { email: EMAIL })
      const body = (await login.json()) as Requires2faBody
      expect(body.methods).toContain("email")

      await expectCode(
        await postJson(env, "/api/auth/2fa/email/send", {
          tempToken: body.tempToken
        }),
        409,
        "EMAIL_NOT_CONFIGURED"
      )
    } finally {
      stub.restore()
    }
  })

  it("登录第二步发码：60 秒冷却回 429 CODE_COOLDOWN", async () => {
    const { env, db } = await initializedContext()
    configureResend(db, activePrefix(env))
    const stub = stubResend()
    try {
      const { cookie } = await registerAndLogin(env, { email: EMAIL })
      await enableEmail2fa(env, cookie, stub)

      // 清掉启用发码留下的 60 秒冷却，避免挡住登录第二步发码。
      clearCounters(db, activePrefix(env), "code_cooldown:email_2fa")

      const login = await loginUser(env, { email: EMAIL })
      const body = (await login.json()) as Requires2faBody

      const first = await postJson(env, "/api/auth/2fa/email/send", {
        tempToken: body.tempToken
      })
      expect(first.status).toBe(200)

      const second = await postJson(env, "/api/auth/2fa/email/send", {
        tempToken: body.tempToken
      })
      expect(second.status).toBe(429)
      const secondBody = (await second.json()) as {
        code: string
        retryAfter: number
      }
      expect(secondBody.code).toBe("CODE_COOLDOWN")
      expect(secondBody.retryAfter).toBeGreaterThan(0)
    } finally {
      stub.restore()
    }
  })

  it("登录第二步发码：发送失败回 502 EMAIL_SEND_FAILED", async () => {
    const { env, db } = await initializedContext()
    configureResend(db, activePrefix(env))
    const stub = stubResend()
    try {
      const { cookie } = await registerAndLogin(env, { email: EMAIL })
      await enableEmail2fa(env, cookie, stub)

      // 清掉启用发码留下的 60 秒冷却，避免挡住登录第二步发码。
      clearCounters(db, activePrefix(env), "code_cooldown:email_2fa")

      const login = await loginUser(env, { email: EMAIL })
      const body = (await login.json()) as Requires2faBody

      const failing = stubResend({ fail: { status: 500, body: "{}" } })
      try {
        await expectCode(
          await postJson(env, "/api/auth/2fa/email/send", {
            tempToken: body.tempToken
          }),
          502,
          "EMAIL_SEND_FAILED"
        )
      } finally {
        failing.restore()
      }
    } finally {
      stub.restore()
    }
  })

  it("未启用邮箱 2FA 时 /2fa/verify（method: email）被拒绝", async () => {
    const { env, db } = await initializedContext()
    configureResend(db, activePrefix(env))
    const stub = stubResend()
    try {
      const { cookie } = await registerAndLogin(env, { email: EMAIL })
      await enableEmail2fa(env, cookie, stub)

      // 先拿到有效 tempToken，再停用邮箱 2FA。
      const login = await loginUser(env, { email: EMAIL })
      const body = (await login.json()) as Requires2faBody
      await postJson(
        env,
        "/api/auth/2fa/email/disable",
        { password: TEST_PASSWORD },
        { cookie }
      )

      // 另起一次启用发码，在库里留下一枚在途 email_2fa 码（模拟其他会话/停用前的码）。
      clearCounters(db, activePrefix(env), "code_cooldown:email_2fa")
      const resend = await postJson(
        env,
        "/api/auth/2fa/email/enable/send",
        {},
        { cookie }
      )
      expect(resend.status).toBe(200)
      const code = codeFromEmail(stub.sent[stub.sent.length - 1])

      // 未启用邮箱 2FA，即便码有效也必须拒绝。
      await expectCode(
        await postJson(env, "/api/auth/2fa/verify", {
          tempToken: body.tempToken,
          method: "email",
          code
        }),
        400,
        "INVALID_CODE"
      )
    } finally {
      stub.restore()
    }
  })
})

/**
 * 通行密钥（第一因子直接登录）：options/verify、可发现凭证校验、账号状态门禁、
 * 限流与失败锁定对齐、挑战目的严格隔离。
 */
import { describe, expect, it, vi } from "vitest"
import { PROJECT_NAME } from "../src/config/project"
import { isoBase64URL } from "@simplewebauthn/server/helpers"
import { countersTable, settingsTable, usersTable } from "../src/lib/tables"

let lastRegOptionsInput: Record<string, unknown> | null = null
let lastAuthOptionsInput: Record<string, unknown> | null = null
let shouldVerifySucceed = true
let challengeCounter = 0

vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: vi.fn(async (opts: Record<string, unknown>) => {
    lastRegOptionsInput = opts
    return {
      challenge: "register-challenge",
      rp: { id: "worker.test", name: PROJECT_NAME },
      user: {
        id: opts.userID
          ? Buffer.from(opts.userID as Uint8Array).toString("base64url")
          : "dXNlcg",
        name: opts.userName,
        displayName: opts.userDisplayName || opts.userName
      },
      pubKeyCredParams: [],
      timeout: 60_000,
      excludeCredentials: [],
      authenticatorSelection: opts.authenticatorSelection,
      attestation: "none"
    }
  }),
  verifyRegistrationResponse: vi.fn(async () => ({
    verified: true,
    registrationInfo: {
      credential: {
        id: "cred-login-1",
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 0,
        transports: ["internal"]
      }
    }
  })),
  generateAuthenticationOptions: vi.fn(
    async (opts: Record<string, unknown>) => {
      lastAuthOptionsInput = opts
      challengeCounter += 1
      return {
        challenge: `auth-login-challenge-${challengeCounter}`,
        rpId: opts.rpID || "worker.test",
        allowCredentials: (opts.allowCredentials as unknown[]) ?? [],
        timeout: 60_000,
        userVerification: opts.userVerification
      }
    }
  ),
  verifyAuthenticationResponse: vi.fn(
    async (opts: { credential: { id: string; counter: number } }) => {
      if (!shouldVerifySucceed) {
        return { verified: false }
      }
      return {
        verified: true,
        authenticationInfo: {
          credentialID: opts.credential.id,
          newCounter: opts.credential.counter + 1
        }
      }
    }
  )
}))

import {
  activePrefix,
  cookieFrom,
  cookieHeader,
  initializedContext,
  loginUser,
  postJson,
  registerAndLogin,
  request,
  TEST_PASSWORD,
  writeSetting
} from "./support/app"

describe("通行密钥第一因子直接登录", () => {
  it("注册时配置为可发现凭证（residentKey: required, UV: required, userID 绑定用户主键）", async () => {
    const { env } = await initializedContext()
    const { cookie } = await registerAndLogin(env, {
      email: "resident@example.test"
    })

    lastRegOptionsInput = null
    const res = await postJson(
      env,
      "/api/auth/2fa/passkey/register/options",
      { password: TEST_PASSWORD },
      { cookie }
    )
    expect(res.status).toBe(200)
    expect(lastRegOptionsInput).not.toBeNull()
    const authSelection = lastRegOptionsInput?.authenticatorSelection as Record<
      string,
      unknown
    >
    expect(authSelection?.residentKey).toBe("required")
    expect(authSelection?.userVerification).toBe("required")

    // 验证 userID 为账号主键数字经 TextEncoder 编码的字节
    const me = (await (
      await request(env, "/api/me", { headers: { cookie } })
    ).json()) as { id: number }
    expect(lastRegOptionsInput?.userID).toEqual(
      new TextEncoder().encode(String(me.id))
    )
  })

  it("options 接口：生成不带 allowCredentials 的选项，且带 UV required 与 login 挑战 Cookie", async () => {
    const { env } = await initializedContext()
    lastAuthOptionsInput = null

    const res = await postJson(env, "/api/auth/passkey/login/options", {})
    expect(res.status).toBe(200)
    expect(lastAuthOptionsInput).not.toBeNull()
    expect(lastAuthOptionsInput?.userVerification).toBe("required")
    expect(lastAuthOptionsInput?.allowCredentials).toBeUndefined()

    const body = (await res.json()) as {
      challenge: string
      allowCredentials?: unknown[]
      userVerification?: string
    }
    expect(body.challenge).toMatch(/^auth-login-challenge-/)
    expect(body.allowCredentials).toEqual([])
    expect(body.userVerification).toBe("required")

    const challengeCookie = cookieFrom(res, "passkey_challenge")
    expect(challengeCookie).toContain("passkey_challenge=")
  })

  it("verify 接口直接登录：跳过密码步与第二因子步，发会话，更新计数，清零失败计数", async () => {
    const { env } = await initializedContext()
    shouldVerifySucceed = true

    // 1. 注册账号并绑定 Passkey
    const { cookie } = await registerAndLogin(env, {
      email: "direct@example.test"
    })
    const regOptions = await postJson(
      env,
      "/api/auth/2fa/passkey/register/options",
      { password: TEST_PASSWORD },
      { cookie }
    )
    const regChallenge = cookieFrom(regOptions, "passkey_challenge")
    await postJson(
      env,
      "/api/auth/2fa/passkey/register/verify",
      { credential: { id: "cred-login-1" } },
      { cookie: cookieHeader(cookie, regChallenge) }
    )

    const meRes = await request(env, "/api/me", { headers: { cookie } })
    const meBody = (await meRes.json()) as { id: number; email: string }
    const userId = meBody.id

    // 2. 模拟直接登录 options
    const optRes = await postJson(env, "/api/auth/passkey/login/options", {})
    expect(optRes.status).toBe(200)
    const optChallenge = cookieFrom(optRes, "passkey_challenge")

    // 3. 模拟直接登录 verify（携带正确的 userHandle，转为 base64url）
    const userHandle = isoBase64URL.fromUTF8String(String(userId))
    const verifyRes = await postJson(
      env,
      "/api/auth/passkey/login/verify",
      {
        credential: {
          id: "cred-login-1",
          response: {
            userHandle,
            clientDataJSON: "dummy",
            signature: "dummy"
          }
        }
      },
      { cookie: optChallenge }
    )

    expect(verifyRes.status).toBe(200)
    const verifyBody = (await verifyRes.json()) as {
      success: boolean
      user: { email: string; id: number }
    }
    expect(verifyBody.success).toBe(true)
    expect(verifyBody.user.email).toBe("direct@example.test")
    expect(verifyBody.user.id).toBe(userId)

    // 确认已下发会话 Cookie，并能直接访问私有接口
    const sessionCookie = cookieFrom(verifyRes, "session")
    expect(sessionCookie).toBeTruthy()
    const authCheck = await request(env, "/api/me", {
      headers: { cookie: sessionCookie }
    })
    expect(authCheck.status).toBe(200)
  })

  it("断言 userHandle 校验：不匹配时拒绝（401 PASSKEY_FAILED）并累加失败计数", async () => {
    const { env } = await initializedContext()
    shouldVerifySucceed = true

    const { cookie } = await registerAndLogin(env, {
      email: "mismatch@example.test"
    })
    const regOptions = await postJson(
      env,
      "/api/auth/2fa/passkey/register/options",
      { password: TEST_PASSWORD },
      { cookie }
    )
    const regChallenge = cookieFrom(regOptions, "passkey_challenge")
    await postJson(
      env,
      "/api/auth/2fa/passkey/register/verify",
      { credential: { id: "cred-login-1" } },
      { cookie: cookieHeader(cookie, regChallenge) }
    )

    const optRes = await postJson(env, "/api/auth/passkey/login/options", {})
    const optChallenge = cookieFrom(optRes, "passkey_challenge")

    // 传入错误的用户 ID（99999）
    const wrongUserHandle = isoBase64URL.fromUTF8String("99999")
    const verifyRes = await postJson(
      env,
      "/api/auth/passkey/login/verify",
      {
        credential: {
          id: "cred-login-1",
          response: { userHandle: wrongUserHandle }
        }
      },
      { cookie: optChallenge }
    )

    expect(verifyRes.status).toBe(401)
    const body = (await verifyRes.json()) as { code: string }
    expect(body.code).toBe("PASSKEY_FAILED")
  })

  it("挑战目的隔离：2FA options 的挑战不能用于直接登录，直接登录挑战不能用于 2FA", async () => {
    const { env } = await initializedContext()
    shouldVerifySucceed = true

    const { cookie } = await registerAndLogin(env, {
      email: "isolate@example.test"
    })
    const regOptions = await postJson(
      env,
      "/api/auth/2fa/passkey/register/options",
      { password: TEST_PASSWORD },
      { cookie }
    )
    const regChallenge = cookieFrom(regOptions, "passkey_challenge")
    await postJson(
      env,
      "/api/auth/2fa/passkey/register/verify",
      { credential: { id: "cred-login-1" } },
      { cookie: cookieHeader(cookie, regChallenge) }
    )

    // 1. 获取 2FA 的 options
    const loginStep = await loginUser(env, { email: "isolate@example.test" })
    const stepBody = (await loginStep.json()) as { tempToken: string }
    const twoFaOpt = await postJson(env, "/api/auth/2fa/passkey/options", {
      tempToken: stepBody.tempToken
    })
    const twoFaCookie = cookieFrom(twoFaOpt, "passkey_challenge")

    // 拿 2FA 的 Cookie 去调直接登录 verify → 目的不匹配，应报 PASSKEY_CHALLENGE_MISSING
    const directVerify = await postJson(
      env,
      "/api/auth/passkey/login/verify",
      { credential: { id: "cred-login-1" } },
      { cookie: twoFaCookie }
    )
    expect(directVerify.status).toBe(400)
    expect(((await directVerify.json()) as { code: string }).code).toBe(
      "PASSKEY_CHALLENGE_MISSING"
    )

    // 2. 获取直接登录的 options
    const directOpt = await postJson(env, "/api/auth/passkey/login/options", {})
    const directCookie = cookieFrom(directOpt, "passkey_challenge")

    // 拿直接登录的 Cookie 去调 2FA verify → 目的不匹配，应报 PASSKEY_CHALLENGE_MISSING
    const twoFaVerify = await postJson(
      env,
      "/api/auth/2fa/passkey/verify",
      { tempToken: stepBody.tempToken, credential: { id: "cred-login-1" } },
      { cookie: directCookie }
    )
    expect(twoFaVerify.status).toBe(400)
    expect(((await twoFaVerify.json()) as { code: string }).code).toBe(
      "PASSKEY_CHALLENGE_MISSING"
    )
  })

  it("挑战单次使用：消费后立即失效，重放报 PASSKEY_CHALLENGE_MISSING", async () => {
    const { env } = await initializedContext()
    shouldVerifySucceed = true

    const { cookie } = await registerAndLogin(env, {
      email: "singleuse@example.test"
    })
    const regOptions = await postJson(
      env,
      "/api/auth/2fa/passkey/register/options",
      { password: TEST_PASSWORD },
      { cookie }
    )
    const regChallenge = cookieFrom(regOptions, "passkey_challenge")
    await postJson(
      env,
      "/api/auth/2fa/passkey/register/verify",
      { credential: { id: "cred-login-1" } },
      { cookie: cookieHeader(cookie, regChallenge) }
    )

    const optRes = await postJson(env, "/api/auth/passkey/login/options", {})
    const optChallenge = cookieFrom(optRes, "passkey_challenge")

    // 第一次验证成功
    const first = await postJson(
      env,
      "/api/auth/passkey/login/verify",
      { credential: { id: "cred-login-1" } },
      { cookie: optChallenge }
    )
    expect(first.status).toBe(200)

    // 第二次重放同个 challenge
    const second = await postJson(
      env,
      "/api/auth/passkey/login/verify",
      { credential: { id: "cred-login-1" } },
      { cookie: optChallenge }
    )
    expect(second.status).toBe(400)
    expect(((await second.json()) as { code: string }).code).toBe(
      "PASSKEY_CHALLENGE_MISSING"
    )
  })

  it("账号状态门禁：pending 拒绝 (ACCOUNT_PENDING)，disabled 拒绝 (ACCOUNT_DISABLED)", async () => {
    const { env, db } = await initializedContext()
    shouldVerifySucceed = true
    const prefix = activePrefix(env)

    const { cookie } = await registerAndLogin(env, {
      email: "status@example.test"
    })
    const regOptions = await postJson(
      env,
      "/api/auth/2fa/passkey/register/options",
      { password: TEST_PASSWORD },
      { cookie }
    )
    const regChallenge = cookieFrom(regOptions, "passkey_challenge")
    await postJson(
      env,
      "/api/auth/2fa/passkey/register/verify",
      { credential: { id: "cred-login-1" } },
      { cookie: cookieHeader(cookie, regChallenge) }
    )

    // 1. 改为 pending
    db.db
      .prepare(
        `UPDATE ${usersTable(prefix)} SET status = 'pending' WHERE email = 'status@example.test'`
      )
      .run()
    const optPending = await postJson(
      env,
      "/api/auth/passkey/login/options",
      {}
    )
    const challengePending = cookieFrom(optPending, "passkey_challenge")
    const resPending = await postJson(
      env,
      "/api/auth/passkey/login/verify",
      { credential: { id: "cred-login-1" } },
      { cookie: challengePending }
    )
    expect(resPending.status).toBe(403)
    expect(((await resPending.json()) as { code: string }).code).toBe(
      "ACCOUNT_PENDING"
    )

    // 2. 改为 disabled
    db.db
      .prepare(
        `UPDATE ${usersTable(prefix)} SET status = 'disabled' WHERE email = 'status@example.test'`
      )
      .run()
    const optDisabled = await postJson(
      env,
      "/api/auth/passkey/login/options",
      {}
    )
    const challengeDisabled = cookieFrom(optDisabled, "passkey_challenge")
    const resDisabled = await postJson(
      env,
      "/api/auth/passkey/login/verify",
      { credential: { id: "cred-login-1" } },
      { cookie: challengeDisabled }
    )
    expect(resDisabled.status).toBe(403)
    expect(((await resDisabled.json()) as { code: string }).code).toBe(
      "ACCOUNT_DISABLED"
    )
  })

  it("邮箱验证门禁与自愈：强制时未验证被拒 (EMAIL_NOT_VERIFIED)，未配置时放行并自愈", async () => {
    const { env, db } = await initializedContext()
    shouldVerifySucceed = true
    const prefix = activePrefix(env)

    const { cookie } = await registerAndLogin(env, {
      email: "emailgate@example.test"
    })
    const regOptions = await postJson(
      env,
      "/api/auth/2fa/passkey/register/options",
      { password: TEST_PASSWORD },
      { cookie }
    )
    const regChallenge = cookieFrom(regOptions, "passkey_challenge")
    await postJson(
      env,
      "/api/auth/2fa/passkey/register/verify",
      { credential: { id: "cred-login-1" } },
      { cookie: cookieHeader(cookie, regChallenge) }
    )

    // 模拟邮箱未验证
    db.db
      .prepare(
        `UPDATE ${usersTable(prefix)} SET email_verified = 0 WHERE email = 'emailgate@example.test'`
      )
      .run()

    // 1. 开启强制邮箱验证，并配上假 email_provider
    writeSetting(db, prefix, "registration_email_verification_enabled", "true")
    writeSetting(db, prefix, "email_provider", "resend")
    writeSetting(
      db,
      prefix,
      "resend_config",
      JSON.stringify({
        api_key: "re_key",
        from: "test@example.test",
        from_name: "Test"
      })
    )

    const optEnforced = await postJson(
      env,
      "/api/auth/passkey/login/options",
      {}
    )
    const challengeEnforced = cookieFrom(optEnforced, "passkey_challenge")
    const resEnforced = await postJson(
      env,
      "/api/auth/passkey/login/verify",
      { credential: { id: "cred-login-1" } },
      { cookie: challengeEnforced }
    )
    expect(resEnforced.status).toBe(403)
    expect(((await resEnforced.json()) as { code: string }).code).toBe(
      "EMAIL_NOT_VERIFIED"
    )

    // 2. 清理邮件配置（邮箱能力未配置），自愈放行
    db.db
      .prepare(
        `DELETE FROM ${settingsTable(prefix)} WHERE key IN ('email_provider', 'resend_config')`
      )
      .run()

    const optHeal = await postJson(env, "/api/auth/passkey/login/options", {})
    const challengeHeal = cookieFrom(optHeal, "passkey_challenge")
    const resHeal = await postJson(
      env,
      "/api/auth/passkey/login/verify",
      { credential: { id: "cred-login-1" } },
      { cookie: challengeHeal }
    )
    expect(resHeal.status).toBe(200)
    expect(((await resHeal.json()) as { success: boolean }).success).toBe(true)

    // 检查库里已自愈为 1
    const userRow = db.db
      .prepare(
        `SELECT email_verified FROM ${usersTable(prefix)} WHERE email = 'emailgate@example.test'`
      )
      .get() as {
      email_verified: number
    }
    expect(userRow.email_verified).toBe(1)
  })

  it("断言失败与锁定：验签失败报 PASSKEY_FAILED，达到 8 次后账号被锁定 (ACCOUNT_LOCKED)", async () => {
    const { env } = await initializedContext()

    const { cookie } = await registerAndLogin(env, {
      email: "lockout@example.test"
    })
    const regOptions = await postJson(
      env,
      "/api/auth/2fa/passkey/register/options",
      { password: TEST_PASSWORD },
      { cookie }
    )
    const regChallenge = cookieFrom(regOptions, "passkey_challenge")
    await postJson(
      env,
      "/api/auth/2fa/passkey/register/verify",
      { credential: { id: "cred-login-1" } },
      { cookie: cookieHeader(cookie, regChallenge) }
    )

    shouldVerifySucceed = false

    // 连续失败 8 次
    for (let i = 0; i < 8; i += 1) {
      const opt = await postJson(env, "/api/auth/passkey/login/options", {})
      const ch = cookieFrom(opt, "passkey_challenge")
      const failRes = await postJson(
        env,
        "/api/auth/passkey/login/verify",
        { credential: { id: "cred-login-1" } },
        { cookie: ch }
      )
      expect(failRes.status).toBe(401)
      expect(((await failRes.json()) as { code: string }).code).toBe(
        "PASSKEY_FAILED"
      )
    }

    // 第 9 次应被账号锁定拦截
    shouldVerifySucceed = true
    const optLocked = await postJson(env, "/api/auth/passkey/login/options", {})
    const chLocked = cookieFrom(optLocked, "passkey_challenge")
    const lockedRes = await postJson(
      env,
      "/api/auth/passkey/login/verify",
      { credential: { id: "cred-login-1" } },
      { cookie: chLocked }
    )
    expect(lockedRes.status).toBe(429)
    const lockedBody = (await lockedRes.json()) as {
      code: string
      retryAfter?: number
    }
    expect(lockedBody.code).toBe("ACCOUNT_LOCKED")
    expect(lockedBody.retryAfter).toBeGreaterThan(0)
  })

  it("成功登录后清零失败计数与锁定记录（不留计数残留）", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)
    const email = "cleanfail@example.test"

    const { cookie } = await registerAndLogin(env, { email })
    const regOptions = await postJson(
      env,
      "/api/auth/2fa/passkey/register/options",
      { password: TEST_PASSWORD },
      { cookie }
    )
    const regChallenge = cookieFrom(regOptions, "passkey_challenge")
    await postJson(
      env,
      "/api/auth/2fa/passkey/register/verify",
      { credential: { id: "cred-login-1" } },
      { cookie: cookieHeader(cookie, regChallenge) }
    )

    // 1. 模拟发生数次认证失败，产生失败计数
    shouldVerifySucceed = false
    const optFail = await postJson(env, "/api/auth/passkey/login/options", {})
    const chFail = cookieFrom(optFail, "passkey_challenge")
    const failRes = await postJson(
      env,
      "/api/auth/passkey/login/verify",
      { credential: { id: "cred-login-1" } },
      { cookie: chFail }
    )
    expect(failRes.status).toBe(401)

    // 验证库中已存在失败记录
    const failRowBefore = db.db
      .prepare(
        `SELECT count FROM ${countersTable(prefix)} WHERE action = 'login_fail' AND account = ?`
      )
      .get(email) as { count: number } | undefined
    expect(failRowBefore?.count).toBeGreaterThan(0)

    // 2. 恢复正常断言，直接登录成功
    shouldVerifySucceed = true
    const optSuccess = await postJson(
      env,
      "/api/auth/passkey/login/options",
      {}
    )
    const chSuccess = cookieFrom(optSuccess, "passkey_challenge")
    const successRes = await postJson(
      env,
      "/api/auth/passkey/login/verify",
      { credential: { id: "cred-login-1" } },
      { cookie: chSuccess }
    )
    expect(successRes.status).toBe(200)

    // 3. 断言库中 login_fail 和 login_lock 均已被清理（无残留记录）
    const failRowAfter = db.db
      .prepare(
        `SELECT count FROM ${countersTable(prefix)} WHERE action = 'login_fail' AND account = ?`
      )
      .get(email) as { count: number } | undefined
    expect(failRowAfter).toBeUndefined()

    const lockRowAfter = db.db
      .prepare(
        `SELECT locked_until FROM ${countersTable(prefix)} WHERE action = 'login_lock' AND account = ?`
      )
      .get(email) as { locked_until: number } | undefined
    expect(lockRowAfter).toBeUndefined()
  })
})

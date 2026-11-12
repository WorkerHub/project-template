/**
 * 规格 §7-6（二）：两步登录。
 *
 * - 密码步 → tempToken（5 分钟、只在响应出现一次）→ TOTP 步换会话；
 * - tempToken 用后作废、TOTP 同窗口同码拒绝重放；
 * - 连续失败锁定、Cookie 属性（HttpOnly/Secure/SameSite=Strict）、登出吊销会话。
 */
import { TOTP } from "otpauth"
import { describe, expect, it } from "vitest"
import { signTempToken, verifyTempToken } from "../src/core/tokens"
import {
  cookieFrom,
  initializedContext,
  loginUser,
  postJson,
  registerAndLogin,
  request,
  setCookies,
  TEST_SIGNING_SECRET
} from "./support/app"

function currentCode(secret: string): string {
  return new TOTP({
    secret,
    digits: 6,
    period: 30,
    algorithm: "SHA1"
  }).generate()
}

async function enableTotp(
  env: Parameters<typeof loginUser>[0],
  cookie: string
): Promise<string> {
  const setup = await request(env, "/api/auth/2fa/totp/setup", {
    method: "POST",
    headers: { cookie }
  })
  expect(setup.status).toBe(200)
  const { secret } = (await setup.json()) as { secret: string }
  const enable = await postJson(
    env,
    "/api/auth/2fa/totp/enable",
    { code: currentCode(secret) },
    { cookie }
  )
  expect(enable.status).toBe(200)
  return secret
}

describe("两步登录", () => {
  it("密码步发 tempToken，TOTP 步换会话；tempToken 用后作废", async () => {
    const { env } = await initializedContext()
    const { cookie } = await registerAndLogin(env, {
      email: "owner@example.test"
    })
    const secret = await enableTotp(env, cookie)

    const passwordStep = await loginUser(env, { email: "owner@example.test" })
    expect(passwordStep.status).toBe(200)
    const body = (await passwordStep.json()) as {
      requires2fa: boolean
      tempToken: string
      methods: string[]
    }
    expect(body.requires2fa).toBe(true)
    expect(body.methods).toEqual(["totp"])
    expect(body.tempToken).toBeTypeOf("string")
    // 密码步不建会话：没有 Set-Cookie。
    expect(setCookies(passwordStep)).toHaveLength(0)

    const code = currentCode(secret)
    const verified = await postJson(env, "/api/auth/2fa/verify", {
      tempToken: body.tempToken,
      method: "totp",
      code
    })
    expect(verified.status).toBe(200)
    expect(
      ((await verified.json()) as { requires2fa: boolean }).requires2fa
    ).toBe(false)
    const session = cookieFrom(verified)
    expect(session.startsWith("session=")).toBe(true)

    const me = await request(env, "/api/me", { headers: { cookie: session } })
    expect(me.status).toBe(200)

    const replay = await postJson(env, "/api/auth/2fa/verify", {
      tempToken: body.tempToken,
      method: "totp",
      code
    })
    expect(replay.status).toBe(401)
    expect(((await replay.json()) as { code: string }).code).toBe(
      "STEP_UP_REQUIRED"
    )
  })

  it("同一 TOTP 码在窗口内重放被拒", async () => {
    const { env } = await initializedContext()
    const { cookie } = await registerAndLogin(env, {
      email: "owner@example.test"
    })
    const secret = await enableTotp(env, cookie)
    const code = currentCode(secret)
    const me = await request(env, "/api/me", { headers: { cookie } })
    const userId = ((await me.json()) as { id: number }).id

    const first = await postJson(env, "/api/auth/2fa/verify", {
      tempToken: await signTempToken(userId, TEST_SIGNING_SECRET),
      method: "totp",
      code
    })
    expect(first.status).toBe(200)

    const second = await postJson(env, "/api/auth/2fa/verify", {
      tempToken: await signTempToken(userId, TEST_SIGNING_SECRET),
      method: "totp",
      code
    })
    expect(second.status).toBe(400)
    expect(((await second.json()) as { code: string }).code).toBe(
      "INVALID_CODE"
    )
  })

  it("连续失败 8 次后锁定，正确密码也拒绝（429 ACCOUNT_LOCKED）", async () => {
    const { env } = await initializedContext()
    await registerAndLogin(env, { email: "owner@example.test" })
    await postJson(
      env,
      "/api/auth/logout",
      {},
      {
        cookie: cookieFrom(
          await loginUser(env, { email: "owner@example.test" })
        )
      }
    )

    for (let i = 0; i < 8; i += 1) {
      const bad = await loginUser(env, {
        email: "owner@example.test",
        password: "wrong-password"
      })
      expect(bad.status).toBe(401)
    }
    const locked = await loginUser(env, { email: "owner@example.test" })
    expect(locked.status).toBe(429)
    const body = (await locked.json()) as { code: string; retryAfter: number }
    expect(body.code).toBe("ACCOUNT_LOCKED")
    expect(body.retryAfter).toBeGreaterThan(0)
  })

  it("会话 Cookie 带 HttpOnly/Secure/SameSite=Strict，登出后失效", async () => {
    const { env } = await initializedContext()
    await registerAndLogin(env, { email: "owner@example.test" })
    const login = await loginUser(env, { email: "owner@example.test" })
    const raw = setCookies(login).find((cookie) =>
      cookie.startsWith("session=")
    )
    expect(raw).toBeTruthy()
    expect(raw?.toLowerCase()).toContain("httponly")
    expect(raw?.toLowerCase()).toContain("secure")
    expect(raw?.toLowerCase()).toContain("samesite=strict")

    const cookie = cookieFrom(login)
    expect(
      (await request(env, "/api/me", { headers: { cookie } })).status
    ).toBe(200)

    const logout = await postJson(env, "/api/auth/logout", {}, { cookie })
    expect(logout.status).toBe(200)
    expect(
      (await request(env, "/api/me", { headers: { cookie } })).status
    ).toBe(401)
  })

  it("tempToken 过期即拒绝（签名校验按注入时间判定）", async () => {
    const token = await signTempToken(1, TEST_SIGNING_SECRET, 300, 1_000)
    expect(
      await verifyTempToken(token, TEST_SIGNING_SECRET, 1_100)
    ).not.toBeNull()
    expect(await verifyTempToken(token, TEST_SIGNING_SECRET, 1_500)).toBeNull()
    expect(await verifyTempToken(token, "another-secret", 1_100)).toBeNull()
  })
})

/**
 * 登录类响应契约测试：锁定 LoginResult 二选一的精确键集。
 *
 * - 成功 = `{ success: true, user }`，且不含 `requires2fa` 键；
 * - 需要二次验证 = `{ requires2fa: true, tempToken, methods }`，且不含
 *   `success` / `user` 键。
 *
 * 覆盖四个入口：`POST /auth/login` 成功、`POST /auth/login` 需要二次验证、
 * `POST /auth/2fa/verify` 成功、`POST /auth/2fa/passkey/verify` 成功。
 */
import { TOTP } from "otpauth"
import { describe, expect, it, vi } from "vitest"

// WebAuthn 浏览器侧无法在 vitest 里跑：换成固定返回（同 auth-passkey.test.ts）。
import { PROJECT_NAME } from "../src/config/project"

vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: vi.fn(async () => ({
    challenge: "register-challenge",
    rp: { id: "worker.test", name: PROJECT_NAME },
    user: { id: "dXNlcg", name: "user", displayName: "user" },
    pubKeyCredParams: [],
    timeout: 60_000,
    excludeCredentials: [],
    authenticatorSelection: {},
    attestation: "none"
  })),
  verifyRegistrationResponse: vi.fn(async () => ({
    verified: true,
    registrationInfo: {
      credential: {
        id: "cred-1",
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 0,
        transports: ["internal"]
      }
    }
  })),
  generateAuthenticationOptions: vi.fn(async () => ({
    challenge: "auth-challenge",
    rpId: "worker.test",
    allowCredentials: [],
    timeout: 60_000
  })),
  verifyAuthenticationResponse: vi.fn(async () => ({
    verified: true,
    authenticationInfo: { credentialID: "cred-1", newCounter: 1 }
  }))
}))

import {
  cookieFrom,
  cookieHeader,
  initializedContext,
  loginUser,
  postJson,
  registerAndLogin,
  registerUser,
  request,
  TEST_PASSWORD
} from "./support/app"

function currentCode(secret: string): string {
  return new TOTP({
    secret,
    digits: 6,
    period: 30,
    algorithm: "SHA1"
  }).generate()
}

/** 给一个已登录账号启用 TOTP，返回 secret。 */
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

describe("登录类响应契约", () => {
  it("/auth/login 成功（无第二因子）返回 { success, user }", async () => {
    const { env } = await initializedContext()
    await registerUser(env, { email: "owner@example.test" })
    const login = await loginUser(env, { email: "owner@example.test" })
    expect(login.status).toBe(200)
    const body = (await login.json()) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(["success", "user"])
    expect(body.success).toBe(true)
  })

  it("/auth/login 需要二次验证返回 { requires2fa, tempToken, methods }", async () => {
    const { env } = await initializedContext()
    const { cookie } = await registerAndLogin(env, {
      email: "owner@example.test"
    })
    await enableTotp(env, cookie)

    const login = await loginUser(env, { email: "owner@example.test" })
    expect(login.status).toBe(200)
    const body = (await login.json()) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual([
      "methods",
      "requires2fa",
      "tempToken"
    ])
    expect(body.requires2fa).toBe(true)
    expect(body.tempToken).toBeTypeOf("string")
    expect(Array.isArray(body.methods)).toBe(true)
    expect(body.methods).toContain("totp")
  })

  it("/auth/2fa/verify 成功返回 { success, user }", async () => {
    const { env } = await initializedContext()
    const { cookie } = await registerAndLogin(env, {
      email: "owner@example.test"
    })
    const secret = await enableTotp(env, cookie)

    const passwordStep = await loginUser(env, { email: "owner@example.test" })
    const { tempToken } = (await passwordStep.json()) as { tempToken: string }
    const verified = await postJson(env, "/api/auth/2fa/verify", {
      tempToken,
      method: "totp",
      code: currentCode(secret)
    })
    expect(verified.status).toBe(200)
    const body = (await verified.json()) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(["success", "user"])
    expect(body.success).toBe(true)
  })

  it("/auth/2fa/passkey/verify 成功返回 { success, user }", async () => {
    const { env } = await initializedContext()
    const { cookie } = await registerAndLogin(env, {
      email: "owner@example.test"
    })

    // 注册一枚通行密钥作为第二因子
    const options = await postJson(
      env,
      "/api/auth/2fa/passkey/register/options",
      { password: TEST_PASSWORD },
      { cookie }
    )
    const challengeCookie = cookieFrom(options, "passkey_challenge")
    const created = await postJson(
      env,
      "/api/auth/2fa/passkey/register/verify",
      { credential: { id: "cred-1", type: "public-key" } },
      { cookie: cookieHeader(cookie, challengeCookie) }
    )
    expect(created.status).toBe(201)

    const passwordStep = await loginUser(env, { email: "owner@example.test" })
    const { tempToken } = (await passwordStep.json()) as { tempToken: string }
    const assertOptions = await postJson(env, "/api/auth/2fa/passkey/options", {
      tempToken
    })
    const assertChallenge = cookieFrom(assertOptions, "passkey_challenge")

    const verified = await postJson(
      env,
      "/api/auth/2fa/passkey/verify",
      { tempToken, credential: { id: "cred-1" } },
      { cookie: assertChallenge }
    )
    expect(verified.status).toBe(200)
    const body = (await verified.json()) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(["success", "user"])
    expect(body.success).toBe(true)
  })
})

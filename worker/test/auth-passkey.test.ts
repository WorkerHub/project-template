/**
 * 通行密钥（第二因子）与设置页管理：注册、列表、断言登录、删除。
 *
 * WebAuthn 的浏览器侧无法在 vitest 里跑，所以把 `@simplewebauthn/server` 换成
 * 固定返回（规格 §7-9 允许 stub）：本用例验证的是我们的接线——挑战 Cookie、
 * 用户绑定、凭据落库、成功后发会话、未知凭据被拒、DTO 不泄露公钥。
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: vi.fn(async () => ({
    challenge: "register-challenge",
    rp: { id: "worker.test", name: "Template" },
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
  request,
  TEST_PASSWORD
} from "./support/app"

describe("通行密钥", () => {
  it("注册 → 列表 → 作为第二因子登录 → 删除", async () => {
    const { env } = await initializedContext()
    const { cookie } = await registerAndLogin(env, {
      email: "owner@example.test"
    })

    const options = await postJson(
      env,
      "/api/auth/2fa/passkey/register/options",
      { password: TEST_PASSWORD },
      { cookie }
    )
    expect(options.status).toBe(200)
    expect(((await options.json()) as { challenge: string }).challenge).toBe(
      "register-challenge"
    )
    const challengeCookie = cookieFrom(options, "passkey_challenge")

    const created = await postJson(
      env,
      "/api/auth/2fa/passkey/register/verify",
      { credential: { id: "cred-1", type: "public-key" } },
      { cookie: cookieHeader(cookie, challengeCookie) }
    )
    expect(created.status).toBe(201)

    const list = await request(env, "/api/me/passkeys", { headers: { cookie } })
    const listBody = (await list.json()) as {
      items: Array<Record<string, unknown>>
    }
    expect(listBody.items).toHaveLength(1)
    expect(Object.keys(listBody.items[0]).sort()).toEqual([
      "createdAt",
      "id",
      "lastUsedAt",
      "transports"
    ])
    const raw = JSON.stringify(listBody)
    expect(raw).not.toContain("cred-1")
    expect(raw).not.toContain("publicKey")

    // 密码步 → tempToken，方法里应有 passkey
    const passwordStep = await loginUser(env, { email: "owner@example.test" })
    const stepBody = (await passwordStep.json()) as {
      requires2fa: boolean
      tempToken: string
      methods: string[]
    }
    expect(stepBody.requires2fa).toBe(true)
    expect(stepBody.methods).toContain("passkey")

    const assertOptions = await postJson(env, "/api/auth/2fa/passkey/options", {
      tempToken: stepBody.tempToken
    })
    expect(assertOptions.status).toBe(200)
    const assertChallenge = cookieFrom(assertOptions, "passkey_challenge")

    const verified = await postJson(
      env,
      "/api/auth/2fa/passkey/verify",
      { tempToken: stepBody.tempToken, credential: { id: "cred-1" } },
      { cookie: assertChallenge }
    )
    expect(verified.status).toBe(200)
    const session = cookieFrom(verified)
    expect(
      (await request(env, "/api/me", { headers: { cookie: session } })).status
    ).toBe(200)

    const passkeyId = listBody.items[0].id as number
    const removed = await request(env, `/api/me/passkeys/${passkeyId}`, {
      method: "DELETE",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ password: "correct-horse-battery" })
    })
    expect(removed.status).toBe(200)
    const empty = await request(env, "/api/me/passkeys", {
      headers: { cookie }
    })
    expect(((await empty.json()) as { items: unknown[] }).items).toEqual([])
  })

  it("未知凭据被拒；删除需要正确密码", async () => {
    const { env } = await initializedContext()
    const { cookie } = await registerAndLogin(env, {
      email: "owner@example.test"
    })

    const options = await postJson(
      env,
      "/api/auth/2fa/passkey/register/options",
      { password: TEST_PASSWORD },
      { cookie }
    )
    const challengeCookie = cookieFrom(options, "passkey_challenge")
    await postJson(
      env,
      "/api/auth/2fa/passkey/register/verify",
      { credential: { id: "cred-1" } },
      { cookie: cookieHeader(cookie, challengeCookie) }
    )

    const step = (await (
      await loginUser(env, { email: "owner@example.test" })
    ).json()) as { tempToken: string }
    const assertOptions = await postJson(env, "/api/auth/2fa/passkey/options", {
      tempToken: step.tempToken
    })
    const assertChallenge = cookieFrom(assertOptions, "passkey_challenge")

    const unknown = await postJson(
      env,
      "/api/auth/2fa/passkey/verify",
      { tempToken: step.tempToken, credential: { id: "nope" } },
      { cookie: assertChallenge }
    )
    expect(unknown.status).toBe(400)
    expect(((await unknown.json()) as { code: string }).code).toBe(
      "PASSKEY_FAILED"
    )

    const wrongPassword = await request(env, "/api/me/passkeys/1", {
      method: "DELETE",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ password: "wrong-password" })
    })
    expect(wrongPassword.status).toBe(403)
    expect(((await wrongPassword.json()) as { code: string }).code).toBe(
      "PASSWORD_INCORRECT"
    )
  })

  it("缺少挑战 Cookie 时拒绝断言", async () => {
    const { env } = await initializedContext()
    const { cookie } = await registerAndLogin(env, {
      email: "owner@example.test"
    })

    const options = await postJson(
      env,
      "/api/auth/2fa/passkey/register/options",
      { password: TEST_PASSWORD },
      { cookie }
    )
    const challengeCookie = cookieFrom(options, "passkey_challenge")
    await postJson(
      env,
      "/api/auth/2fa/passkey/register/verify",
      { credential: { id: "cred-1" } },
      { cookie: cookieHeader(cookie, challengeCookie) }
    )

    const step = (await (
      await loginUser(env, { email: "owner@example.test" })
    ).json()) as { tempToken: string }

    const res = await postJson(env, "/api/auth/2fa/passkey/verify", {
      tempToken: step.tempToken,
      credential: { id: "cred-1" }
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe(
      "PASSKEY_CHALLENGE_MISSING"
    )
  })
})

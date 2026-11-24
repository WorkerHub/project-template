import { describe, expect, it } from "vitest"
import { isoBase64URL } from "@simplewebauthn/server/helpers"
import { insertPasskey } from "../src/db/queries/passkeys"
import {
  activePrefix,
  cookieFrom,
  cookieHeader,
  initializedContext,
  loginUser,
  postJson,
  registerAndLogin,
  registerUser,
  TEST_PASSWORD
} from "./support/app"

describe("Passkey 真实库验签异常与挑战错配契约（无 mock）", () => {
  it("登录验证：畸形断言返回 401 PASSKEY_FAILED 且计入失败锁定", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)

    // 注册真实账号并插入通行密钥记录
    const email = "real-passkey-user@example.test"
    const regRes = await registerUser(env, { email, password: TEST_PASSWORD })
    expect(regRes.status).toBe(201)
    const user = db.db
      .prepare(`SELECT id FROM ${prefix}users WHERE email = ?`)
      .get(email) as { id: number }

    const credentialId = "cred-real-test-1"
    await insertPasskey(env.DB, prefix, {
      userId: user.id,
      credentialId,
      publicKey: "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE1234567890",
      counter: 0,
      transports: ["internal"]
    })

    // 1. 获取登录 challenge options
    const optRes = await postJson(env, "/api/auth/passkey/login/options", {})
    expect(optRes.status).toBe(200)
    const challengeCookie = cookieFrom(optRes, "passkey_challenge")

    // 2. 提交畸形断言（非合规 clientDataJSON / 无法通过 @simplewebauthn/server 校验）
    const malformedPayload = {
      id: credentialId,
      rawId: credentialId,
      type: "public-key",
      response: {
        clientDataJSON: "invalid-non-base64-json-content",
        authenticatorData: "invalid",
        signature: "invalid"
      }
    }

    const failRes = await postJson(
      env,
      "/api/auth/passkey/login/verify",
      { credential: malformedPayload },
      { cookie: challengeCookie }
    )
    expect(failRes.status).toBe(401)
    const failBody = (await failRes.json()) as { code: string; error: string }
    expect(failBody.code).toBe("PASSKEY_FAILED")

    // 连续失败至第 8 次
    for (let i = 0; i < 7; i += 1) {
      const nextOpt = await postJson(env, "/api/auth/passkey/login/options", {})
      const nextCookie = cookieFrom(nextOpt, "passkey_challenge")
      const res = await postJson(
        env,
        "/api/auth/passkey/login/verify",
        { credential: malformedPayload },
        { cookie: nextCookie }
      )
      expect(res.status).toBe(401)
    }

    // 第 9 次应被账号锁定拦截返回 429
    const lockedOpt = await postJson(env, "/api/auth/passkey/login/options", {})
    const lockedCookie = cookieFrom(lockedOpt, "passkey_challenge")
    const lockedRes = await postJson(
      env,
      "/api/auth/passkey/login/verify",
      { credential: malformedPayload },
      { cookie: lockedCookie }
    )
    expect(lockedRes.status).toBe(429)
    const lockedBody = (await lockedRes.json()) as { code: string }
    expect(lockedBody.code).toBe("ACCOUNT_LOCKED")
  })

  it("登录验证：多标签页 challenge 错配返回 400 PASSKEY_CHALLENGE_MISSING 且计入失败", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)

    const email = "real-mismatch-user@example.test"
    await registerUser(env, { email, password: TEST_PASSWORD })
    const user = db.db
      .prepare(`SELECT id FROM ${prefix}users WHERE email = ?`)
      .get(email) as { id: number }

    const credentialId = "cred-real-test-2"
    await insertPasskey(env.DB, prefix, {
      userId: user.id,
      credentialId,
      publicKey: "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE1234567890",
      counter: 0,
      transports: ["internal"]
    })

    // 模拟标签页 B 取得的 options
    const optB = await postJson(env, "/api/auth/passkey/login/options", {})
    const cookieB = cookieFrom(optB, "passkey_challenge")

    // 客户端断言包含标签页 A 的旧 challenge，与 Cookie 中的 challenge 不一致
    const clientData = {
      type: "webauthn.get",
      challenge: "mismatched-challenge-from-tab-a",
      origin: "http://worker.test"
    }
    const mismatchPayload = {
      id: credentialId,
      rawId: credentialId,
      type: "public-key",
      response: {
        clientDataJSON: isoBase64URL.fromUTF8String(JSON.stringify(clientData)),
        authenticatorData: "AAAA",
        signature: "AAAA"
      }
    }

    const mismatchRes = await postJson(
      env,
      "/api/auth/passkey/login/verify",
      { credential: mismatchPayload },
      { cookie: cookieB }
    )
    expect(mismatchRes.status).toBe(400)
    const mismatchBody = (await mismatchRes.json()) as { code: string }
    expect(mismatchBody.code).toBe("PASSKEY_CHALLENGE_MISSING")

    // 验证 challenge 错配也被计入失败计数（再失败 7 次触发锁定）
    for (let i = 0; i < 7; i += 1) {
      const nextOpt = await postJson(env, "/api/auth/passkey/login/options", {})
      const nextCookie = cookieFrom(nextOpt, "passkey_challenge")
      const res = await postJson(
        env,
        "/api/auth/passkey/login/verify",
        { credential: mismatchPayload },
        { cookie: nextCookie }
      )
      expect(res.status).toBe(400)
    }

    const lockedOpt = await postJson(env, "/api/auth/passkey/login/options", {})
    const lockedCookie = cookieFrom(lockedOpt, "passkey_challenge")
    const lockedRes = await postJson(
      env,
      "/api/auth/passkey/login/verify",
      { credential: mismatchPayload },
      { cookie: lockedCookie }
    )
    expect(lockedRes.status).toBe(429)
    const lockedBody = (await lockedRes.json()) as { code: string }
    expect(lockedBody.code).toBe("ACCOUNT_LOCKED")
  })

  it("2FA 验证：畸形断言返回 401 PASSKEY_FAILED，错配断言返回 400 PASSKEY_CHALLENGE_MISSING", async () => {
    const { env, db } = await initializedContext()
    const prefix = activePrefix(env)

    const email = "user-2fa-verify@example.test"
    await registerUser(env, { email, password: TEST_PASSWORD })
    const user = db.db
      .prepare(`SELECT id FROM ${prefix}users WHERE email = ?`)
      .get(email) as { id: number }

    const credentialId = "cred-2fa-test-1"
    await insertPasskey(env.DB, prefix, {
      userId: user.id,
      credentialId,
      publicKey: "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE1234567890",
      counter: 0,
      transports: ["internal"]
    })

    // 密码步 -> requires2fa: true
    const loginRes = await loginUser(env, { email, password: TEST_PASSWORD })
    const stepBody = (await loginRes.json()) as {
      requires2fa: boolean
      tempToken: string
    }
    expect(stepBody.requires2fa).toBe(true)

    // 1. 获取 2FA passkey options
    const optRes = await postJson(env, "/api/auth/2fa/passkey/options", {
      tempToken: stepBody.tempToken
    })
    expect(optRes.status).toBe(200)
    const challengeCookie = cookieFrom(optRes, "passkey_challenge")

    // 2. 提交畸形断言 -> 401 PASSKEY_FAILED
    const malformedRes = await postJson(
      env,
      "/api/auth/2fa/passkey/verify",
      {
        tempToken: stepBody.tempToken,
        credential: {
          id: credentialId,
          rawId: credentialId,
          type: "public-key",
          response: {
            clientDataJSON: "invalid-client-data",
            authenticatorData: "invalid",
            signature: "invalid"
          }
        }
      },
      { cookie: challengeCookie }
    )
    expect(malformedRes.status).toBe(401)
    expect(((await malformedRes.json()) as { code: string }).code).toBe(
      "PASSKEY_FAILED"
    )

    // 3. 提交错配断言 -> 400 PASSKEY_CHALLENGE_MISSING
    const optRes2 = await postJson(env, "/api/auth/2fa/passkey/options", {
      tempToken: stepBody.tempToken
    })
    const challengeCookie2 = cookieFrom(optRes2, "passkey_challenge")

    const mismatchClientData = {
      type: "webauthn.get",
      challenge: "mismatched-2fa-challenge",
      origin: "http://worker.test"
    }
    const mismatchRes = await postJson(
      env,
      "/api/auth/2fa/passkey/verify",
      {
        tempToken: stepBody.tempToken,
        credential: {
          id: credentialId,
          rawId: credentialId,
          type: "public-key",
          response: {
            clientDataJSON: isoBase64URL.fromUTF8String(
              JSON.stringify(mismatchClientData)
            ),
            authenticatorData: "AAAA",
            signature: "AAAA"
          }
        }
      },
      { cookie: challengeCookie2 }
    )
    expect(mismatchRes.status).toBe(400)
    expect(((await mismatchRes.json()) as { code: string }).code).toBe(
      "PASSKEY_CHALLENGE_MISSING"
    )
  })

  it("注册验证：畸形断言返回 400 PASSKEY_FAILED，错配断言返回 400 PASSKEY_CHALLENGE_MISSING", async () => {
    const { env } = await initializedContext()

    // 准备一个已登录的用户用于注册测试
    const { cookie } = await registerAndLogin(env, {
      email: "user-2fa@example.test",
      password: TEST_PASSWORD
    })

    // 1. 测试注册验证
    const regOptRes = await postJson(
      env,
      "/api/auth/2fa/passkey/register/options",
      { password: TEST_PASSWORD },
      { cookie }
    )
    expect(regOptRes.status).toBe(200)
    const regChallengeCookie = cookieFrom(regOptRes, "passkey_challenge")

    // 畸形注册断言 -> 400 PASSKEY_FAILED
    const malformedRegRes = await postJson(
      env,
      "/api/auth/2fa/passkey/register/verify",
      {
        credential: {
          id: "new-cred-1",
          response: { clientDataJSON: "invalid-json" }
        }
      },
      { cookie: cookieHeader(cookie, regChallengeCookie) }
    )
    expect(malformedRegRes.status).toBe(400)
    expect(((await malformedRegRes.json()) as { code: string }).code).toBe(
      "PASSKEY_FAILED"
    )

    // 错配注册断言 -> 400 PASSKEY_CHALLENGE_MISSING
    const regOptRes2 = await postJson(
      env,
      "/api/auth/2fa/passkey/register/options",
      { password: TEST_PASSWORD },
      { cookie }
    )
    const regChallengeCookie2 = cookieFrom(regOptRes2, "passkey_challenge")
    const mismatchRegClientData = {
      type: "webauthn.create",
      challenge: "mismatched-reg-challenge",
      origin: "http://worker.test"
    }
    const mismatchRegRes = await postJson(
      env,
      "/api/auth/2fa/passkey/register/verify",
      {
        credential: {
          id: "new-cred-1",
          rawId: "new-cred-1",
          type: "public-key",
          response: {
            clientDataJSON: isoBase64URL.fromUTF8String(
              JSON.stringify(mismatchRegClientData)
            ),
            attestationObject: "AAAA"
          }
        }
      },
      { cookie: cookieHeader(cookie, regChallengeCookie2) }
    )
    expect(mismatchRegRes.status).toBe(400)
    expect(((await mismatchRegRes.json()) as { code: string }).code).toBe(
      "PASSKEY_CHALLENGE_MISSING"
    )
  })
})

/**
 * 冻结契约自测：Passkey 命名 + TOTP 标签（schema_v2 + 接口完整性覆盖）。
 *
 * 覆盖契约：
 * 4. POST /api/auth/2fa/passkey/register/verify：带 name（trim + slice(0,50)，空串→NULL）落库。
 * 5. PATCH /api/me/passkeys/:id：只改 name，无需重输密码，非本人/不存在 404 PASSKEY_NOT_FOUND。
 * 6. GET /api/me/passkeys：PasskeyView 包含 name: string | null。
 * 7. POST /api/auth/2fa/totp/enable：带 label（trim + slice(0,50)，空→NULL）落库。
 * 8. PATCH /api/auth/2fa/totp/label：仅已启用有效（否则 400 TOTP_NOT_ENABLED），改 label。
 * 9. POST /api/auth/2fa/totp/disable：停用时 totp_label 清除为 NULL。
 * 10. UserView 包含 totpLabel: string | null，登录成功 / GET /api/me 均回显。
 */
import { TOTP } from "otpauth"
import { describe, expect, it, vi } from "vitest"
import { PROJECT_NAME } from "../src/config/project"

let credentialCounter = 1

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
  verifyRegistrationResponse: vi.fn(async () => {
    const credId = `cred-${credentialCounter++}`
    return {
      verified: true,
      registrationInfo: {
        credential: {
          id: credId,
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 0,
          transports: ["internal"]
        }
      }
    }
  }),
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
  activePrefix,
  patchJson,
  postJson,
  registerAndLogin,
  request,
  seedSession,
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

async function registerPasskeyWithName(
  env: Parameters<typeof loginUser>[0],
  cookie: string,
  name?: string
) {
  const options = await postJson(
    env,
    "/api/auth/2fa/passkey/register/options",
    { password: TEST_PASSWORD },
    { cookie }
  )
  expect(options.status).toBe(200)
  const challengeCookie = cookieFrom(options, "passkey_challenge")

  const body: Record<string, unknown> = {
    credential: { id: "temp", type: "public-key" }
  }
  if (name !== undefined) body.name = name

  const res = await postJson(
    env,
    "/api/auth/2fa/passkey/register/verify",
    body,
    { cookie: cookieHeader(cookie, challengeCookie) }
  )
  expect(res.status).toBe(201)
  return res
}

describe("Passkey 命名与改名契约", () => {
  it("注册时携带 name，首尾空格去净并截断 50 字；空串为 NULL", async () => {
    const { env } = await initializedContext()
    const { cookie } = await registerAndLogin(env, {
      email: "alice@example.test"
    })

    // 1. 正常名字（带首尾空格）
    await registerPasskeyWithName(env, cookie, "  My Security Key  ")

    // 2. 超长名字（> 50 字截断）
    const longName = "A".repeat(60)
    await registerPasskeyWithName(env, cookie, `  ${longName}  `)

    // 3. 空白串转 NULL
    await registerPasskeyWithName(env, cookie, "   ")

    // 4. 未传 name 转 NULL
    await registerPasskeyWithName(env, cookie)

    const listRes = await request(env, "/api/me/passkeys", {
      headers: { cookie }
    })
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as {
      items: Array<{ id: number; name: string | null }>
    }
    expect(list.items).toHaveLength(4)

    expect(list.items[0].name).toBe("My Security Key")
    expect(list.items[1].name).toBe("A".repeat(50))
    expect(list.items[2].name).toBeNull()
    expect(list.items[3].name).toBeNull()
  })

  it("PATCH /api/me/passkeys/:id：无需重输密码，只改 name，可清除为 NULL", async () => {
    const { env } = await initializedContext()
    const { cookie } = await registerAndLogin(env, {
      email: "bob@example.test"
    })
    await registerPasskeyWithName(env, cookie, "Original Key")

    const listBefore = (await (
      await request(env, "/api/me/passkeys", { headers: { cookie } })
    ).json()) as {
      items: Array<{ id: number; name: string | null }>
    }
    const passkeyId = listBefore.items[0].id
    expect(listBefore.items[0].name).toBe("Original Key")

    // 改名
    const patchRes = await patchJson(
      env,
      `/api/me/passkeys/${passkeyId}`,
      { name: "  Work Laptop Key  " },
      { cookie }
    )
    expect(patchRes.status).toBe(200)
    expect(await patchRes.json()).toEqual({ success: true })

    const listAfter = (await (
      await request(env, "/api/me/passkeys", { headers: { cookie } })
    ).json()) as {
      items: Array<{ id: number; name: string | null }>
    }
    expect(listAfter.items[0].name).toBe("Work Laptop Key")

    // 缺省/非法 body 返回 400 INVALID_REQUEST，不静默清空
    for (const badBody of [
      undefined,
      {},
      { name: 123 },
      { name: true },
      { name: [] },
      { name: {} }
    ]) {
      const res =
        badBody === undefined
          ? await request(env, `/api/me/passkeys/${passkeyId}`, {
              method: "PATCH",
              headers: { cookie }
            })
          : await patchJson(env, `/api/me/passkeys/${passkeyId}`, badBody, {
              cookie
            })
      expect(res.status).toBe(400)
      expect(((await res.json()) as { code: string }).code).toBe(
        "INVALID_REQUEST"
      )
    }
    const listAfterInvalid = (await (
      await request(env, "/api/me/passkeys", { headers: { cookie } })
    ).json()) as {
      items: Array<{ id: number; name: string | null }>
    }
    expect(listAfterInvalid.items[0].name).toBe("Work Laptop Key")

    // 传 null 显式清除名称
    const nullClearRes = await patchJson(
      env,
      `/api/me/passkeys/${passkeyId}`,
      { name: null },
      { cookie }
    )
    expect(nullClearRes.status).toBe(200)
    expect(await nullClearRes.json()).toEqual({ success: true })

    const listNullCleared = (await (
      await request(env, "/api/me/passkeys", { headers: { cookie } })
    ).json()) as {
      items: Array<{ id: number; name: string | null }>
    }
    expect(listNullCleared.items[0].name).toBeNull()

    // 重新设回一个名称以测试空白串清除
    await patchJson(
      env,
      `/api/me/passkeys/${passkeyId}`,
      { name: "Temporary Key" },
      { cookie }
    )

    // 改为空串（清除名称）
    const clearRes = await patchJson(
      env,
      `/api/me/passkeys/${passkeyId}`,
      { name: "   " },
      { cookie }
    )
    expect(clearRes.status).toBe(200)
    expect(await clearRes.json()).toEqual({ success: true })

    const listCleared = (await (
      await request(env, "/api/me/passkeys", { headers: { cookie } })
    ).json()) as {
      items: Array<{ id: number; name: string | null }>
    }
    expect(listCleared.items[0].name).toBeNull()
  })

  it("PATCH /api/me/passkeys/:id：不存在/非本人/非法 id 返回 404 PASSKEY_NOT_FOUND", async () => {
    const { env, db } = await initializedContext()
    const user1 = await registerAndLogin(env, { email: "user1@example.test" })
    const user2 = await seedSession(db, activePrefix(env), {
      email: "user2@example.test"
    })

    await registerPasskeyWithName(env, user1.cookie, "User1 Key")
    const user1List = (await (
      await request(env, "/api/me/passkeys", {
        headers: { cookie: user1.cookie }
      })
    ).json()) as {
      items: Array<{ id: number; name: string | null }>
    }
    const user1KeyId = user1List.items[0].id

    // user2 试图修改 user1 的通行密钥 -> 404 PASSKEY_NOT_FOUND
    const crossPatch = await patchJson(
      env,
      `/api/me/passkeys/${user1KeyId}`,
      { name: "Hacked" },
      { cookie: user2.cookie }
    )
    expect(crossPatch.status).toBe(404)
    expect(((await crossPatch.json()) as { code: string }).code).toBe(
      "PASSKEY_NOT_FOUND"
    )

    // user1 原通行密钥名称未被篡改
    const verifyList = (await (
      await request(env, "/api/me/passkeys", {
        headers: { cookie: user1.cookie }
      })
    ).json()) as {
      items: Array<{ id: number; name: string | null }>
    }
    expect(verifyList.items[0].name).toBe("User1 Key")

    // 不存在的 key -> 404
    const notFound = await patchJson(
      env,
      "/api/me/passkeys/99999",
      { name: "Nope" },
      { cookie: user1.cookie }
    )
    expect(notFound.status).toBe(404)
    expect(((await notFound.json()) as { code: string }).code).toBe(
      "PASSKEY_NOT_FOUND"
    )

    // 非整数 id -> 404
    const badId = await patchJson(
      env,
      "/api/me/passkeys/invalid-id",
      { name: "Nope" },
      { cookie: user1.cookie }
    )
    expect(badId.status).toBe(404)
    expect(((await badId.json()) as { code: string }).code).toBe(
      "PASSKEY_NOT_FOUND"
    )
  })
})

describe("TOTP 标签与 UserView 契约", () => {
  it("启用带 label、PATCH 改 label、停用清 label，且 UserView 同步 totpLabel", async () => {
    const { env } = await initializedContext()
    const { cookie } = await registerAndLogin(env, {
      email: "charlie@example.test"
    })

    // 未开启 TOTP 时，UserView.totpLabel 为 null
    const initialMe = (await (
      await request(env, "/api/me", { headers: { cookie } })
    ).json()) as {
      totpEnabled: boolean
      totpLabel: string | null
    }
    expect(initialMe.totpEnabled).toBe(false)
    expect(initialMe.totpLabel).toBeNull()

    // 未开启时尝试 PATCH /api/auth/2fa/totp/label -> 400 TOTP_NOT_ENABLED
    const earlyPatch = await patchJson(
      env,
      "/api/auth/2fa/totp/label",
      { label: "My Auth" },
      { cookie }
    )
    expect(earlyPatch.status).toBe(400)
    expect(((await earlyPatch.json()) as { code: string }).code).toBe(
      "TOTP_NOT_ENABLED"
    )

    // TOTP setup
    const setup = await request(env, "/api/auth/2fa/totp/setup", {
      method: "POST",
      headers: { cookie }
    })
    expect(setup.status).toBe(200)
    const { secret } = (await setup.json()) as { secret: string }

    // 启用带 label（首尾去空格）
    const enableRes = await postJson(
      env,
      "/api/auth/2fa/totp/enable",
      { code: currentCode(secret), label: "  1Password Authenticator  " },
      { cookie }
    )
    expect(enableRes.status).toBe(200)
    expect(await enableRes.json()).toEqual({ success: true })

    // GET /api/me 验证 UserView.totpLabel
    const meAfterEnable = (await (
      await request(env, "/api/me", { headers: { cookie } })
    ).json()) as {
      totpEnabled: boolean
      totpLabel: string | null
    }
    expect(meAfterEnable.totpEnabled).toBe(true)
    expect(meAfterEnable.totpLabel).toBe("1Password Authenticator")

    // 登录成功时 user.totpLabel 回显验证
    const loginStep1 = await loginUser(env, { email: "charlie@example.test" })
    const { tempToken } = (await loginStep1.json()) as { tempToken: string }
    const loginVerify = await postJson(env, "/api/auth/2fa/verify", {
      tempToken,
      method: "totp",
      code: currentCode(secret)
    })
    expect(loginVerify.status).toBe(200)
    const loginUserView = (
      (await loginVerify.json()) as { user: { totpLabel: string | null } }
    ).user
    expect(loginUserView.totpLabel).toBe("1Password Authenticator")

    // PATCH /api/auth/2fa/totp/label 更改标签
    const patchLabel = await patchJson(
      env,
      "/api/auth/2fa/totp/label",
      { label: "  Google Authenticator  " },
      { cookie }
    )
    expect(patchLabel.status).toBe(200)
    expect(await patchLabel.json()).toEqual({ success: true })

    // 缺省/非法 body 请求返回 400 INVALID_REQUEST，不静默清空
    for (const badBody of [
      undefined,
      {},
      { label: 123 },
      { label: true },
      { label: [] },
      { label: {} }
    ]) {
      const res =
        badBody === undefined
          ? await request(env, "/api/auth/2fa/totp/label", {
              method: "PATCH",
              headers: { cookie }
            })
          : await patchJson(env, "/api/auth/2fa/totp/label", badBody, {
              cookie
            })
      expect(res.status).toBe(400)
      expect(((await res.json()) as { code: string }).code).toBe(
        "INVALID_REQUEST"
      )
    }

    const meAfterPatch = (await (
      await request(env, "/api/me", { headers: { cookie } })
    ).json()) as {
      totpEnabled: boolean
      totpLabel: string | null
    }
    expect(meAfterPatch.totpLabel).toBe("Google Authenticator")

    // PATCH 传 null 显式清除标签
    const clearNullRes = await patchJson(
      env,
      "/api/auth/2fa/totp/label",
      { label: null },
      { cookie }
    )
    expect(clearNullRes.status).toBe(200)
    expect(await clearNullRes.json()).toEqual({ success: true })

    const meAfterNullClear = (await (
      await request(env, "/api/me", { headers: { cookie } })
    ).json()) as {
      totpLabel: string | null
    }
    expect(meAfterNullClear.totpLabel).toBeNull()

    // 重新设回一个标签以测试后续超长截断与空白串清除
    await patchJson(
      env,
      "/api/auth/2fa/totp/label",
      { label: "Google Authenticator" },
      { cookie }
    )

    // PATCH 超长标签截断
    const longLabel = "T".repeat(60)
    await patchJson(
      env,
      "/api/auth/2fa/totp/label",
      { label: longLabel },
      { cookie }
    )
    const meAfterLong = (await (
      await request(env, "/api/me", { headers: { cookie } })
    ).json()) as {
      totpLabel: string | null
    }
    expect(meAfterLong.totpLabel).toBe("T".repeat(50))

    // PATCH 空串清除标签
    await patchJson(
      env,
      "/api/auth/2fa/totp/label",
      { label: "   " },
      { cookie }
    )
    const meAfterClear = (await (
      await request(env, "/api/me", { headers: { cookie } })
    ).json()) as {
      totpLabel: string | null
    }
    expect(meAfterClear.totpLabel).toBeNull()

    // 重新设回一个标签
    await patchJson(
      env,
      "/api/auth/2fa/totp/label",
      { label: "YubiKey TOTP" },
      { cookie }
    )

    // POST /api/auth/2fa/totp/disable 停用 TOTP
    const disableRes = await postJson(
      env,
      "/api/auth/2fa/totp/disable",
      { password: TEST_PASSWORD },
      { cookie }
    )
    expect(disableRes.status).toBe(200)

    // 停用后 totpLabel 必须被清为 NULL，避免残留
    const meAfterDisable = (await (
      await request(env, "/api/me", { headers: { cookie } })
    ).json()) as {
      totpEnabled: boolean
      totpLabel: string | null
    }
    expect(meAfterDisable.totpEnabled).toBe(false)
    expect(meAfterDisable.totpLabel).toBeNull()

    // 停用后再尝试 PATCH 标签报错 400 TOTP_NOT_ENABLED
    const patchAfterDisable = await patchJson(
      env,
      "/api/auth/2fa/totp/label",
      { label: "Another" },
      { cookie }
    )
    expect(patchAfterDisable.status).toBe(400)
    expect(((await patchAfterDisable.json()) as { code: string }).code).toBe(
      "TOTP_NOT_ENABLED"
    )
  })
})

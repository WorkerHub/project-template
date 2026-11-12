/**
 * 个人设置接口（前端「设置」页的后端）：资料/偏好校验、改密后其它会话失效、
 * TOTP 开关（敏感动作需重输密码）。
 */
import { TOTP } from "otpauth"
import { describe, expect, it } from "vitest"
import {
  cookieFrom,
  initializedContext,
  loginUser,
  putJson,
  postJson,
  registerAndLogin,
  request
} from "./support/app"

function currentCode(secret: string): string {
  return new TOTP({
    secret,
    digits: 6,
    period: 30,
    algorithm: "SHA1"
  }).generate()
}

describe("个人设置", () => {
  it("PUT 资料与偏好：合法值落库并即时回显，非法值报稳定错误码", async () => {
    const { env } = await initializedContext()
    const { cookie } = await registerAndLogin(env, {
      email: "owner@example.test"
    })

    const ok = await putJson(
      env,
      "/api/me",
      {
        displayName: "Owner",
        language: "en",
        theme: "dark",
        timezone: "Europe/London"
      },
      { cookie }
    )
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({
      displayName: "Owner",
      language: "en",
      theme: "dark",
      timezone: "Europe/London"
    })

    const badLanguage = await putJson(
      env,
      "/api/me",
      { language: "ja" },
      { cookie }
    )
    expect(badLanguage.status).toBe(400)
    expect(((await badLanguage.json()) as { code: string }).code).toBe(
      "INVALID_LANGUAGE"
    )

    const badTheme = await putJson(
      env,
      "/api/me",
      { theme: "blue" },
      { cookie }
    )
    expect(((await badTheme.json()) as { code: string }).code).toBe(
      "INVALID_THEME"
    )

    const badTimezone = await putJson(
      env,
      "/api/me",
      { timezone: "Mars/Olympus" },
      { cookie }
    )
    expect(((await badTimezone.json()) as { code: string }).code).toBe(
      "INVALID_TIMEZONE"
    )
  })

  it("改密：当前密码错 403；成功后其它会话失效、当前会话保留", async () => {
    const { env } = await initializedContext()
    const { cookie } = await registerAndLogin(env, {
      email: "owner@example.test"
    })
    const other = cookieFrom(
      await loginUser(env, { email: "owner@example.test" })
    )

    const wrong = await postJson(
      env,
      "/api/me/password",
      { currentPassword: "not-my-password", newPassword: "brand-new-password" },
      { cookie }
    )
    expect(wrong.status).toBe(403)
    expect(
      (await request(env, "/api/me", { headers: { cookie: other } })).status
    ).toBe(200)

    const ok = await postJson(
      env,
      "/api/me/password",
      {
        currentPassword: "correct-horse-battery",
        newPassword: "brand-new-password"
      },
      { cookie }
    )
    expect(ok.status).toBe(200)
    expect(
      (await request(env, "/api/me", { headers: { cookie: other } })).status
    ).toBe(401)
    expect(
      (await request(env, "/api/me", { headers: { cookie } })).status
    ).toBe(200)

    expect(
      (
        await loginUser(env, {
          email: "owner@example.test",
          password: "brand-new-password"
        })
      ).status
    ).toBe(200)
  })

  it("TOTP：setup → enable → disable（关掉需要密码）", async () => {
    const { env } = await initializedContext()
    const { cookie } = await registerAndLogin(env, {
      email: "owner@example.test"
    })

    const setup = await request(env, "/api/auth/2fa/totp/setup", {
      method: "POST",
      headers: { cookie }
    })
    expect(setup.status).toBe(200)
    const firstSetup = (await setup.json()) as {
      secret: string
      otpauthUrl: string
    }
    expect(firstSetup.otpauthUrl.startsWith("otpauth://totp/")).toBe(true)

    const secondSetup = await request(env, "/api/auth/2fa/totp/setup", {
      method: "POST",
      headers: { cookie }
    })
    // 未启用前允许重新生成：以最后一次的密钥为准
    expect(secondSetup.status).toBe(200)
    const pending = (await secondSetup.json()) as { secret: string }

    const enable = await postJson(
      env,
      "/api/auth/2fa/totp/enable",
      { code: currentCode(pending.secret) },
      { cookie }
    )
    expect(enable.status).toBe(200)

    const again = await request(env, "/api/auth/2fa/totp/setup", {
      method: "POST",
      headers: { cookie }
    })
    expect(again.status).toBe(409)
    expect(((await again.json()) as { code: string }).code).toBe(
      "TOTP_ALREADY_ENABLED"
    )

    const disableWrong = await postJson(
      env,
      "/api/auth/2fa/totp/disable",
      { password: "nope" },
      { cookie }
    )
    expect(disableWrong.status).toBe(403)

    const disable = await postJson(
      env,
      "/api/auth/2fa/totp/disable",
      { password: "correct-horse-battery" },
      { cookie }
    )
    expect(disable.status).toBe(200)

    const me = (await (
      await request(env, "/api/me", { headers: { cookie } })
    ).json()) as { twoFactor: { totpEnabled: boolean } }
    expect(me.twoFactor.totpEnabled).toBe(false)
  })
})

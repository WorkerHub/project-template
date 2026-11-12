/**
 * 规格 §7-9（验证码生命周期）：6 位、只存哈希、10 分钟、5 次尝试、单次使用、
 * 重发冷却、新码废旧码。直接测服务模块（HTTP 层已在找回密码/邮箱验证用例里覆盖）。
 */
import { describe, expect, it } from "vitest"
import {
  checkResendCooldown,
  CODE_MAX_ATTEMPTS,
  CODE_TTL_SECONDS,
  issueVerificationCode,
  verifyVerificationCode
} from "../src/core/verification-codes"
import { emailCodesTable } from "../src/lib/tables"
import { activePrefix, initializedContext } from "./support/app"

const NOW = 1_800_000_000

describe("验证码生命周期", () => {
  it("6 位数字，库里只存哈希（不是明文，也不是裸哈希）", async () => {
    const { env, db } = await initializedContext()
    const { code, expiresAt } = await issueVerificationCode(
      env,
      { email: "a@example.test", purpose: "password_reset" },
      NOW
    )
    expect(code).toMatch(/^\d{6}$/)
    expect(expiresAt).toBe(NOW + CODE_TTL_SECONDS)

    const row = db.db
      .prepare(
        `SELECT code_hash FROM ${emailCodesTable(activePrefix(env))} WHERE email = ?`
      )
      .get("a@example.test") as { code_hash: string }
    expect(row.code_hash).not.toBe(code)
    expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("单次使用：同一码第二次校验失败", async () => {
    const { env } = await initializedContext()
    const { code } = await issueVerificationCode(
      env,
      { email: "a@example.test", purpose: "register_verify" },
      NOW
    )
    expect(
      await verifyVerificationCode(
        env,
        { email: "a@example.test", purpose: "register_verify", code },
        NOW + 1
      )
    ).toEqual({ ok: true })
    expect(
      await verifyVerificationCode(
        env,
        { email: "a@example.test", purpose: "register_verify", code },
        NOW + 2
      )
    ).toEqual({ ok: false, reason: "missing" })
  })

  it("新码发出后旧码失效", async () => {
    const { env } = await initializedContext()
    const first = await issueVerificationCode(
      env,
      { email: "a@example.test", purpose: "password_reset" },
      NOW
    )
    const second = await issueVerificationCode(
      env,
      { email: "a@example.test", purpose: "password_reset" },
      NOW + 61
    )
    expect(first.code).not.toBe(second.code)
    // 旧码已作废：无论落到「不存在」还是「不匹配」，结果必须是否定的。
    expect(
      (
        await verifyVerificationCode(
          env,
          {
            email: "a@example.test",
            purpose: "password_reset",
            code: first.code
          },
          NOW + 62
        )
      ).ok
    ).toBe(false)
    expect(
      await verifyVerificationCode(
        env,
        {
          email: "a@example.test",
          purpose: "password_reset",
          code: second.code
        },
        NOW + 62
      )
    ).toEqual({ ok: true })
  })

  it("过期码失效（10 分钟）", async () => {
    const { env } = await initializedContext()
    const { code } = await issueVerificationCode(
      env,
      { email: "a@example.test", purpose: "password_reset" },
      NOW
    )
    expect(
      await verifyVerificationCode(
        env,
        { email: "a@example.test", purpose: "password_reset", code },
        NOW + CODE_TTL_SECONDS + 1
      )
    ).toEqual({ ok: false, reason: "expired" })
  })

  it("单码最多 5 次尝试，超限后正确码也不再通过", async () => {
    const { env } = await initializedContext()
    const { code } = await issueVerificationCode(
      env,
      { email: "a@example.test", purpose: "password_reset" },
      NOW
    )
    const wrong = code === "000000" ? "111111" : "000000"
    for (let i = 0; i < CODE_MAX_ATTEMPTS; i += 1) {
      expect(
        await verifyVerificationCode(
          env,
          { email: "a@example.test", purpose: "password_reset", code: wrong },
          NOW + i + 1
        )
      ).toEqual({ ok: false, reason: "mismatch" })
    }
    expect(
      await verifyVerificationCode(
        env,
        { email: "a@example.test", purpose: "password_reset", code },
        NOW + 10
      )
    ).toEqual({ ok: false, reason: "too_many_attempts" })
  })

  it("用途隔离：注册码不能用于找回密码", async () => {
    const { env } = await initializedContext()
    const { code } = await issueVerificationCode(
      env,
      { email: "a@example.test", purpose: "register_verify" },
      NOW
    )
    expect(
      await verifyVerificationCode(
        env,
        { email: "a@example.test", purpose: "password_reset", code },
        NOW + 1
      )
    ).toEqual({ ok: false, reason: "missing" })
  })

  it("重发冷却 60 秒，按邮箱 + 用途各自计数", async () => {
    const { env } = await initializedContext()
    expect(
      await checkResendCooldown(
        env,
        { email: "a@example.test", purpose: "password_reset" },
        NOW
      )
    ).toMatchObject({ allowed: true })
    const blocked = await checkResendCooldown(
      env,
      { email: "a@example.test", purpose: "password_reset" },
      NOW + 10
    )
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfter).toBe(50)

    // 另一个用途不受影响
    expect(
      (
        await checkResendCooldown(
          env,
          { email: "a@example.test", purpose: "register_verify" },
          NOW + 10
        )
      ).allowed
    ).toBe(true)

    // 窗口过后重开
    expect(
      (
        await checkResendCooldown(
          env,
          { email: "a@example.test", purpose: "password_reset" },
          NOW + 61
        )
      ).allowed
    ).toBe(true)
  })
})

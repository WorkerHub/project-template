import { describe, expect, it } from "vitest"
import { ApiError } from "@/lib/api"
import { isWebAuthnCancelled } from "@/lib/webauthn"

describe("WebAuthn 错误分类 (isWebAuthnCancelled)", () => {
  describe("取消类错误（应静默）", () => {
    it("识别 DOMException NotAllowedError 为取消", () => {
      const error = new DOMException(
        "The operation either timed out or was not allowed",
        "NotAllowedError"
      )
      expect(isWebAuthnCancelled(error)).toBe(true)
    })

    it("识别 DOMException AbortError 为取消", () => {
      const error = new DOMException("The user aborted a request", "AbortError")
      expect(isWebAuthnCancelled(error)).toBe(true)
    })

    it("识别带 name 属性的对象 NotAllowedError 为取消", () => {
      expect(isWebAuthnCancelled({ name: "NotAllowedError" })).toBe(true)
    })

    it("识别带 name 属性的对象 AbortError 为取消", () => {
      expect(isWebAuthnCancelled({ name: "AbortError" })).toBe(true)
    })
  })

  describe("真实失败与其它异常（应报错，不许吞掉）", () => {
    it("非取消类 DOMException（如 InvalidStateError、SecurityError）不视为取消", () => {
      expect(
        isWebAuthnCancelled(
          new DOMException("Device already registered", "InvalidStateError")
        )
      ).toBe(false)
      expect(
        isWebAuthnCancelled(new DOMException("Security error", "SecurityError"))
      ).toBe(false)
    })

    it("后端 ApiError 不视为取消", () => {
      const apiError = new ApiError({
        status: 401,
        message: "Passkey verification failed",
        code: "PASSKEY_FAILED"
      })
      expect(isWebAuthnCancelled(apiError)).toBe(false)
    })

    it("普通 Error 对象（即使 message 包含 NotAllowedError）不视为取消", () => {
      expect(isWebAuthnCancelled(new Error("NotAllowedError"))).toBe(false)
      expect(isWebAuthnCancelled(new Error("Unknown device error"))).toBe(false)
    })

    it("空值与非对象入参不视为取消", () => {
      expect(isWebAuthnCancelled(null)).toBe(false)
      expect(isWebAuthnCancelled(undefined)).toBe(false)
      expect(isWebAuthnCancelled({})).toBe(false)
      expect(isWebAuthnCancelled("NotAllowedError")).toBe(false)
      expect(isWebAuthnCancelled(123)).toBe(false)
    })
  })
})

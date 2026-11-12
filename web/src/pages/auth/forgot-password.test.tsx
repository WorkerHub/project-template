import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api"
import { ForgotPasswordPage } from "@/pages/auth/forgot-password"

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    authApi: {
      ...actual.authApi,
      forgotPassword: vi.fn(),
      resetPassword: vi.fn()
    },
    meApi: { ...actual.meApi, get: vi.fn(), update: vi.fn() }
  }
})

const { authApi } = await import("@/lib/api")

function renderForgot() {
  return render(
    <MemoryRouter>
      <ForgotPasswordPage />
    </MemoryRouter>
  )
}

describe("找回密码", () => {
  it("三步走通：邮箱 → 验证码 → 新密码", async () => {
    vi.mocked(authApi.forgotPassword).mockResolvedValue({ success: true })
    vi.mocked(authApi.resetPassword).mockResolvedValue({ success: true })

    const user = userEvent.setup()
    renderForgot()

    await user.type(screen.getByLabelText("邮箱"), "owner@example.com")
    await user.click(screen.getByRole("button", { name: "发送验证码" }))

    // 防枚举：无论邮箱是否存在，界面都只说「已发送」。
    expect(
      await screen.findByText("如果该邮箱已注册，验证码已发送。")
    ).toBeInTheDocument()

    await user.type(screen.getByLabelText("输入验证码"), "123456")
    await user.click(screen.getByRole("button", { name: "下一步" }))

    await user.type(screen.getByLabelText("新密码"), "new-long-password")
    await user.click(screen.getByRole("button", { name: "重置密码" }))

    expect(await screen.findByText("密码已重置")).toBeInTheDocument()
    expect(authApi.resetPassword).toHaveBeenCalledWith({
      email: "owner@example.com",
      code: "123456",
      password: "new-long-password"
    })
  })

  it("发送后进入冷却：验证码步重发与返回后的发送按钮都不可点", async () => {
    vi.mocked(authApi.forgotPassword).mockResolvedValue({ success: true })

    const user = userEvent.setup()
    renderForgot()
    await user.type(screen.getByLabelText("邮箱"), "owner@example.com")
    await user.click(screen.getByRole("button", { name: "发送验证码" }))
    await screen.findByLabelText("输入验证码")

    const resend = screen.getByRole("button", { name: "60 秒后可重发" })
    expect(resend).toBeDisabled()

    await user.click(screen.getByRole("button", { name: "返回" }))
    const again = screen.getByRole("button", { name: "60 秒后可重发" })
    expect(again).toBeDisabled()
  })

  it("429 按 retryAfter 起倒计时", async () => {
    vi.mocked(authApi.forgotPassword).mockRejectedValue(
      new ApiError({
        status: 429,
        message: "slow down",
        code: "RATE_LIMITED",
        retryAfter: 30
      })
    )

    const user = userEvent.setup()
    renderForgot()
    await user.type(screen.getByLabelText("邮箱"), "owner@example.com")
    await user.click(screen.getByRole("button", { name: "发送验证码" }))

    expect(
      await screen.findByRole("button", { name: "30 秒后可重发" })
    ).toBeDisabled()
    expect(screen.getByRole("alert")).toHaveTextContent(
      "尝试过于频繁，请 30 秒后再试"
    )
  })

  it("验证码错误回到验证码步", async () => {
    vi.mocked(authApi.forgotPassword).mockResolvedValue({ success: true })
    vi.mocked(authApi.resetPassword).mockRejectedValue(
      new ApiError({ status: 400, message: "bad code", code: "INVALID_CODE" })
    )

    const user = userEvent.setup()
    renderForgot()
    await user.type(screen.getByLabelText("邮箱"), "owner@example.com")
    await user.click(screen.getByRole("button", { name: "发送验证码" }))
    await screen.findByLabelText("输入验证码")
    await user.type(screen.getByLabelText("输入验证码"), "000000")
    await user.click(screen.getByRole("button", { name: "下一步" }))
    await user.type(screen.getByLabelText("新密码"), "new-long-password")
    await user.click(screen.getByRole("button", { name: "重置密码" }))

    expect(await screen.findByLabelText("输入验证码")).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("验证码不正确")
  })
})

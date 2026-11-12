import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api"
import { me, publicInfo } from "@/test/fixtures"
import { LoginPage } from "@/pages/auth/login"
import { useSiteStore } from "@/stores/site"

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    authApi: {
      ...actual.authApi,
      login: vi.fn(),
      verifySecondFactor: vi.fn(),
      passkeyLoginOptions: vi.fn(),
      passkeyLoginVerify: vi.fn(),
      verifyEmail: vi.fn(),
      resendEmail: vi.fn(),
      logout: vi.fn()
    },
    meApi: { ...actual.meApi, get: vi.fn(), update: vi.fn() }
  }
})

const { authApi } = await import("@/lib/api")

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/workbench" element={<p>workbench</p>} />
      </Routes>
    </MemoryRouter>
  )
}

async function enterPassword(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("邮箱"), "owner@example.com")
  await user.type(screen.getByLabelText("密码"), "secret-password")
  await user.click(screen.getByRole("button", { name: "登录" }))
}

beforeEach(() => {
  useSiteStore.setState({ info: publicInfo(), loaded: true })
})

describe("登录两步（技术方案 §5B）", () => {
  it("密码步的密码框是唯一 type=password，验证码框换成新节点且属性合规", async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      requires2fa: true,
      tempToken: "temp-token",
      methods: ["totp"]
    })
    const user = userEvent.setup()
    renderLogin()

    const passwordForm = document.getElementById("password-step")
    const passwordInput = screen.getByLabelText("密码")
    expect(passwordInput).toHaveAttribute("type", "password")
    expect(passwordInput).toHaveAttribute("autocomplete", "current-password")
    expect(passwordInput).toHaveAttribute("name", "password")

    await enterPassword(user)

    const otp = await screen.findByLabelText("验证码")
    expect(otp).toHaveAttribute("type", "text")
    expect(otp).toHaveAttribute("autocomplete", "one-time-code")
    expect(otp).toHaveAttribute("inputmode", "numeric")
    expect(otp.getAttribute("name")).not.toMatch(/password/i)
    expect(otp.getAttribute("id")).not.toMatch(/password/i)

    // 换步 = 换节点：旧表单与旧输入框都已卸载，不存在原地复用。
    const totpForm = document.getElementById("totp-step")
    expect(totpForm).not.toBeNull()
    expect(totpForm).not.toBe(passwordForm)
    expect(passwordForm?.isConnected).toBe(false)
    expect(passwordInput.isConnected).toBe(false)
    expect(totpForm?.querySelector('input[type="password"]')).toBeNull()
  })

  it("两步走通后进入工作台", async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      requires2fa: true,
      tempToken: "temp-token",
      methods: ["totp"]
    })
    vi.mocked(authApi.verifySecondFactor).mockResolvedValue({
      success: true,
      user: me()
    })

    const user = userEvent.setup()
    renderLogin()
    await enterPassword(user)
    await user.type(await screen.findByLabelText("验证码"), "123456")
    await user.click(screen.getByRole("button", { name: "验证" }))

    expect(await screen.findByText("workbench")).toBeInTheDocument()
    expect(authApi.verifySecondFactor).toHaveBeenCalledWith({
      tempToken: "temp-token",
      method: "totp",
      code: "123456"
    })
  })

  it("未验证邮箱换成验证码步，提交带邮箱与验证码", async () => {
    vi.mocked(authApi.login).mockRejectedValue(
      new ApiError({
        status: 403,
        message: "Email not verified",
        code: "EMAIL_NOT_VERIFIED"
      })
    )
    vi.mocked(authApi.verifyEmail).mockResolvedValue({ success: true })

    const user = userEvent.setup()
    renderLogin()
    await enterPassword(user)

    const code = await screen.findByLabelText("验证码")
    await user.type(code, "654321")
    await user.click(screen.getByRole("button", { name: "验证" }))

    await waitFor(() =>
      expect(authApi.verifyEmail).toHaveBeenCalledWith({
        email: "owner@example.com",
        code: "654321"
      })
    )
    expect(await screen.findByRole("status")).toHaveTextContent("邮箱已验证")
  })

  it("待批准账号显示可翻译提示，不进入工作台", async () => {
    vi.mocked(authApi.login).mockRejectedValue(
      new ApiError({
        status: 403,
        message: "Pending",
        code: "ACCOUNT_PENDING"
      })
    )
    const user = userEvent.setup()
    renderLogin()
    await enterPassword(user)

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "账号等待管理员批准"
    )
    expect(screen.queryByText("workbench")).not.toBeInTheDocument()
  })
})

describe("找回密码入口随邮件配置显隐", () => {
  it("邮件未配置时登录页不显示找回入口", () => {
    useSiteStore.setState({
      info: publicInfo({ emailConfigured: false }),
      loaded: true
    })
    renderLogin()
    expect(screen.queryByText("忘记密码？")).not.toBeInTheDocument()
  })

  it("邮件已配置时显示找回入口", () => {
    renderLogin()
    expect(screen.getByText("忘记密码？")).toBeInTheDocument()
  })
})

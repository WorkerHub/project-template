import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api"
import { LoginPage } from "@/pages/auth/login"
import { useAuthStore } from "@/stores/auth"
import { useSiteStore } from "@/stores/site"
import { me, publicInfo } from "@/test/fixtures"

vi.mock("@/lib/webauthn", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/webauthn")>()
  return {
    ...actual,
    webauthnSupported: vi.fn(() => false),
    authenticationCredential: vi.fn(),
    isWebAuthnCancelled: vi.fn(() => false)
  }
})

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
      passkeyDirectLoginOptions: vi.fn(),
      passkeyDirectLoginVerify: vi.fn(),
      verifyEmail: vi.fn(),
      resendEmail: vi.fn(),
      logout: vi.fn(),
      emailTwoFactorSend: vi.fn()
    },
    meApi: { ...actual.meApi, get: vi.fn(), update: vi.fn() }
  }
})

const { authApi } = await import("@/lib/api")
const { webauthnSupported, authenticationCredential } = await import(
  "@/lib/webauthn"
)

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/workbench" element={<p>workbench</p>} />
        <Route path="/change-password" element={<p>change-password</p>} />
      </Routes>
    </MemoryRouter>
  )
}

async function enterPassword(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("邮箱"), "owner@example.com")
  await user.type(screen.getByLabelText("密码"), "secret-password")
  await user.click(screen.getByRole("button", { name: "登录" }))
}

async function enterEmailStep(user: ReturnType<typeof userEvent.setup>) {
  await enterPassword(user)
  await user.click(screen.getByRole("button", { name: "用邮箱验证码登录" }))
}

beforeEach(() => {
  useSiteStore.setState({ info: publicInfo(), loaded: true })
  useAuthStore.setState({ user: null, status: "ready" })
  vi.mocked(webauthnSupported).mockReturnValue(false)
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

  it("首登账号登录后落在改密页而不是工作台", async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      success: true,
      user: me({ mustChangePassword: true })
    })

    const user = userEvent.setup()
    renderLogin()
    await enterPassword(user)

    expect(await screen.findByText("change-password")).toBeInTheDocument()
    expect(screen.queryByText("workbench")).not.toBeInTheDocument()
    expect(useAuthStore.getState().user?.mustChangePassword).toBe(true)
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

  it("仅 email 方法时不显示 noMethods，且出现邮箱入口", async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      requires2fa: true,
      tempToken: "temp-token",
      methods: ["email"]
    })
    const user = userEvent.setup()
    renderLogin()
    await enterPassword(user)

    expect(
      screen.queryByText("该账号没有可用的验证方式，请联系管理员。")
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "用邮箱验证码登录" })
    ).toBeInTheDocument()
  })

  it("点发送后 emailTwoFactorSend 收到 tempToken，出现验证码输入", async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      requires2fa: true,
      tempToken: "temp-token",
      methods: ["email"]
    })
    vi.mocked(authApi.emailTwoFactorSend).mockResolvedValue({ success: true })
    const user = userEvent.setup()
    renderLogin()
    await enterEmailStep(user)

    await user.click(screen.getByRole("button", { name: "发送验证码" }))

    expect(authApi.emailTwoFactorSend).toHaveBeenCalledWith("temp-token")
    expect(await screen.findByLabelText("验证码")).toBeInTheDocument()
  })

  it("验码 verifySecondFactor({method:'email'}) 进入工作台", async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      requires2fa: true,
      tempToken: "temp-token",
      methods: ["email"]
    })
    vi.mocked(authApi.emailTwoFactorSend).mockResolvedValue({ success: true })
    vi.mocked(authApi.verifySecondFactor).mockResolvedValue({
      success: true,
      user: me()
    })
    const user = userEvent.setup()
    renderLogin()
    await enterEmailStep(user)

    await user.click(screen.getByRole("button", { name: "发送验证码" }))
    await user.type(await screen.findByLabelText("验证码"), "654321")
    await user.click(screen.getByRole("button", { name: "验证" }))

    await waitFor(() =>
      expect(authApi.verifySecondFactor).toHaveBeenCalledWith({
        tempToken: "temp-token",
        method: "email",
        code: "654321"
      })
    )
    expect(await screen.findByText("workbench")).toBeInTheDocument()
  })

  it("502 不进倒计时", async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      requires2fa: true,
      tempToken: "temp-token",
      methods: ["email"]
    })
    vi.mocked(authApi.emailTwoFactorSend).mockRejectedValue(
      new ApiError({
        status: 502,
        message: "Bad Gateway",
        code: "EMAIL_SEND_FAILED"
      })
    )
    const user = userEvent.setup()
    renderLogin()
    await enterEmailStep(user)

    await user.click(screen.getByRole("button", { name: "发送验证码" }))

    await waitFor(() =>
      expect(authApi.emailTwoFactorSend).toHaveBeenCalledTimes(1)
    )
    // 502 不触发倒计时：按钮仍是「发送验证码」且未被禁用
    const sendBtn = await screen.findByRole("button", { name: "发送验证码" })
    expect(sendBtn).not.toBeDisabled()
    expect(screen.getByRole("alert")).toHaveTextContent("邮件发送失败")
  })

  it("429 用 retryAfter 起倒计时", async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      requires2fa: true,
      tempToken: "temp-token",
      methods: ["email"]
    })
    vi.mocked(authApi.emailTwoFactorSend).mockRejectedValue(
      new ApiError({
        status: 429,
        message: "Too Many",
        code: "RATE_LIMITED",
        retryAfter: 5
      })
    )
    const user = userEvent.setup()
    renderLogin()
    await enterEmailStep(user)

    await user.click(screen.getByRole("button", { name: "发送验证码" }))

    await waitFor(() =>
      expect(authApi.emailTwoFactorSend).toHaveBeenCalledTimes(1)
    )
    // 429 带 retryAfter=5：按钮进入倒计时并禁用（真实计时器 + 断言文案出现）
    expect(
      await screen.findByRole("button", { name: "5 秒后可重发" })
    ).toBeDisabled()
  })

  it("401 STEP_UP_REQUIRED 退回密码步", async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      requires2fa: true,
      tempToken: "temp-token",
      methods: ["email"]
    })
    vi.mocked(authApi.emailTwoFactorSend).mockResolvedValue({ success: true })
    vi.mocked(authApi.verifySecondFactor).mockRejectedValue(
      new ApiError({
        status: 401,
        message: "STEP_UP_REQUIRED",
        code: "STEP_UP_REQUIRED"
      })
    )
    const user = userEvent.setup()
    renderLogin()
    await enterEmailStep(user)

    await user.click(screen.getByRole("button", { name: "发送验证码" }))
    await user.type(await screen.findByLabelText("验证码"), "000000")
    await user.click(screen.getByRole("button", { name: "验证" }))

    await waitFor(() =>
      expect(authApi.verifySecondFactor).toHaveBeenCalledWith({
        tempToken: "temp-token",
        method: "email",
        code: "000000"
      })
    )
    // 退回密码步：密码框重新出现
    expect(await screen.findByLabelText("密码")).toBeInTheDocument()
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

describe("Passkey 直接免密登录", () => {
  it("浏览器不支持 WebAuthn 时不显示直接登录入口", () => {
    vi.mocked(webauthnSupported).mockReturnValue(false)
    renderLogin()
    expect(
      screen.queryByRole("button", { name: "用 Passkey 登录" })
    ).not.toBeInTheDocument()
  })

  it("浏览器支持 WebAuthn 时在密码步显示「用 Passkey 登录」入口", () => {
    vi.mocked(webauthnSupported).mockReturnValue(true)
    renderLogin()
    expect(
      screen.getByRole("button", { name: "用 Passkey 登录" })
    ).toBeInTheDocument()
  })

  it("直接登录走通后进入工作台", async () => {
    vi.mocked(webauthnSupported).mockReturnValue(true)
    vi.mocked(authApi.passkeyDirectLoginOptions).mockResolvedValue({
      challenge: "test-challenge"
    })
    const mockCred = {
      id: "cred-1",
      rawId: "cred-1",
      response: { clientDataJSON: "abc" },
      type: "public-key"
    }
    vi.mocked(authenticationCredential).mockResolvedValue(mockCred as never)
    vi.mocked(authApi.passkeyDirectLoginVerify).mockResolvedValue({
      success: true,
      user: me()
    })

    const user = userEvent.setup()
    renderLogin()
    await user.click(screen.getByRole("button", { name: "用 Passkey 登录" }))

    expect(authApi.passkeyDirectLoginOptions).toHaveBeenCalledTimes(1)
    expect(authenticationCredential).toHaveBeenCalledWith({
      challenge: "test-challenge"
    })
    expect(authApi.passkeyDirectLoginVerify).toHaveBeenCalledWith(mockCred)
    expect(await screen.findByText("workbench")).toBeInTheDocument()
    expect(useAuthStore.getState().user?.email).toBe("owner@example.com")
  })

  it("首登账号用 Passkey 直接登录后落在改密页", async () => {
    vi.mocked(webauthnSupported).mockReturnValue(true)
    vi.mocked(authApi.passkeyDirectLoginOptions).mockResolvedValue({
      challenge: "test-challenge"
    })
    vi.mocked(authenticationCredential).mockResolvedValue({
      id: "cred-1"
    } as never)
    vi.mocked(authApi.passkeyDirectLoginVerify).mockResolvedValue({
      success: true,
      user: me({ mustChangePassword: true })
    })

    const user = userEvent.setup()
    renderLogin()
    await user.click(screen.getByRole("button", { name: "用 Passkey 登录" }))

    expect(await screen.findByText("change-password")).toBeInTheDocument()
    expect(useAuthStore.getState().user?.mustChangePassword).toBe(true)
  })

  it("用户取消或设备无凭据时停留在登录页，报 Passkey 失败且密码登录可用", async () => {
    vi.mocked(webauthnSupported).mockReturnValue(true)
    vi.mocked(authApi.passkeyDirectLoginOptions).mockResolvedValue({
      challenge: "test-challenge"
    })
    vi.mocked(authenticationCredential).mockRejectedValue(
      new Error("NotAllowedError")
    )

    const user = userEvent.setup()
    renderLogin()
    await user.click(screen.getByRole("button", { name: "用 Passkey 登录" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Passkey 验证未通过"
    )
    expect(screen.queryByText("workbench")).not.toBeInTheDocument()
    expect(screen.getByLabelText("邮箱")).toBeInTheDocument()
    expect(screen.getByLabelText("密码")).toBeInTheDocument()
  })

  it("服务端验证失败报 PASSKEY_FAILED 时，给出可理解的错误而不误报密码错误", async () => {
    vi.mocked(webauthnSupported).mockReturnValue(true)
    vi.mocked(authApi.passkeyDirectLoginOptions).mockResolvedValue({
      challenge: "test-challenge"
    })
    vi.mocked(authenticationCredential).mockResolvedValue({
      id: "cred-1"
    } as never)
    vi.mocked(authApi.passkeyDirectLoginVerify).mockRejectedValue(
      new ApiError({
        status: 401,
        message: "Passkey verification failed",
        code: "PASSKEY_FAILED"
      })
    )

    const user = userEvent.setup()
    renderLogin()
    await user.click(screen.getByRole("button", { name: "用 Passkey 登录" }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Passkey 验证未通过")
    expect(alert).not.toHaveTextContent("邮箱或密码不正确")
    expect(screen.queryByText("workbench")).not.toBeInTheDocument()
  })

  it("pending / disabled 账号直接登录被拒绝，展示对应提示", async () => {
    vi.mocked(webauthnSupported).mockReturnValue(true)
    vi.mocked(authApi.passkeyDirectLoginOptions).mockResolvedValue({
      challenge: "test-challenge"
    })
    vi.mocked(authenticationCredential).mockResolvedValue({
      id: "cred-1"
    } as never)
    vi.mocked(authApi.passkeyDirectLoginVerify).mockRejectedValueOnce(
      new ApiError({
        status: 403,
        message: "Pending",
        code: "ACCOUNT_PENDING"
      })
    )

    const user = userEvent.setup()
    renderLogin()
    await user.click(screen.getByRole("button", { name: "用 Passkey 登录" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "账号等待管理员批准"
    )

    vi.mocked(authApi.passkeyDirectLoginVerify).mockRejectedValueOnce(
      new ApiError({
        status: 403,
        message: "Disabled",
        code: "ACCOUNT_DISABLED"
      })
    )
    await user.click(screen.getByRole("button", { name: "用 Passkey 登录" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("账号已被禁用")
  })

  it("直接登录触发 429 锁定起倒计时", async () => {
    vi.mocked(webauthnSupported).mockReturnValue(true)
    vi.mocked(authApi.passkeyDirectLoginOptions).mockResolvedValue({
      challenge: "test-challenge"
    })
    vi.mocked(authenticationCredential).mockResolvedValue({
      id: "cred-1"
    } as never)
    vi.mocked(authApi.passkeyDirectLoginVerify).mockRejectedValue(
      new ApiError({
        status: 429,
        message: "Locked",
        code: "ACCOUNT_LOCKED",
        retryAfter: 15
      })
    )

    const user = userEvent.setup()
    renderLogin()
    await user.click(screen.getByRole("button", { name: "用 Passkey 登录" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "尝试次数过多，请 15 秒后再试"
    )
  })

  it("未验证邮箱换成验证码步", async () => {
    vi.mocked(webauthnSupported).mockReturnValue(true)
    vi.mocked(authApi.passkeyDirectLoginOptions).mockResolvedValue({
      challenge: "test-challenge"
    })
    vi.mocked(authenticationCredential).mockResolvedValue({
      id: "cred-1"
    } as never)
    vi.mocked(authApi.passkeyDirectLoginVerify).mockRejectedValue(
      new ApiError({
        status: 403,
        message: "Not verified",
        code: "EMAIL_NOT_VERIFIED",
        email: "passkey@example.com"
      })
    )

    const user = userEvent.setup()
    renderLogin()
    await user.click(screen.getByRole("button", { name: "用 Passkey 登录" }))
    expect(await screen.findByText(/passkey@example.com/)).toBeInTheDocument()
    expect(screen.getByLabelText("验证码")).toBeInTheDocument()
  })

  it("2FA 第二步用 Passkey 登录照常可用", async () => {
    vi.mocked(webauthnSupported).mockReturnValue(true)
    vi.mocked(authApi.login).mockResolvedValue({
      requires2fa: true,
      tempToken: "temp-token",
      methods: ["passkey"]
    })
    vi.mocked(authApi.passkeyLoginOptions).mockResolvedValue({
      challenge: "2fa-challenge"
    })
    vi.mocked(authenticationCredential).mockResolvedValue({
      id: "2fa-cred"
    } as never)
    vi.mocked(authApi.passkeyLoginVerify).mockResolvedValue({
      success: true,
      user: me()
    })

    const user = userEvent.setup()
    renderLogin()
    await enterPassword(user)
    await user.click(
      await screen.findByRole("button", { name: "用 Passkey 登录" })
    )

    expect(authApi.passkeyLoginOptions).toHaveBeenCalledWith("temp-token")
    expect(authApi.passkeyLoginVerify).toHaveBeenCalledWith("temp-token", {
      id: "2fa-cred"
    })
    expect(await screen.findByText("workbench")).toBeInTheDocument()
  })
})

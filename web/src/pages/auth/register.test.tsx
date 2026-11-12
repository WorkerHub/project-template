import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { changeLanguage } from "@/i18n"
import { publicInfo } from "@/test/fixtures"
import { RegisterPage } from "@/pages/auth/register"
import { useSiteStore } from "@/stores/site"

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    authApi: {
      ...actual.authApi,
      register: vi.fn(),
      verifyEmail: vi.fn(),
      resendEmail: vi.fn()
    },
    meApi: { ...actual.meApi, get: vi.fn(), update: vi.fn() }
  }
})

const { authApi } = await import("@/lib/api")

function renderRegister() {
  return render(
    <MemoryRouter>
      <RegisterPage />
    </MemoryRouter>
  )
}

async function enterCredentials(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("邮箱"), "new@example.com")
  await user.type(screen.getByLabelText("密码"), "long-enough-password")
  if (screen.queryByRole("button", { name: "注册" })) {
    await user.click(screen.getByRole("button", { name: "注册" }))
  }
}

beforeEach(() => {
  useSiteStore.setState({ info: publicInfo(), loaded: true })
})

describe("注册", () => {
  it("请求体带注册页当前语言", async () => {
    await changeLanguage("en")
    vi.mocked(authApi.register).mockResolvedValue({
      requiresApproval: false,
      requiresEmailVerification: false
    })

    const user = userEvent.setup()
    renderRegister()
    await user.type(screen.getByLabelText("Email"), "new@example.com")
    await user.type(screen.getByLabelText("Password"), "long-enough-password")
    await user.click(screen.getByRole("button", { name: "Create account" }))

    expect(authApi.register).toHaveBeenCalledWith({
      email: "new@example.com",
      password: "long-enough-password",
      language: "en"
    })
  })

  it("需要邮箱验证时换成验证码步，验证后进入待批准态", async () => {
    vi.mocked(authApi.register).mockResolvedValue({
      requiresApproval: true,
      requiresEmailVerification: true
    })
    vi.mocked(authApi.verifyEmail).mockResolvedValue({ success: true })

    const user = userEvent.setup()
    renderRegister()
    await enterCredentials(user)

    const code = await screen.findByLabelText("验证码")
    await user.type(code, "123456")
    await user.click(screen.getByRole("button", { name: "验证" }))

    expect(await screen.findByText("已提交注册")).toBeInTheDocument()
    expect(screen.getByText("账号需管理员批准后才能登录。")).toBeInTheDocument()
    expect(authApi.verifyEmail).toHaveBeenCalledWith({
      email: "new@example.com",
      code: "123456"
    })
  })

  it("只需要审核时直接显示待批准态", async () => {
    vi.mocked(authApi.register).mockResolvedValue({
      requiresApproval: true,
      requiresEmailVerification: false
    })

    const user = userEvent.setup()
    renderRegister()
    await enterCredentials(user)

    expect(await screen.findByText("已提交注册")).toBeInTheDocument()
    expect(screen.queryByLabelText("验证码")).not.toBeInTheDocument()
  })

  it("单人档不渲染注册表单", () => {
    useSiteStore.setState({
      info: publicInfo({ appMode: "single" }),
      loaded: true
    })
    renderRegister()
    expect(screen.queryByLabelText("邮箱")).not.toBeInTheDocument()
  })

  it("注册关闭时不渲染表单", () => {
    useSiteStore.setState({
      info: publicInfo({ registrationEnabled: false }),
      loaded: true
    })
    renderRegister()
    expect(screen.queryByLabelText("邮箱")).not.toBeInTheDocument()
    expect(screen.getByText("本站未开放注册")).toBeInTheDocument()
  })
})

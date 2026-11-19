import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api"
import { publicInfo, setupState } from "@/test/fixtures"
import { SetupPage } from "@/pages/setup"
import { useSetupStore } from "@/stores/setup"
import { useSiteStore } from "@/stores/site"

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    setupApi: {
      ...actual.setupApi,
      run: vi.fn(),
      state: vi.fn(),
      createOwner: vi.fn()
    },
    authApi: { ...actual.authApi, login: vi.fn(), logout: vi.fn() },
    meApi: { ...actual.meApi, get: vi.fn(), update: vi.fn() }
  }
})

const { setupApi } = await import("@/lib/api")

function renderSetup() {
  return render(
    <MemoryRouter>
      <SetupPage />
    </MemoryRouter>
  )
}

beforeEach(() => {
  useSiteStore.setState({ info: publicInfo(), loaded: true })
  vi.mocked(setupApi.state).mockResolvedValue(setupState())
})

describe("初始化页形态（规格 §5.3）", () => {
  it("未初始化：密钥框属性合规，成功回显生效前缀与迁移", async () => {
    useSetupStore.setState({ state: setupState(), loaded: true })
    vi.mocked(setupApi.run).mockResolvedValue({
      success: true,
      tablePrefix: "template_",
      migrations: [{ name: "schema_v1", status: "applied" }]
    })

    const user = userEvent.setup()
    renderSetup()

    const secret = screen.getByLabelText("部署密钥")
    expect(secret).toHaveAttribute("id", "setup-secret")
    expect(secret).toHaveAttribute("name", "setup-secret")
    expect(secret).toHaveAttribute("autocomplete", "off")

    await user.type(secret, "deployment-secret")
    await user.click(screen.getByRole("button", { name: "初始化" }))

    expect(await screen.findByText("template_")).toBeInTheDocument()
    expect(screen.getByText("schema_v1")).toBeInTheDocument()
    expect(screen.getByText("已执行")).toBeInTheDocument()
    expect(setupApi.run).toHaveBeenCalledWith("deployment-secret")
  })

  it("已初始化：只显示关闭提示，不提供升级表单", () => {
    useSetupStore.setState({
      state: setupState({ ownerExists: true, enabled: true }),
      loaded: true
    })
    renderSetup()

    expect(screen.getByText("初始化页面已关闭")).toBeInTheDocument()
    expect(document.getElementById("setup-secret")).toBeNull()
    expect(document.getElementById("setup-upgrade")).toBeNull()
  })

  it("密钥错误时清空输入并给出可翻译提示", async () => {
    useSetupStore.setState({ state: setupState(), loaded: true })
    vi.mocked(setupApi.run).mockRejectedValue(
      new ApiError({ status: 403, message: "Invalid setup secret" })
    )

    const user = userEvent.setup()
    renderSetup()

    const secret = screen.getByLabelText("部署密钥") as HTMLInputElement
    await user.type(secret, "wrong-secret")
    await user.click(screen.getByRole("button", { name: "初始化" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("密钥不正确")
    expect(secret.value).toBe("")
  })

  it("前缀冲突用稳定错误码翻译，不直出后端原文", async () => {
    useSetupStore.setState({ state: setupState(), loaded: true })
    vi.mocked(setupApi.run).mockRejectedValue(
      new ApiError({
        status: 409,
        message: "TABLE_PREFIX mismatch ...",
        code: "PREFIX_CONFLICT"
      })
    )

    const user = userEvent.setup()
    renderSetup()
    await user.type(screen.getByLabelText("部署密钥"), "deployment-secret")
    await user.click(screen.getByRole("button", { name: "初始化" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "数据库已在其他表前缀下初始化，已中止"
    )
  })
})

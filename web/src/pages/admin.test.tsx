import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api"
import { adminSettings, me, pendingUser } from "@/test/fixtures"
import { AdminPage } from "@/pages/admin/admin-page"
import { useAuthStore } from "@/stores/auth"

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    adminApi: {
      ...actual.adminApi,
      settings: vi.fn(),
      updateSettings: vi.fn(),
      testEmail: vi.fn(),
      pendingUsers: vi.fn(),
      approveUser: vi.fn(),
      rejectUser: vi.fn(),
      runSetup: vi.fn()
    },
    meApi: { ...actual.meApi, get: vi.fn(), update: vi.fn() }
  }
})

const { adminApi } = await import("@/lib/api")

function renderAdmin() {
  return render(
    <MemoryRouter>
      <AdminPage />
    </MemoryRouter>
  )
}

beforeEach(() => {
  useAuthStore.setState({ user: me(), status: "ready" })
  vi.mocked(adminApi.pendingUsers).mockResolvedValue({ items: [] })
})

describe("系统管理", () => {
  it("邮件未配置时注册邮箱验证开关不可开启，并说明原因", async () => {
    vi.mocked(adminApi.settings).mockResolvedValue(
      adminSettings({
        email: {
          provider: "none",
          smtp: {
            host: "",
            port: "",
            username: "",
            passwordSet: false,
            from: "",
            fromName: ""
          },
          resend: { apiKeySet: false, from: "", fromName: "" },
          configured: false
        }
      })
    )

    renderAdmin()

    const toggle = await screen.findByRole("switch", {
      name: "注册需要验证邮箱"
    })
    expect(toggle).toBeDisabled()
    expect(screen.getByText(/邮件未配置，无法开启该开关/)).toBeInTheDocument()
    expect(screen.getByText("邮件未配置")).toBeInTheDocument()
  })

  it("单人档 registration 为 null 时不渲染注册开关", async () => {
    vi.mocked(adminApi.settings).mockResolvedValue(
      adminSettings({ registration: null })
    )
    renderAdmin()

    expect(await screen.findByText("邮件配置")).toBeInTheDocument()
    expect(screen.queryByText("开放注册")).not.toBeInTheDocument()
    expect(screen.queryByText("注册需要管理员批准")).not.toBeInTheDocument()
  })

  it("SMTP 字段按配置渲染，密码回显只给「已设置」而不回填", async () => {
    vi.mocked(adminApi.settings).mockResolvedValue(adminSettings())
    renderAdmin()

    expect(await screen.findByLabelText("服务器")).toHaveValue(
      "smtp.example.com"
    )
    const password = screen.getByLabelText("密码")
    expect(password).toHaveValue("")
    expect(password).toHaveAttribute("placeholder", "已设置，留空表示不修改")
  })

  it("保存时密钥留空＝不改，其它字段照常提交", async () => {
    vi.mocked(adminApi.settings).mockResolvedValue(adminSettings())
    vi.mocked(adminApi.updateSettings).mockResolvedValue(adminSettings())

    const user = userEvent.setup()
    renderAdmin()
    await screen.findByLabelText("服务器")
    await user.click(screen.getByRole("button", { name: "保存邮件配置" }))

    expect(adminApi.updateSettings).toHaveBeenCalledWith({
      email: {
        provider: "smtp",
        smtp: {
          host: "smtp.example.com",
          port: "587",
          username: "mailer",
          from: "noreply@example.com",
          fromName: "Template",
          password: ""
        },
        resend: { from: "", fromName: "", apiKey: "" }
      }
    })
  })

  it("测试邮件失败时直出 provider 原文", async () => {
    vi.mocked(adminApi.settings).mockResolvedValue(adminSettings())
    vi.mocked(adminApi.testEmail).mockRejectedValue(
      new ApiError({
        status: 502,
        message: "Email send failed",
        code: "EMAIL_SEND_FAILED",
        detail: "554 5.7.1 relay access denied"
      })
    )

    const user = userEvent.setup()
    renderAdmin()
    await screen.findByLabelText("收件人")
    await user.click(screen.getByRole("button", { name: "发送" }))

    expect(
      await screen.findByText("554 5.7.1 relay access denied")
    ).toBeInTheDocument()
  })

  it("待批准用户可批准，列表随后刷新", async () => {
    vi.mocked(adminApi.settings).mockResolvedValue(adminSettings())
    vi.mocked(adminApi.pendingUsers).mockResolvedValue({
      items: [pendingUser()]
    })
    vi.mocked(adminApi.approveUser).mockResolvedValue({ success: true })

    const user = userEvent.setup()
    renderAdmin()

    expect(await screen.findByText("pending@example.com")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "批准" }))

    await waitFor(() => expect(adminApi.approveUser).toHaveBeenCalledWith(2))
  })

  it("数据库维护回显生效前缀与迁移结果", async () => {
    vi.mocked(adminApi.settings).mockResolvedValue(adminSettings())
    vi.mocked(adminApi.runSetup).mockResolvedValue({
      success: true,
      tablePrefix: "template_",
      migrations: [{ name: "schema_v1", status: "skipped" }]
    })

    const user = userEvent.setup()
    renderAdmin()
    await screen.findByRole("button", { name: "检查并升级数据库" })
    await user.click(screen.getByRole("button", { name: "检查并升级数据库" }))

    expect(await screen.findByText("迁移完成")).toBeInTheDocument()
    expect(screen.getAllByText("template_").length).toBeGreaterThan(0)
    expect(screen.getByText("已跳过")).toBeInTheDocument()
  })
})

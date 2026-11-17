import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api"
import { me } from "@/test/fixtures"
import { ChangePasswordPage } from "@/pages/change-password"
import { useAuthStore } from "@/stores/auth"

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    authApi: { ...actual.authApi, logout: vi.fn() },
    meApi: { ...actual.meApi, changePassword: vi.fn() }
  }
})

const { authApi, meApi } = await import("@/lib/api")

const CURRENT = "temporary-password"
const NEXT = "brand-new-password-2026"

function renderPage(state?: { from?: string }) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/change-password", state }]}>
      <Routes>
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route path="/workbench" element={<p>workbench</p>} />
        <Route path="/settings" element={<p>settings</p>} />
        <Route path="/login" element={<p>login</p>} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  useAuthStore.setState({
    user: me({ mustChangePassword: true }),
    status: "ready"
  })
  vi.mocked(meApi.changePassword).mockResolvedValue({ success: true })
  vi.mocked(authApi.logout).mockResolvedValue({ success: true })
})

describe("首登强制改密页", () => {
  it("提交当前密码与新密码，成功后清标记并进入工作台", async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText("当前密码"), CURRENT)
    await user.type(screen.getByLabelText("新密码"), NEXT)
    await user.type(screen.getByLabelText("确认新密码"), NEXT)
    await user.click(screen.getByRole("button", { name: "更新密码" }))

    await waitFor(() =>
      expect(meApi.changePassword).toHaveBeenCalledWith({
        currentPassword: CURRENT,
        newPassword: NEXT
      })
    )
    expect(await screen.findByText("workbench")).toBeInTheDocument()
    expect(useAuthStore.getState().user?.mustChangePassword).toBe(false)
  })

  it("新密码不足 8 位时只提示，不发请求", async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText("当前密码"), CURRENT)
    await user.type(screen.getByLabelText("新密码"), "short")
    await user.click(screen.getByRole("button", { name: "更新密码" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("密码至少 8 位")
    expect(meApi.changePassword).not.toHaveBeenCalled()
  })

  it("两次输入不一致时只提示，不发请求", async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText("当前密码"), CURRENT)
    await user.type(screen.getByLabelText("新密码"), NEXT)
    await user.type(screen.getByLabelText("确认新密码"), "different-password")
    await user.click(screen.getByRole("button", { name: "更新密码" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "两次输入的密码不一致"
    )
    expect(meApi.changePassword).not.toHaveBeenCalled()
  })

  it("当前密码错误时留在页面并显示提示", async () => {
    vi.mocked(meApi.changePassword).mockRejectedValue(
      new ApiError({
        status: 403,
        message: "Password is incorrect",
        code: "PASSWORD_INCORRECT"
      })
    )
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText("当前密码"), "wrong-password")
    await user.type(screen.getByLabelText("新密码"), NEXT)
    await user.type(screen.getByLabelText("确认新密码"), NEXT)
    await user.click(screen.getByRole("button", { name: "更新密码" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("当前密码不正确")
    expect(screen.getByLabelText("当前密码")).toBeInTheDocument()
  })

  it("没有改密标记时直接访问会回工作台", async () => {
    useAuthStore.setState({ user: me(), status: "ready" })
    renderPage()

    expect(await screen.findByText("workbench")).toBeInTheDocument()
    expect(screen.queryByLabelText("当前密码")).not.toBeInTheDocument()
  })

  it("改密页带上原目标时，改完回原目标", async () => {
    const user = userEvent.setup()
    renderPage({ from: "/settings" })

    await user.type(screen.getByLabelText("当前密码"), CURRENT)
    await user.type(screen.getByLabelText("新密码"), NEXT)
    await user.type(screen.getByLabelText("确认新密码"), NEXT)
    await user.click(screen.getByRole("button", { name: "更新密码" }))

    expect(await screen.findByText("settings")).toBeInTheDocument()
  })

  it("退出登录回到登录页", async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole("button", { name: "退出登录" }))

    expect(await screen.findByText("login")).toBeInTheDocument()
    expect(authApi.logout).toHaveBeenCalled()
    expect(useAuthStore.getState().user).toBeNull()
  })
})

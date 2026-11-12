import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { me } from "@/test/fixtures"
import { SettingsPage } from "@/pages/settings"
import { useAuthStore } from "@/stores/auth"

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    meApi: {
      ...actual.meApi,
      get: vi.fn(),
      update: vi.fn(),
      changePassword: vi.fn(),
      passkeys: vi.fn(),
      deletePasskey: vi.fn()
    },
    authApi: {
      ...actual.authApi,
      totpSetup: vi.fn(),
      totpEnable: vi.fn(),
      totpDisable: vi.fn()
    }
  }
})

const { meApi } = await import("@/lib/api")

function renderSettings() {
  return render(<SettingsPage />)
}

beforeEach(() => {
  useAuthStore.setState({ user: me(), status: "ready" })
  vi.mocked(meApi.update).mockResolvedValue(me({ language: "en" }))
  vi.mocked(meApi.changePassword).mockResolvedValue({ success: true })
  vi.mocked(meApi.passkeys).mockResolvedValue({ items: [] })
})

describe("设置页", () => {
  it("切换语言即时生效并写回账号", async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByRole("tab", { name: "偏好" }))
    await user.click(screen.getByRole("radio", { name: "English" }))

    await waitFor(() =>
      expect(meApi.update).toHaveBeenCalledWith({ language: "en" })
    )
    expect(document.documentElement.lang).toBe("en")
  })

  it("主题切换写回账号（界面 auto 对应库里 system）", async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByRole("tab", { name: "偏好" }))
    await user.click(screen.getByRole("radio", { name: "暗色" }))

    await waitFor(() =>
      expect(meApi.update).toHaveBeenCalledWith({ theme: "dark" })
    )
  })

  it("修改密码提交当前密码与新密码", async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByRole("tab", { name: "安全" }))
    await user.type(screen.getByLabelText("当前密码"), "old-password")
    await user.type(screen.getByLabelText("新密码"), "brand-new-password")
    await user.click(screen.getByRole("button", { name: "更新密码" }))

    await waitFor(() =>
      expect(meApi.changePassword).toHaveBeenCalledWith({
        currentPassword: "old-password",
        newPassword: "brand-new-password"
      })
    )
  })
})

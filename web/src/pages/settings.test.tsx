import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SettingsPage } from "@/pages/settings"
import { useAuthStore } from "@/stores/auth"
import { useSiteStore } from "@/stores/site"
import { me, publicInfo } from "@/test/fixtures"

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
      totpDisable: vi.fn(),
      emailTwoFactorEnableSend: vi.fn(),
      emailTwoFactorEnable: vi.fn(),
      emailTwoFactorDisable: vi.fn()
    }
  }
})

const { meApi, authApi } = await import("@/lib/api")

function renderSettings() {
  return render(<SettingsPage />)
}

beforeEach(async () => {
  useAuthStore.setState({ user: me(), status: "ready" })
  vi.mocked(meApi.update).mockResolvedValue(me({ language: "en" }))
  vi.mocked(meApi.changePassword).mockResolvedValue({ success: true })
  vi.mocked(meApi.passkeys).mockResolvedValue({ items: [] })
})

describe("设置页", () => {
  it("切换语言即时生效并写回账号", async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByRole("tab", { name: /偏好|preferences/i }))
    await user.click(screen.getByRole("radio", { name: "English" }))

    await waitFor(() =>
      expect(meApi.update).toHaveBeenCalledWith({ language: "en" })
    )
    expect(document.documentElement.lang).toBe("en")
  })

  it("时区下拉只列常用时区", async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByRole("tab", { name: /偏好|preferences/i }))
    await user.click(screen.getByRole("combobox", { name: "时区" }))

    const options = await screen.findAllByRole("option")
    const labels = options.map((option) => option.textContent)
    expect(labels).toContain("Asia/Shanghai")
    expect(labels).toContain("America/New_York")
    expect(labels).not.toContain("America/Adak")
    expect(options.length).toBeLessThan(50)
  })

  it("已保存的时区不在常用列表时自动补到最前", async () => {
    useAuthStore.setState({
      user: me({ timezone: "America/Adak" }),
      status: "ready"
    })
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByRole("tab", { name: /偏好|preferences/i }))
    await user.click(screen.getByRole("combobox", { name: "时区" }))

    const options = await screen.findAllByRole("option")
    expect(options[0].textContent).toBe("America/Adak")
  })

  it("修改密码提交当前密码与新密码", async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByRole("tab", { name: /安全|security/i }))
    await user.type(screen.getByLabelText("当前密码"), "old-password")
    await user.type(screen.getByLabelText("新密码"), "brand-new-password")
    await user.type(screen.getByLabelText("确认新密码"), "brand-new-password")
    await user.click(screen.getByRole("button", { name: "更新密码" }))

    await waitFor(() =>
      expect(meApi.changePassword).toHaveBeenCalledWith({
        currentPassword: "old-password",
        newPassword: "brand-new-password"
      })
    )
  })

  it("标签只保留安全与偏好，默认选中安全", () => {
    renderSettings()
    const tabs = screen.getAllByRole("tab")
    expect(tabs.map((tab) => tab.textContent)).toEqual(["安全", "偏好"])
    expect(screen.getByRole("tab", { name: /安全|security/i })).toHaveAttribute(
      "data-state",
      "active"
    )
  })

  describe("邮箱验证码 2FA 设置", () => {
    it("未配邮件时不渲染启用控件，仅显示未配置", () => {
      useSiteStore.setState({
        info: publicInfo({ emailConfigured: false }),
        loaded: true
      })
      useAuthStore.setState({
        user: me({ emailTwoFactorEnabled: false }),
        status: "ready"
      })
      renderSettings()

      expect(screen.getByText(/邮件未配置|Not configured/i)).toBeInTheDocument()
      expect(
        screen.queryByRole("button", {
          name: /发送验证码|Send code|common.sendCode/i
        })
      ).not.toBeInTheDocument()
    })

    it("已配邮件且未开启时可发送验证码并确认启用", async () => {
      useSiteStore.setState({
        info: publicInfo({ emailConfigured: true }),
        loaded: true
      })
      useAuthStore.setState({
        user: me({ emailTwoFactorEnabled: false, totpEnabled: false }),
        status: "ready"
      })
      vi.mocked(authApi.emailTwoFactorEnableSend).mockResolvedValue({
        success: true
      })
      vi.mocked(authApi.emailTwoFactorEnable).mockResolvedValue({
        success: true
      })
      const user = userEvent.setup()
      renderSettings()

      await user.click(screen.getByRole("tab", { name: /安全|security/i }))
      // 发送验证码按钮（i18n key 缺失时回退为键名 /common.sendCode/i）
      const sendBtn = screen.getByRole("button", {
        name: /发送验证码|Send code|common.sendCode/i
      } as any)
      await user.click(sendBtn)
      expect(authApi.emailTwoFactorEnableSend).toHaveBeenCalledTimes(1)

      // 输入验证码并提交
      await user.type(
        screen.getByLabelText(/验证码|Verification code/),
        "123456"
      )
      await user.click(screen.getByRole("button", { name: /确认开启|Confirm/ }))
      expect(authApi.emailTwoFactorEnable).toHaveBeenCalledWith("123456")
    })

    it("已开启时提交关闭密码可停用", async () => {
      useSiteStore.setState({
        info: publicInfo({ emailConfigured: true }),
        loaded: true
      })
      useAuthStore.setState({
        user: me({ emailTwoFactorEnabled: true, totpEnabled: false }),
        status: "ready"
      })
      vi.mocked(authApi.emailTwoFactorDisable).mockResolvedValue({
        success: true
      })
      const user = userEvent.setup()
      renderSettings()

      await user.click(screen.getByRole("tab", { name: /安全|security/i }))
      // 邮箱禁用表单的密码框有唯一 id
      const pwInput = screen.getByLabelText(/当前密码|Current password/i, {
        selector: "#email-disable-password"
      })
      await user.type(pwInput, "current-pw")
      await user.click(screen.getByRole("button", { name: /关闭|Close/i }))
      expect(authApi.emailTwoFactorDisable).toHaveBeenCalledWith("current-pw")
    })
  })
})

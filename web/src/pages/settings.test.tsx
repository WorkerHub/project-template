import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { changeLanguage } from "@/i18n"
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
      emailTwoFactorDisable: vi.fn(),
      passkeyRegisterOptions: vi.fn(),
      passkeyRegisterVerify: vi.fn()
    }
  }
})

vi.mock("@/lib/webauthn", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/webauthn")>()
  return {
    ...actual,
    webauthnSupported: vi.fn(() => true),
    registrationCredential: vi.fn(async () => ({}) as never)
  }
})

const { ApiError, meApi, authApi } = await import("@/lib/api")
const { webauthnSupported } = await import("@/lib/webauthn")

function renderSettings() {
  return render(<SettingsPage />)
}

beforeEach(async () => {
  useAuthStore.setState({ user: me(), status: "ready" })
  useSiteStore.setState({
    info: publicInfo({ emailConfigured: true }),
    loaded: true
  })
  vi.mocked(meApi.update).mockImplementation(async (input) => me(input))
  vi.mocked(meApi.changePassword).mockResolvedValue({ success: true })
  vi.mocked(meApi.passkeys).mockResolvedValue({ items: [] })
  vi.mocked(webauthnSupported).mockReturnValue(true)
  await changeLanguage("zh")
})

describe("设置页", () => {
  it("偏好设置无改动时保存按钮禁用", async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByRole("tab", { name: /偏好|preferences/i }))
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled()
  })

  it("偏好设置语言先选后存：未保存不写回，保存后统一写回并即时生效", async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByRole("tab", { name: /偏好|preferences/i }))
    const saveButton = screen.getByRole("button", { name: "保存" })
    expect(saveButton).toBeDisabled()

    await user.click(screen.getByRole("combobox", { name: "界面语言" }))
    await user.click(await screen.findByRole("option", { name: "English" }))

    expect(saveButton).not.toBeDisabled()
    expect(meApi.update).not.toHaveBeenCalled()
    expect(document.documentElement.lang).toBe("zh")

    await user.click(saveButton)

    await waitFor(() =>
      expect(meApi.update).toHaveBeenCalledWith({
        language: "en",
        timezone: "Asia/Shanghai"
      })
    )
    expect(document.documentElement.lang).toBe("en")
    expect(saveButton).toBeDisabled()
  })

  it("偏好设置保存失败时展示错误提示且语言不生效", async () => {
    vi.mocked(meApi.update).mockRejectedValueOnce(new Error("网络异常"))
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByRole("tab", { name: /偏好|preferences/i }))
    await user.click(screen.getByRole("combobox", { name: "界面语言" }))
    await user.click(await screen.findByRole("option", { name: "English" }))

    await user.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument())
    expect(document.documentElement.lang).toBe("zh")
  })

  it("偏好设置时区先选后存：修改时区后统一提交", async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByRole("tab", { name: /偏好|preferences/i }))
    const saveButton = screen.getByRole("button", { name: "保存" })
    expect(saveButton).toBeDisabled()

    await user.click(screen.getByRole("combobox", { name: "时区" }))
    await user.click(
      await screen.findByRole("option", { name: "America/New_York" })
    )

    expect(saveButton).not.toBeDisabled()
    await user.click(saveButton)

    await waitFor(() =>
      expect(meApi.update).toHaveBeenCalledWith({
        language: "zh",
        timezone: "America/New_York"
      })
    )
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

  describe("两步验证合并区（验证器应用 + 邮箱验证码）", () => {
    it("合并展示两行状态与动作：未开启状态均显示未开启与开启按钮", async () => {
      useAuthStore.setState({
        user: me({ totpEnabled: false, emailTwoFactorEnabled: false }),
        status: "ready"
      })
      renderSettings()

      const twoFactorSection = screen
        .getByRole("heading", { name: "两步验证" })
        .closest("section")
      expect(twoFactorSection).toBeInTheDocument()

      const withinSection = within(twoFactorSection!)
      expect(withinSection.getByText("验证器应用")).toBeInTheDocument()
      expect(withinSection.getByText("邮箱验证码")).toBeInTheDocument()

      const disabledTexts = withinSection.getAllByText("未开启")
      expect(disabledTexts).toHaveLength(2)

      const enableButtons = withinSection.getAllByRole("button", {
        name: "开启"
      })
      expect(enableButtons).toHaveLength(2)
    })

    it("未配邮件时不渲染邮箱启用控件，显示邮件未配置", () => {
      useSiteStore.setState({
        info: publicInfo({ emailConfigured: false }),
        loaded: true
      })
      useAuthStore.setState({
        user: me({ totpEnabled: false, emailTwoFactorEnabled: false }),
        status: "ready"
      })
      renderSettings()

      const twoFactorSection = screen
        .getByRole("heading", { name: "两步验证" })
        .closest("section")
      const withinSection = within(twoFactorSection!)
      expect(withinSection.getByText("邮件未配置")).toBeInTheDocument()
      expect(
        withinSection.queryByRole("button", { name: "开启" })
      ).toBeInTheDocument() // 仅验证器应用的开启按钮
    })

    it("开启验证器应用流程：点击开启从行尾进，展开扫码并完成确认", async () => {
      useAuthStore.setState({
        user: me({ totpEnabled: false }),
        status: "ready"
      })
      vi.mocked(authApi.totpSetup).mockResolvedValue({
        secret: "TESTSECRET123",
        otpauthUrl: "otpauth://totp/test"
      })
      vi.mocked(authApi.totpEnable).mockResolvedValue({ success: true })

      const user = userEvent.setup()
      renderSettings()

      const twoFactorSection = screen
        .getByRole("heading", { name: "两步验证" })
        .closest("section")
      const withinSection = within(twoFactorSection!)

      const enableButtons = withinSection.getAllByRole("button", {
        name: "开启"
      })
      await user.click(enableButtons[0]) // 点击验证器应用的开启
      expect(authApi.totpSetup).toHaveBeenCalledTimes(1)

      expect(await screen.findByText("TESTSECRET123")).toBeInTheDocument()
      const codeInput = screen.getByLabelText("验证码")
      await user.type(codeInput, "654321")
      await user.click(screen.getByRole("button", { name: "确认开启" }))

      expect(authApi.totpEnable).toHaveBeenCalledWith("654321")
    })

    it("开启邮箱验证码流程：点击开启从行尾进，发送验证码并完成确认", async () => {
      useAuthStore.setState({
        user: me({ emailTwoFactorEnabled: false }),
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

      const twoFactorSection = screen
        .getByRole("heading", { name: "两步验证" })
        .closest("section")
      const withinSection = within(twoFactorSection!)

      const enableButtons = withinSection.getAllByRole("button", {
        name: "开启"
      })
      await user.click(enableButtons[1]) // 点击邮箱验证码的开启
      expect(authApi.emailTwoFactorEnableSend).toHaveBeenCalledTimes(1)

      const codeInput = await screen.findByLabelText("验证码")
      await user.type(codeInput, "123456")
      await user.click(screen.getByRole("button", { name: "确认开启" }))

      expect(authApi.emailTwoFactorEnable).toHaveBeenCalledWith("123456")
    })

    it("开启验证器应用失败时错误可见且不展开扫码", async () => {
      useAuthStore.setState({
        user: me({ totpEnabled: false }),
        status: "ready"
      })
      vi.mocked(authApi.totpSetup).mockRejectedValueOnce(
        new ApiError({
          status: 400,
          message: "Generic error",
          code: "FORBIDDEN"
        })
      )

      const user = userEvent.setup()
      renderSettings()

      const twoFactorSection = screen
        .getByRole("heading", { name: "两步验证" })
        .closest("section")
      const withinSection = within(twoFactorSection!)

      const enableButtons = withinSection.getAllByRole("button", {
        name: "开启"
      })
      await user.click(enableButtons[0])

      expect(authApi.totpSetup).toHaveBeenCalledTimes(1)
      expect(await withinSection.findByRole("alert")).toBeInTheDocument()
      expect(withinSection.queryByLabelText("验证码")).not.toBeInTheDocument()
    })

    it("发送邮箱验证码失败时错误可见且冷却倒计时正常触发", async () => {
      useAuthStore.setState({
        user: me({ emailTwoFactorEnabled: false }),
        status: "ready"
      })
      vi.mocked(authApi.emailTwoFactorEnableSend).mockRejectedValueOnce(
        new ApiError({
          status: 429,
          message: "Rate limited",
          code: "RATE_LIMITED",
          retryAfter: 30
        })
      )

      const user = userEvent.setup()
      renderSettings()

      const twoFactorSection = screen
        .getByRole("heading", { name: "两步验证" })
        .closest("section")
      const withinSection = within(twoFactorSection!)

      const enableButtons = withinSection.getAllByRole("button", {
        name: "开启"
      })
      await user.click(enableButtons[1])

      expect(authApi.emailTwoFactorEnableSend).toHaveBeenCalledTimes(1)
      expect(await withinSection.findByRole("alert")).toBeInTheDocument()
      expect(withinSection.queryByLabelText("验证码")).not.toBeInTheDocument()
      // 检查按钮显示倒计时
      expect(
        withinSection.getByRole("button", { name: /30 秒后可重发/i })
      ).toBeDisabled()
    })
  })

  describe("敏感操作密码确认弹窗流", () => {
    it("页面上不常驻当前密码框；点击关闭动作出弹窗、输错密码报错留在弹窗内、输对密码完成动作", async () => {
      useAuthStore.setState({
        user: me({ totpEnabled: true, emailTwoFactorEnabled: true }),
        status: "ready"
      })
      vi.mocked(authApi.totpDisable).mockRejectedValueOnce(
        new ApiError({
          status: 400,
          message: "Password incorrect",
          code: "PASSWORD_INCORRECT"
        })
      )
      vi.mocked(authApi.totpDisable).mockResolvedValueOnce({ success: true })

      const user = userEvent.setup()
      renderSettings()

      // 验证页面上没有常驻的敏感操作密码框（全文仅修改密码表单本身持有 1 个当前密码输入框）
      expect(screen.getAllByLabelText("当前密码")).toHaveLength(1)

      const twoFactorSection = screen
        .getByRole("heading", { name: "两步验证" })
        .closest("section")
      const withinSection = within(twoFactorSection!)
      const closeButtons = withinSection.getAllByRole("button", {
        name: "关闭"
      })

      // 1. 点动作出弹窗
      await user.click(closeButtons[0]) // 点击关闭 TOTP
      const dialog = await screen.findByRole("dialog")
      expect(dialog).toBeInTheDocument()
      expect(within(dialog).getByText("安全验证")).toBeInTheDocument()

      // 2. 输错密码报错留在弹窗内
      const passwordInput = within(dialog).getByLabelText("当前密码")
      await user.type(passwordInput, "wrong-password")
      await user.click(within(dialog).getByRole("button", { name: "确定" }))

      await waitFor(() => {
        expect(authApi.totpDisable).toHaveBeenCalledWith("wrong-password")
      })
      // 弹窗未关闭，报错在弹窗内
      expect(screen.getByRole("dialog")).toBeInTheDocument()
      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        "当前密码不正确"
      )

      // 3. 输对密码动作完成
      await user.clear(passwordInput)
      await user.type(passwordInput, "correct-password")
      await user.click(within(dialog).getByRole("button", { name: "确定" }))

      await waitFor(() => {
        expect(authApi.totpDisable).toHaveBeenCalledWith("correct-password")
      })
      // 动作完成，弹窗关闭
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      })
    })

    it("关闭邮箱验证码动作同样触发弹窗验证流", async () => {
      useAuthStore.setState({
        user: me({ totpEnabled: false, emailTwoFactorEnabled: true }),
        status: "ready"
      })
      vi.mocked(authApi.emailTwoFactorDisable).mockResolvedValue({
        success: true
      })

      const user = userEvent.setup()
      renderSettings()

      const twoFactorSection = screen
        .getByRole("heading", { name: "两步验证" })
        .closest("section")
      const withinSection = within(twoFactorSection!)
      await user.click(withinSection.getByRole("button", { name: "关闭" }))

      const dialog = await screen.findByRole("dialog")
      await user.type(within(dialog).getByLabelText("当前密码"), "my-password")
      await user.click(within(dialog).getByRole("button", { name: "确定" }))

      await waitFor(() => {
        expect(authApi.emailTwoFactorDisable).toHaveBeenCalledWith(
          "my-password"
        )
      })
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      })
    })

    it("取消或关闭弹窗不产生任何请求", async () => {
      useAuthStore.setState({
        user: me({ totpEnabled: true }),
        status: "ready"
      })
      const user = userEvent.setup()
      renderSettings()

      const twoFactorSection = screen
        .getByRole("heading", { name: "两步验证" })
        .closest("section")
      await user.click(
        within(twoFactorSection!).getByRole("button", { name: "关闭" })
      )

      const dialog = await screen.findByRole("dialog")
      await user.type(within(dialog).getByLabelText("当前密码"), "my-password")
      await user.click(within(dialog).getByRole("button", { name: "取消" }))

      expect(authApi.totpDisable).not.toHaveBeenCalled()
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      })
    })
  })

  describe("Passkey 区（通行密钥）", () => {
    it("标题显示为通行密钥，每行显示添加于与最近使用，为空时显示从未使用", async () => {
      vi.mocked(meApi.passkeys).mockResolvedValue({
        items: [
          {
            id: 1,
            createdAt: "2026-11-01T08:00:00Z",
            lastUsedAt: null
          },
          {
            id: 2,
            createdAt: "2026-11-02T08:00:00Z",
            lastUsedAt: "2026-11-15T08:00:00Z"
          }
        ]
      })

      renderSettings()

      // 验证中文标题为「通行密钥」
      expect(
        screen.getByRole("heading", { name: "通行密钥" })
      ).toBeInTheDocument()

      // id: 1: lastUsedAt 为空 -> 显示「从未使用」
      expect(await screen.findByText("从未使用")).toBeInTheDocument()

      // id: 2: lastUsedAt 有值 -> 显示「最近使用」
      expect(screen.getByText(/最近使用/)).toBeInTheDocument()
    })

    it("删除 Passkey 走密码确认弹窗", async () => {
      vi.mocked(meApi.passkeys).mockResolvedValue({
        items: [
          {
            id: 1,
            createdAt: "2026-11-01T08:00:00Z",
            lastUsedAt: null
          }
        ]
      })
      vi.mocked(meApi.deletePasskey).mockResolvedValue({ success: true })

      const user = userEvent.setup()
      renderSettings()

      const deleteBtn = await screen.findByRole("button", { name: "删除" })
      await user.click(deleteBtn)

      const dialog = await screen.findByRole("dialog")
      expect(dialog).toBeInTheDocument()

      await user.type(within(dialog).getByLabelText("当前密码"), "pass-123")
      await user.click(within(dialog).getByRole("button", { name: "确定" }))

      await waitFor(() => {
        expect(meApi.deletePasskey).toHaveBeenCalledWith(1, "pass-123")
      })
    })

    it("添加 Passkey 走密码确认弹窗", async () => {
      vi.mocked(authApi.passkeyRegisterOptions).mockResolvedValue({} as never)
      vi.mocked(authApi.passkeyRegisterVerify).mockResolvedValue({
        success: true
      })

      const user = userEvent.setup()
      renderSettings()

      const addBtn = await screen.findByRole("button", {
        name: "添加 Passkey"
      })
      await user.click(addBtn)

      const dialog = await screen.findByRole("dialog")
      expect(dialog).toBeInTheDocument()

      await user.type(within(dialog).getByLabelText("当前密码"), "pass-123")
      await user.click(within(dialog).getByRole("button", { name: "确定" }))

      await waitFor(() => {
        expect(authApi.passkeyRegisterOptions).toHaveBeenCalledWith("pass-123")
        expect(authApi.passkeyRegisterVerify).toHaveBeenCalled()
      })
    })
  })
})

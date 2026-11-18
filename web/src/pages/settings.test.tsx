import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  createMemoryRouter,
  Navigate,
  type RouteObject,
  RouterProvider
} from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api"
import { SettingsPage } from "@/pages/settings"
import { PreferencesSection } from "@/pages/settings/preferences-section"
import { SecuritySection } from "@/pages/settings/security-section"
import { useAuthStore } from "@/stores/auth"
import { useSiteStore } from "@/stores/site"
import { me, publicInfo } from "@/test/fixtures"

vi.mock("@/lib/webauthn", () => ({
  webauthnSupported: vi.fn(() => true),
  registrationCredential: vi.fn().mockResolvedValue({ id: "mock-credential" }),
  isWebAuthnCancelled: vi.fn(() => false)
}))

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

const { meApi, authApi } = await import("@/lib/api")

const settingsRoutes: RouteObject[] = [
  {
    path: "/settings",
    element: <SettingsPage />,
    children: [
      { index: true, element: <Navigate to="/settings/security" replace /> },
      { path: "security", element: <SecuritySection /> },
      { path: "preferences", element: <PreferencesSection /> },
      { path: "*", element: <Navigate to="/settings/security" replace /> }
    ]
  }
]

function renderSettings(initialPath = "/settings/security") {
  const router = createMemoryRouter(settingsRoutes, {
    initialEntries: [initialPath]
  })
  return render(<RouterProvider router={router} />)
}

beforeEach(async () => {
  document.documentElement.lang = "zh"
  useSiteStore.setState({
    info: publicInfo({ emailConfigured: true }),
    loaded: true
  })
  useAuthStore.setState({
    user: me({ emailTwoFactorEnabled: false, totpEnabled: false }),
    status: "ready"
  })
  vi.mocked(meApi.update).mockResolvedValue(me({ language: "en" }))
  vi.mocked(meApi.changePassword).mockResolvedValue({ success: true })
  vi.mocked(meApi.passkeys).mockResolvedValue({ items: [] })
  vi.mocked(authApi.totpSetup).mockResolvedValue({
    secret: "MOCKSECRET",
    otpauthUrl: "otpauth://totp/app:user@example.com?secret=MOCKSECRET"
  })
  vi.mocked(authApi.totpEnable).mockResolvedValue({ success: true })
  vi.mocked(authApi.totpDisable).mockResolvedValue({ success: true })
  vi.mocked(authApi.emailTwoFactorEnableSend).mockResolvedValue({
    success: true
  })
  vi.mocked(authApi.emailTwoFactorEnable).mockResolvedValue({ success: true })
  vi.mocked(authApi.emailTwoFactorDisable).mockResolvedValue({ success: true })
  vi.mocked(authApi.passkeyRegisterOptions).mockResolvedValue({
    challenge: "test-challenge"
  } as never)
  vi.mocked(authApi.passkeyRegisterVerify).mockResolvedValue({ success: true })
  vi.mocked(meApi.deletePasskey).mockResolvedValue({ success: true })
})

describe("设置页", () => {
  it("偏好无改动时保存按钮禁用，修改语言后点击保存统一写回并即时生效", async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByRole("tab", { name: /偏好|preferences/i }))

    const saveButton = screen.getByRole("button", { name: /保存|save/i })
    expect(saveButton).toBeDisabled()

    await user.click(
      screen.getByRole("combobox", { name: /界面语言|language/i })
    )
    await user.click(await screen.findByRole("option", { name: "English" }))

    expect(saveButton).toBeEnabled()
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

  it("偏好保存失败时展示错误提示且不变更语言", async () => {
    vi.mocked(meApi.update).mockRejectedValueOnce(new Error("network error"))
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByRole("tab", { name: /偏好|preferences/i }))

    await user.click(
      screen.getByRole("combobox", { name: /界面语言|language/i })
    )
    await user.click(await screen.findByRole("option", { name: "English" }))

    const saveButton = screen.getByRole("button", { name: /保存|save/i })
    await user.click(saveButton)

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument())
    expect(document.documentElement.lang).toBe("zh")
  })

  it("修改时区后启用保存，点击保存统一提交", async () => {
    vi.mocked(meApi.update).mockResolvedValue(
      me({ language: "zh", timezone: "America/New_York" })
    )
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByRole("tab", { name: /偏好|preferences/i }))

    const saveButton = screen.getByRole("button", { name: /保存|save/i })
    expect(saveButton).toBeDisabled()

    await user.click(screen.getByRole("combobox", { name: "时区" }))
    await user.click(
      await screen.findByRole("option", { name: "America/New_York" })
    )

    expect(saveButton).toBeEnabled()
    await user.click(saveButton)

    await waitFor(() =>
      expect(meApi.update).toHaveBeenCalledWith({
        language: "zh",
        timezone: "America/New_York"
      })
    )
    expect(saveButton).toBeDisabled()
  })

  it("未保存离开偏好页不生效也不调用写回", async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByRole("tab", { name: /偏好|preferences/i }))

    await user.click(
      screen.getByRole("combobox", { name: /界面语言|language/i })
    )
    await user.click(await screen.findByRole("option", { name: "English" }))

    await user.click(screen.getByRole("tab", { name: /安全|security/i }))

    expect(meApi.update).not.toHaveBeenCalled()
    expect(document.documentElement.lang).toBe("zh")
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

  describe("两步验证合并与行状态", () => {
    it("合并为一个「两步验证」区，包含验证器应用与邮箱验证码两行及其状态", () => {
      renderSettings()
      expect(
        screen.getByRole("heading", { name: "两步验证" })
      ).toBeInTheDocument()

      const totpRow = screen.getByTestId("totp-row")
      expect(within(totpRow).getByText("验证器应用")).toBeInTheDocument()
      expect(within(totpRow).getByText("未开启")).toBeInTheDocument()
      expect(
        within(totpRow).getByRole("button", { name: "开启" })
      ).toBeInTheDocument()

      const emailRow = screen.getByTestId("email-row")
      expect(within(emailRow).getByText("邮箱验证码")).toBeInTheDocument()
      expect(within(emailRow).getByText("未开启")).toBeInTheDocument()
      expect(
        within(emailRow).getByRole("button", { name: "开启" })
      ).toBeInTheDocument()
    })

    it("验证器应用未开启时点击开启展示既有扫码流程，输入验证码后确认启用", async () => {
      const user = userEvent.setup()
      renderSettings()

      const totpRow = screen.getByTestId("totp-row")
      await user.click(within(totpRow).getByRole("button", { name: "开启" }))

      expect(authApi.totpSetup).toHaveBeenCalledTimes(1)
      expect(await screen.findByText("用验证器扫描二维码")).toBeInTheDocument()
      expect(screen.getByText("MOCKSECRET")).toBeInTheDocument()

      await user.type(screen.getByLabelText("验证码"), "123456")
      await user.click(screen.getByRole("button", { name: "确认开启" }))

      expect(authApi.totpEnable).toHaveBeenCalledWith("123456")
    })

    it("邮箱验证码未配置时显示邮件未配置且无开启按钮", () => {
      useSiteStore.setState({
        info: publicInfo({ emailConfigured: false }),
        loaded: true
      })
      renderSettings()

      const emailRow = screen.getByTestId("email-row")
      expect(within(emailRow).getByText("邮件未配置")).toBeInTheDocument()
      expect(within(emailRow).queryByRole("button")).not.toBeInTheDocument()
    })

    it("邮箱验证码已配置且未开启时点击开启发送验证码并确认启用", async () => {
      const user = userEvent.setup()
      renderSettings()

      const emailRow = screen.getByTestId("email-row")
      await user.click(within(emailRow).getByRole("button", { name: "开启" }))

      expect(authApi.emailTwoFactorEnableSend).toHaveBeenCalledTimes(1)
      await user.type(screen.getByLabelText(/验证码/), "654321")
      await user.click(screen.getByRole("button", { name: "确认开启" }))

      expect(authApi.emailTwoFactorEnable).toHaveBeenCalledWith("654321")
    })
  })

  describe("敏感操作密码验证弹窗流", () => {
    it("页面上不常驻敏感操作的当前密码输入框", () => {
      renderSettings()
      expect(
        document.querySelector("#totp-disable-password")
      ).not.toBeInTheDocument()
      expect(
        document.querySelector("#email-disable-password")
      ).not.toBeInTheDocument()
      expect(
        document.querySelector("#passkey-add-password")
      ).not.toBeInTheDocument()
      expect(
        document.querySelector("#passkey-delete-password")
      ).not.toBeInTheDocument()
    })

    it("关闭 TOTP 弹窗验证流：点动作出弹窗、错密码报错留在弹窗内、对密码动作完成", async () => {
      useAuthStore.setState({
        user: me({ totpEnabled: true, emailTwoFactorEnabled: false }),
        status: "ready"
      })
      vi.mocked(authApi.totpDisable).mockRejectedValueOnce(
        new ApiError({
          status: 400,
          code: "PASSWORD_INCORRECT",
          message: "当前密码不正确"
        })
      )
      vi.mocked(authApi.totpDisable).mockResolvedValueOnce({ success: true })

      const user = userEvent.setup()
      renderSettings()

      const totpRow = screen.getByTestId("totp-row")
      expect(within(totpRow).getByText("已开启")).toBeInTheDocument()
      const disableBtn = within(totpRow).getByRole("button", { name: "关闭" })
      expect(disableBtn).toHaveAttribute("data-variant", "destructive")

      // 1. 点动作出弹窗
      await user.click(disableBtn)
      const dialog = screen.getByRole("dialog")
      expect(dialog).toBeInTheDocument()

      const passwordInput = within(dialog).getByLabelText("当前密码")
      const confirmBtn = within(dialog).getByRole("button", { name: "确定" })

      // 2. 错密码报错留在弹窗内
      await user.type(passwordInput, "wrong-password")
      await user.click(confirmBtn)
      expect(authApi.totpDisable).toHaveBeenCalledWith("wrong-password")
      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        "当前密码不正确"
      )
      expect(dialog).toBeInTheDocument()

      // 3. 对密码动作完成并关弹窗
      await user.clear(passwordInput)
      await user.type(passwordInput, "correct-password")
      await user.click(confirmBtn)
      expect(authApi.totpDisable).toHaveBeenCalledWith("correct-password")
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      )
    })

    it("关闭邮箱验证码弹窗验证流：点动作出弹窗、错密码报错留在弹窗、对密码动作完成", async () => {
      useAuthStore.setState({
        user: me({ emailTwoFactorEnabled: true, totpEnabled: false }),
        status: "ready"
      })
      vi.mocked(authApi.emailTwoFactorDisable).mockRejectedValueOnce(
        new ApiError({
          status: 400,
          code: "PASSWORD_INCORRECT",
          message: "当前密码不正确"
        })
      )
      vi.mocked(authApi.emailTwoFactorDisable).mockResolvedValueOnce({
        success: true
      })

      const user = userEvent.setup()
      renderSettings()

      const emailRow = screen.getByTestId("email-row")
      expect(within(emailRow).getByText("已开启")).toBeInTheDocument()
      const disableBtn = within(emailRow).getByRole("button", { name: "关闭" })
      expect(disableBtn).toHaveAttribute("data-variant", "destructive")

      await user.click(disableBtn)
      const dialog = screen.getByRole("dialog")

      const passwordInput = within(dialog).getByLabelText("当前密码")
      const confirmBtn = within(dialog).getByRole("button", { name: "确定" })

      await user.type(passwordInput, "wrong-password")
      await user.click(confirmBtn)
      expect(authApi.emailTwoFactorDisable).toHaveBeenCalledWith(
        "wrong-password"
      )
      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        "当前密码不正确"
      )

      await user.clear(passwordInput)
      await user.type(passwordInput, "correct-password")
      await user.click(confirmBtn)
      expect(authApi.emailTwoFactorDisable).toHaveBeenCalledWith(
        "correct-password"
      )
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      )
    })

    it("取消或关闭弹窗不产生任何请求与效果", async () => {
      useAuthStore.setState({
        user: me({ totpEnabled: true }),
        status: "ready"
      })
      const user = userEvent.setup()
      renderSettings()

      const totpRow = screen.getByTestId("totp-row")
      await user.click(within(totpRow).getByRole("button", { name: "关闭" }))

      const dialog = screen.getByRole("dialog")
      expect(dialog).toBeInTheDocument()

      await user.click(within(dialog).getByRole("button", { name: "取消" }))
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      )

      expect(authApi.totpDisable).not.toHaveBeenCalled()
    })
  })

  describe("通行密钥（Passkey）管理", () => {
    it("中文标题显示为「通行密钥」", () => {
      renderSettings()
      expect(
        screen.getByRole("heading", { name: "通行密钥" })
      ).toBeInTheDocument()
    })

    it("凭据列表显示添加于与最近使用，最近使用为空时显示「从未使用」", async () => {
      vi.mocked(meApi.passkeys).mockResolvedValue({
        items: [
          {
            id: 1,
            createdAt: "2026-01-01T00:00:00Z",
            lastUsedAt: "2026-01-02T00:00:00Z"
          },
          {
            id: 2,
            createdAt: "2026-01-01T00:00:00Z",
            lastUsedAt: null
          }
        ]
      })

      renderSettings()

      await waitFor(() => {
        expect(screen.getByText(/最近使用/)).toBeInTheDocument()
      })
      expect(screen.getByText("从未使用")).toBeInTheDocument()
    })

    it("删除 Passkey 走密码确认弹窗，错密码报错留在弹窗，对密码完成删除", async () => {
      vi.mocked(meApi.passkeys).mockResolvedValue({
        items: [
          {
            id: 1,
            createdAt: "2026-01-01T00:00:00Z",
            lastUsedAt: null
          }
        ]
      })
      vi.mocked(meApi.deletePasskey).mockRejectedValueOnce(
        new ApiError({
          status: 400,
          code: "PASSWORD_INCORRECT",
          message: "当前密码不正确"
        })
      )
      vi.mocked(meApi.deletePasskey).mockResolvedValueOnce({ success: true })

      const user = userEvent.setup()
      renderSettings()

      await screen.findByText("从未使用")

      const deleteBtn = screen.getByRole("button", { name: "删除" })
      expect(deleteBtn).toHaveAttribute("data-variant", "destructive")

      await user.click(deleteBtn)
      const dialog = screen.getByRole("dialog")
      const passwordInput = within(dialog).getByLabelText("当前密码")
      const confirmBtn = within(dialog).getByRole("button", { name: "确定" })

      await user.type(passwordInput, "wrong-password")
      await user.click(confirmBtn)
      expect(meApi.deletePasskey).toHaveBeenCalledWith(1, "wrong-password")
      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        "当前密码不正确"
      )

      await user.clear(passwordInput)
      await user.type(passwordInput, "correct-password")
      await user.click(confirmBtn)
      expect(meApi.deletePasskey).toHaveBeenCalledWith(1, "correct-password")
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      )
    })

    it("添加 Passkey 走密码确认弹窗，错密码报错留在弹窗，对密码完成添加", async () => {
      vi.mocked(authApi.passkeyRegisterOptions).mockRejectedValueOnce(
        new ApiError({
          status: 400,
          code: "PASSWORD_INCORRECT",
          message: "当前密码不正确"
        })
      )
      vi.mocked(authApi.passkeyRegisterOptions).mockResolvedValueOnce({
        challenge: "test-challenge"
      } as never)

      const user = userEvent.setup()
      renderSettings()

      const addBtn = screen.getByRole("button", { name: "添加 Passkey" })
      expect(addBtn).toHaveAttribute("data-variant", "outline")

      await user.click(addBtn)
      const dialog = screen.getByRole("dialog")
      const passwordInput = within(dialog).getByLabelText("当前密码")
      const confirmBtn = within(dialog).getByRole("button", { name: "确定" })

      await user.type(passwordInput, "wrong-password")
      await user.click(confirmBtn)
      expect(authApi.passkeyRegisterOptions).toHaveBeenCalledWith(
        "wrong-password"
      )
      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        "当前密码不正确"
      )

      await user.clear(passwordInput)
      await user.type(passwordInput, "correct-password")
      await user.click(confirmBtn)
      expect(authApi.passkeyRegisterOptions).toHaveBeenCalledWith(
        "correct-password"
      )
      expect(authApi.passkeyRegisterVerify).toHaveBeenCalled()
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      )
    })
  })

  describe("Tab 独立路由与未保存拦截", () => {
    it("支持两 tab URL 直达、裸路径重定向与未知子路径重定向", async () => {
      // 1. 直达 /settings/security
      const { unmount: unmount1 } = renderSettings("/settings/security")
      expect(
        await screen.findByRole("heading", { name: "两步验证" })
      ).toBeInTheDocument()
      unmount1()

      // 2. 直达 /settings/preferences
      const { unmount: unmount2 } = renderSettings("/settings/preferences")
      expect(
        await screen.findByRole("combobox", { name: /界面语言|language/i })
      ).toBeInTheDocument()
      unmount2()

      // 3. 裸路径 /settings 自动重定向至首 tab /settings/security
      const { unmount: unmount3 } = renderSettings("/settings")
      expect(
        await screen.findByRole("heading", { name: "两步验证" })
      ).toBeInTheDocument()
      unmount3()

      // 4. 未知子路径 /settings/invalid 自动重定向至首 tab /settings/security
      renderSettings("/settings/invalid")
      expect(
        await screen.findByRole("heading", { name: "两步验证" })
      ).toBeInTheDocument()
    })

    it("偏好表单有脏改动时切换 Tab 触发拦截，可选择留在本页或放弃修改", async () => {
      const user = userEvent.setup()
      renderSettings("/settings/preferences")

      // 修改语言（此时 isDirty 变 true）
      await user.click(
        await screen.findByRole("combobox", { name: /界面语言|language/i })
      )
      await user.click(await screen.findByRole("option", { name: "English" }))

      // 尝试切换到「安全」Tab
      await user.click(screen.getByRole("tab", { name: /安全|security/i }))

      // 弹出未保存修改对话框
      const dialog = await screen.findByRole("dialog")
      expect(dialog).toHaveTextContent("未保存的修改")
      expect(dialog).toHaveTextContent(
        "当前有未保存的修改，离开将丢失内容，是否继续？"
      )

      // 点击「留在本页」
      await user.click(within(dialog).getByRole("button", { name: "留在本页" }))
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      })
      // 仍在偏好页，保存按钮依然处于 dirty 可用态
      expect(screen.getByRole("button", { name: /保存|save/i })).toBeEnabled()
      expect(
        screen.queryByRole("heading", { name: "两步验证" })
      ).not.toBeInTheDocument()

      // 再次尝试切换并点击「放弃修改」
      await user.click(screen.getByRole("tab", { name: /安全|security/i }))
      const discardDialog = await screen.findByRole("dialog")
      await user.click(
        within(discardDialog).getByRole("button", { name: "放弃修改" })
      )

      // 成功切到「安全」
      expect(
        await screen.findByRole("heading", { name: "两步验证" })
      ).toBeInTheDocument()
    })

    it("安全页改密表单有已填内容时切换 Tab 拦截，留存 vs 放弃正常工作", async () => {
      const user = userEvent.setup()
      renderSettings("/settings/security")

      const newPasswordInput = await screen.findByLabelText("新密码")
      await user.type(newPasswordInput, "draft-new-pass")

      // 尝试切换到「偏好」Tab
      await user.click(screen.getByRole("tab", { name: /偏好|preferences/i }))

      // 弹出未保存拦截弹窗
      const dialog = await screen.findByRole("dialog")
      expect(dialog).toHaveTextContent("未保存的修改")

      // 点击「留在本页」
      await user.click(within(dialog).getByRole("button", { name: "留在本页" }))
      expect(screen.getByLabelText("新密码")).toHaveValue("draft-new-pass")
      expect(
        screen.queryByRole("combobox", { name: /界面语言|language/i })
      ).not.toBeInTheDocument()

      // 再次尝试切换并选择「放弃修改」
      await user.click(screen.getByRole("tab", { name: /偏好|preferences/i }))
      const discardDialog = await screen.findByRole("dialog")
      await user.click(
        within(discardDialog).getByRole("button", { name: "放弃修改" })
      )

      // 成功切换至偏好页
      expect(
        await screen.findByRole("combobox", { name: /界面语言|language/i })
      ).toBeInTheDocument()
    })
  })
})

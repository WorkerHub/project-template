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
import {
  adminCreatedUser,
  adminSettings,
  adminUser,
  me,
  PROJECT_NAME
} from "@/test/fixtures"
import { AdminPage, AdminUsersTab } from "@/pages/admin/admin-page"
import { EmailSection } from "@/pages/admin/email-section"
import { OthersSection } from "@/pages/admin/others-section"
import { RegistrationSection } from "@/pages/admin/registration-section"
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
      createUser: vi.fn(),
      users: vi.fn(),
      approveUser: vi.fn(),
      rejectUser: vi.fn(),
      resetUserPassword: vi.fn(),
      disableUser: vi.fn(),
      enableUser: vi.fn(),
      changeUserRole: vi.fn(),
      deleteUser: vi.fn()
    },
    meApi: { ...actual.meApi, get: vi.fn(), update: vi.fn() }
  }
})

const { adminApi } = await import("@/lib/api")

const adminRoutes: RouteObject[] = [
  {
    path: "/admin",
    element: <AdminPage />,
    children: [
      { index: true, element: <Navigate to="/admin/email" replace /> },
      { path: "email", element: <EmailSection /> },
      { path: "registration", element: <RegistrationSection /> },
      { path: "users", element: <AdminUsersTab /> },
      { path: "others", element: <OthersSection /> },
      { path: "*", element: <Navigate to="/admin/email" replace /> }
    ]
  }
]

function renderAdmin(initialPath = "/admin/email") {
  const router = createMemoryRouter(adminRoutes, {
    initialEntries: [initialPath]
  })
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  useAuthStore.setState({ user: me(), status: "ready" })
  vi.mocked(adminApi.users).mockResolvedValue({ items: [] })
  vi.mocked(adminApi.createUser).mockReset()
  vi.mocked(adminApi.resetUserPassword).mockReset()
  vi.mocked(adminApi.disableUser).mockReset()
  vi.mocked(adminApi.enableUser).mockReset()
  vi.mocked(adminApi.changeUserRole).mockReset()
  vi.mocked(adminApi.deleteUser).mockReset()
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

    const user = userEvent.setup()
    renderAdmin()

    await user.click(await screen.findByRole("tab", { name: "注册与审核" }))

    const toggle = await screen.findByRole("switch", {
      name: "注册需要验证邮箱"
    })
    expect(toggle).toBeDisabled()
    expect(screen.getByText(/邮件未配置，无法开启该开关/)).toBeInTheDocument()

    await user.click(screen.getByRole("tab", { name: "邮件配置" }))
    expect(screen.getByText("邮件未配置")).toBeInTheDocument()
  })

  it("单人档 registration 为 null 时不渲染注册开关", async () => {
    vi.mocked(adminApi.settings).mockResolvedValue(
      adminSettings({ registration: null })
    )
    const user = userEvent.setup()
    renderAdmin()

    expect(
      await screen.findByRole("heading", { name: "邮件配置" })
    ).toBeInTheDocument()
    await user.click(screen.getByRole("tab", { name: "注册与审核" }))
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

  it("保存成功后清空已填写的密钥，失败时保留", async () => {
    vi.mocked(adminApi.settings).mockResolvedValue(adminSettings())
    vi.mocked(adminApi.updateSettings).mockRejectedValue(
      new ApiError({
        status: 502,
        message: "smtp down",
        code: "EMAIL_SEND_FAILED"
      })
    )

    const user = userEvent.setup()
    renderAdmin()
    const password = await screen.findByLabelText("密码")
    await user.type(password, "typed-secret")
    await user.click(screen.getByRole("button", { name: "保存邮件配置" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("邮件发送失败")
    expect(password).toHaveValue("typed-secret")

    vi.mocked(adminApi.updateSettings).mockResolvedValue(adminSettings())
    await user.click(screen.getByRole("button", { name: "保存邮件配置" }))
    await waitFor(() => {
      expect(password).toHaveValue("")
    })
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
          fromName: PROJECT_NAME,
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

  it("全部用户列表含自己、新建用户与待批准用户，仅待批准行可批准", async () => {
    vi.mocked(adminApi.settings).mockResolvedValue(adminSettings())
    vi.mocked(adminApi.users).mockResolvedValue({
      items: [
        adminUser({
          id: 1,
          email: "owner@example.com",
          displayName: "Owner",
          role: "admin"
        }),
        adminUser(),
        adminUser({
          id: 3,
          email: "pending@example.com",
          displayName: "Pending",
          status: "pending",
          emailVerified: false
        })
      ]
    })
    vi.mocked(adminApi.approveUser).mockResolvedValue({ success: true })

    const user = userEvent.setup()
    renderAdmin()

    await user.click(await screen.findByRole("tab", { name: "用户管理" }))
    expect(await screen.findByText("owner@example.com")).toBeInTheDocument()
    expect(screen.getByText("user@example.com")).toBeInTheDocument()
    expect(screen.getByText("pending@example.com")).toBeInTheDocument()
    expect(screen.getByText("我")).toBeInTheDocument()
    expect(screen.getByText("邮箱未验证")).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "批准" })).toHaveLength(1)

    await user.click(screen.getByRole("button", { name: "批准" }))

    await waitFor(() => expect(adminApi.approveUser).toHaveBeenCalledWith(3))
    await waitFor(() => expect(adminApi.users).toHaveBeenCalledTimes(2))
  })

  it("用户列表为空时显示暂无用户", async () => {
    vi.mocked(adminApi.settings).mockResolvedValue(adminSettings())

    const user = userEvent.setup()
    renderAdmin()
    await user.click(await screen.findByRole("tab", { name: "用户管理" }))

    expect(await screen.findByText("暂无用户")).toBeInTheDocument()
  })

  it("用户列表加载失败时就地报错", async () => {
    vi.mocked(adminApi.settings).mockResolvedValue(adminSettings())
    vi.mocked(adminApi.users).mockRejectedValue(
      new ApiError({ status: 500, message: "boom" })
    )

    const user = userEvent.setup()
    renderAdmin()
    await user.click(await screen.findByRole("tab", { name: "用户管理" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("操作失败")
  })

  it("昵称锁定开关只提交被切换的字段", async () => {
    vi.mocked(adminApi.settings).mockResolvedValue(adminSettings())
    vi.mocked(adminApi.updateSettings).mockResolvedValue(adminSettings())

    const user = userEvent.setup()
    renderAdmin()
    await user.click(await screen.findByRole("tab", { name: "注册与审核" }))
    await user.click(
      await screen.findByRole("switch", { name: "禁止修改用户昵称" })
    )
    expect(screen.queryByText("禁止修改用户名")).not.toBeInTheDocument()

    expect(adminApi.updateSettings).toHaveBeenCalledWith({
      profileLocks: { displayNameLocked: true }
    })
  })

  it("「其他」页签展示生效表前缀，切换「开放初始化页面」开关提交 setupPageEnabled", async () => {
    vi.mocked(adminApi.settings).mockResolvedValue(
      adminSettings({
        setupPageEnabled: false,
        tablePrefix: "custom_prefix_"
      })
    )
    vi.mocked(adminApi.updateSettings).mockResolvedValue(
      adminSettings({
        setupPageEnabled: true,
        tablePrefix: "custom_prefix_"
      })
    )

    const user = userEvent.setup()
    renderAdmin("/admin/others")

    expect(
      await screen.findByRole("heading", { name: "其他" })
    ).toBeInTheDocument()
    expect(screen.getByText("custom_prefix_")).toBeInTheDocument()

    const setupSwitch = screen.getByRole("switch")
    expect(setupSwitch).toHaveAttribute("aria-checked", "false")

    await user.click(setupSwitch)
    expect(adminApi.updateSettings).toHaveBeenCalledWith({
      setupPageEnabled: true
    })
  })

  it("新建用户：提交邮箱与角色，成功后就地展示一次性密码，关闭即消失", async () => {
    vi.mocked(adminApi.settings).mockResolvedValue(adminSettings())
    const created = adminCreatedUser()
    vi.mocked(adminApi.createUser).mockResolvedValue(created)

    const user = userEvent.setup()
    renderAdmin()
    await user.click(await screen.findByRole("tab", { name: "用户管理" }))

    expect(screen.getByLabelText("昵称（可选）")).toBeInTheDocument()
    expect(screen.queryByLabelText("用户名（可选）")).not.toBeInTheDocument()

    await user.type(screen.getByLabelText("邮箱"), "new@example.com")
    await user.click(screen.getByRole("radio", { name: "管理员" }))
    await user.click(screen.getByRole("button", { name: "创建用户" }))

    await waitFor(() =>
      expect(adminApi.createUser).toHaveBeenCalledWith({
        email: "new@example.com",
        role: "admin"
      })
    )
    expect(
      await screen.findByText(created.temporaryPassword)
    ).toBeInTheDocument()
    expect(screen.getByText("用户已创建")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "关闭" }))
    expect(
      screen.queryByText(created.temporaryPassword)
    ).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "创建用户" })).toBeInTheDocument()
  })

  it("新建用户：邮箱已被占用时就地报错并保留输入", async () => {
    vi.mocked(adminApi.settings).mockResolvedValue(adminSettings())
    vi.mocked(adminApi.createUser).mockRejectedValue(
      new ApiError({ status: 409, message: "taken", code: "EMAIL_TAKEN" })
    )

    const user = userEvent.setup()
    renderAdmin()
    await user.click(await screen.findByRole("tab", { name: "用户管理" }))

    const email = screen.getByLabelText("邮箱")
    await user.type(email, "dup@example.com")
    await user.click(screen.getByRole("button", { name: "创建用户" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("该邮箱已被注册")
    expect(email).toHaveValue("dup@example.com")
  })

  it("新建用户：邮箱为空时不发请求", async () => {
    vi.mocked(adminApi.settings).mockResolvedValue(adminSettings())

    const user = userEvent.setup()
    renderAdmin()
    await user.click(await screen.findByRole("tab", { name: "用户管理" }))
    await user.click(screen.getByRole("button", { name: "创建用户" }))

    expect(await screen.findByText("请输入邮箱")).toBeInTheDocument()
    expect(adminApi.createUser).not.toHaveBeenCalled()
  })
})

describe("用户管理操作列", () => {
  // Radix 打开菜单时给 body 加 pointer-events: none，默认检查会拒绝点击。
  function menuUser() {
    return userEvent.setup({ pointerEventsCheck: 0 })
  }

  async function openUsers(
    items: ReturnType<typeof adminUser>[],
    user: ReturnType<typeof menuUser>
  ) {
    vi.mocked(adminApi.settings).mockResolvedValue(adminSettings())
    vi.mocked(adminApi.users).mockResolvedValue({ items })
    renderAdmin()
    await user.click(await screen.findByRole("tab", { name: "用户管理" }))
    await screen.findByRole("table")
  }

  async function openMenu(
    user: ReturnType<typeof menuUser>,
    email: string
  ): Promise<HTMLElement> {
    await user.click(
      await screen.findByRole("button", { name: `${email} 的操作` })
    )
    return screen.findByRole("menu")
  }

  it("「⋯」菜单给出四项操作，待批准行保留批准/拒绝且不提供停用/启用", async () => {
    const user = menuUser()
    await openUsers(
      [
        adminUser({
          id: 1,
          email: "owner@example.com",
          displayName: "Owner",
          role: "admin"
        }),
        adminUser(),
        adminUser({
          id: 3,
          email: "pending@example.com",
          displayName: "Pending",
          status: "pending",
          emailVerified: false
        })
      ],
      user
    )

    const memberMenu = await openMenu(user, "user@example.com")
    expect(
      within(memberMenu).getByRole("menuitem", { name: "重置密码" })
    ).toBeInTheDocument()
    expect(
      within(memberMenu).getByRole("menuitem", { name: "停用" })
    ).toBeInTheDocument()
    expect(
      within(memberMenu).getByRole("menuitem", { name: "设为管理员" })
    ).toBeInTheDocument()
    expect(
      within(memberMenu).getByRole("menuitem", { name: "删除用户" })
    ).toBeInTheDocument()
    expect(
      within(memberMenu).queryByRole("menuitem", { name: "启用" })
    ).not.toBeInTheDocument()
    await user.keyboard("{Escape}")
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    )

    // 待批准行：行内批准/拒绝照旧，菜单里没有停用/启用（启用会绕过审批）。
    const pendingMenu = await openMenu(user, "pending@example.com")
    expect(
      within(pendingMenu).getByRole("menuitem", { name: "重置密码" })
    ).toBeInTheDocument()
    expect(
      within(pendingMenu).queryByRole("menuitem", { name: "停用" })
    ).not.toBeInTheDocument()
    expect(
      within(pendingMenu).queryByRole("menuitem", { name: "启用" })
    ).not.toBeInTheDocument()
    await user.keyboard("{Escape}")
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    )
    expect(screen.getByRole("button", { name: "批准" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "拒绝" })).toBeInTheDocument()

    // 自己：隐藏停用与删除，重置密码与角色变更保留。
    const selfMenu = await openMenu(user, "owner@example.com")
    expect(
      within(selfMenu).getByRole("menuitem", { name: "重置密码" })
    ).toBeInTheDocument()
    expect(
      within(selfMenu).getByRole("menuitem", { name: "设为成员" })
    ).toBeInTheDocument()
    expect(
      within(selfMenu).queryByRole("menuitem", { name: "停用" })
    ).not.toBeInTheDocument()
    expect(
      within(selfMenu).queryByRole("menuitem", { name: "删除用户" })
    ).not.toBeInTheDocument()
  })

  it("重置密码：弹出一次性密码，关闭后不再显示", async () => {
    const user = menuUser()
    vi.mocked(adminApi.resetUserPassword).mockResolvedValue({
      id: 2,
      email: "user@example.com",
      temporaryPassword: "temp-2026"
    })
    await openUsers([adminUser()], user)

    const menu = await openMenu(user, "user@example.com")
    await user.click(within(menu).getByRole("menuitem", { name: "重置密码" }))

    expect(await screen.findByText("temp-2026")).toBeInTheDocument()
    expect(adminApi.resetUserPassword).toHaveBeenCalledWith(2)
    expect(screen.getByRole("dialog")).toHaveTextContent("user@example.com")
    // 重置不刷新列表：密码只回这一次。
    expect(adminApi.users).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole("button", { name: "关闭" }))
    await waitFor(() =>
      expect(screen.queryByText("temp-2026")).not.toBeInTheDocument()
    )
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("停用与启用按当前状态调用对应端点并刷新列表", async () => {
    const user = menuUser()
    vi.mocked(adminApi.disableUser).mockResolvedValue({ success: true })
    vi.mocked(adminApi.enableUser).mockResolvedValue({ success: true })
    await openUsers(
      [
        adminUser(),
        adminUser({ id: 4, email: "off@example.com", status: "disabled" })
      ],
      user
    )

    const activeMenu = await openMenu(user, "user@example.com")
    await user.click(within(activeMenu).getByRole("menuitem", { name: "停用" }))
    await waitFor(() => expect(adminApi.disableUser).toHaveBeenCalledWith(2))
    await waitFor(() => expect(adminApi.users).toHaveBeenCalledTimes(2))

    const disabledMenu = await openMenu(user, "off@example.com")
    expect(
      within(disabledMenu).queryByRole("menuitem", { name: "停用" })
    ).not.toBeInTheDocument()
    await user.click(
      within(disabledMenu).getByRole("menuitem", { name: "启用" })
    )
    await waitFor(() => expect(adminApi.enableUser).toHaveBeenCalledWith(4))
  })

  it("变更角色直接切到目标角色并刷新列表", async () => {
    const user = menuUser()
    vi.mocked(adminApi.changeUserRole).mockResolvedValue({ success: true })
    await openUsers([adminUser()], user)

    const menu = await openMenu(user, "user@example.com")
    await user.click(within(menu).getByRole("menuitem", { name: "设为管理员" }))

    await waitFor(() =>
      expect(adminApi.changeUserRole).toHaveBeenCalledWith(2, {
        role: "admin"
      })
    )
    await waitFor(() => expect(adminApi.users).toHaveBeenCalledTimes(2))
  })

  it("删除：确认弹窗写明邮箱与昵称，取消不发请求，确认后删除", async () => {
    const user = menuUser()
    vi.mocked(adminApi.deleteUser).mockResolvedValue({ success: true })
    await openUsers([adminUser()], user)

    const menu = await openMenu(user, "user@example.com")
    await user.click(within(menu).getByRole("menuitem", { name: "删除用户" }))

    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveTextContent(
      "将删除 user@example.com（User），此操作无法撤销。"
    )

    await user.click(within(dialog).getByRole("button", { name: "取消" }))
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    expect(adminApi.deleteUser).not.toHaveBeenCalled()

    const reopen = await openMenu(user, "user@example.com")
    await user.click(within(reopen).getByRole("menuitem", { name: "删除用户" }))
    const confirm = await screen.findByRole("dialog")
    await user.click(within(confirm).getByRole("button", { name: "删除" }))

    await waitFor(() => expect(adminApi.deleteUser).toHaveBeenCalledWith(2))
    await waitFor(() => expect(adminApi.users).toHaveBeenCalledTimes(2))
  })

  it("最后一个管理员降级：409 的护栏文案显示在列表上方", async () => {
    const user = menuUser()
    vi.mocked(adminApi.changeUserRole).mockRejectedValue(
      new ApiError({ status: 409, message: "last admin", code: "LAST_ADMIN" })
    )
    await openUsers(
      [
        adminUser({
          id: 1,
          email: "owner@example.com",
          displayName: "Owner",
          role: "admin"
        })
      ],
      user
    )

    const menu = await openMenu(user, "owner@example.com")
    await user.click(within(menu).getByRole("menuitem", { name: "设为成员" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "至少保留一个可登录的管理员"
    )
    expect(adminApi.changeUserRole).toHaveBeenCalledWith(1, { role: "user" })
  })

  it("删除失败：错误留在确认弹窗内，不丢上下文", async () => {
    const user = menuUser()
    vi.mocked(adminApi.deleteUser).mockRejectedValue(
      new ApiError({ status: 409, message: "last admin", code: "LAST_ADMIN" })
    )
    await openUsers([adminUser()], user)

    const menu = await openMenu(user, "user@example.com")
    await user.click(within(menu).getByRole("menuitem", { name: "删除用户" }))
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("button", { name: "删除" }))

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "至少保留一个可登录的管理员"
    )
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(adminApi.deleteUser).toHaveBeenCalledWith(2)
  })

  describe("Tab 独立路由与未保存拦截", () => {
    it("支持四 tab URL 直达与未知子路径重定向", async () => {
      vi.mocked(adminApi.settings).mockResolvedValue(adminSettings())

      // 1. 直达 /admin/registration
      const { unmount: unmount1 } = renderAdmin("/admin/registration")
      expect(
        await screen.findByRole("heading", { name: "注册与审核" })
      ).toBeInTheDocument()
      unmount1()

      // 2. 直达 /admin/users
      const { unmount: unmount2 } = renderAdmin("/admin/users")
      expect(
        await screen.findByRole("heading", { name: "新建用户" })
      ).toBeInTheDocument()
      unmount2()

      // 3. 直达 /admin/others
      const { unmount: unmount3 } = renderAdmin("/admin/others")
      expect(
        await screen.findByRole("heading", { name: "其他" })
      ).toBeInTheDocument()
      unmount3()

      // 4. 旧路径 /admin/database 与 /admin/maintenance 直接替换不留重定向，回落至首 tab /admin/email
      const { unmount: unmountDb } = renderAdmin("/admin/database")
      expect(
        await screen.findByRole("heading", { name: "邮件配置" })
      ).toBeInTheDocument()
      unmountDb()

      const { unmount: unmountLegacy } = renderAdmin("/admin/maintenance")
      expect(
        await screen.findByRole("heading", { name: "邮件配置" })
      ).toBeInTheDocument()
      unmountLegacy()

      // 4. 裸路径 /admin 自动重定向至首 tab /admin/email
      const { unmount: unmount4 } = renderAdmin("/admin")
      expect(
        await screen.findByRole("heading", { name: "邮件配置" })
      ).toBeInTheDocument()
      unmount4()

      // 5. 未知子路径 /admin/invalid 自动重定向至首 tab /admin/email
      renderAdmin("/admin/invalid")
      expect(
        await screen.findByRole("heading", { name: "邮件配置" })
      ).toBeInTheDocument()
    })

    it("邮件配置有未保存修改时，切换 Tab 触发拦截，可选择留在本页或放弃修改", async () => {
      vi.mocked(adminApi.settings).mockResolvedValue(adminSettings())
      const user = userEvent.setup()
      renderAdmin("/admin/email")

      const hostInput = await screen.findByLabelText("服务器")
      await user.type(hostInput, "-changed")

      // 尝试切换到「注册与审核」Tab
      await user.click(screen.getByRole("tab", { name: "注册与审核" }))

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
      // 仍然留在邮件配置，且输入保留
      expect(screen.getByLabelText("服务器")).toHaveValue(
        "smtp.example.com-changed"
      )
      expect(
        screen.queryByRole("heading", { name: "注册与审核" })
      ).not.toBeInTheDocument()

      // 再次尝试切换并点击「放弃修改」
      await user.click(screen.getByRole("tab", { name: "注册与审核" }))
      const discardDialog = await screen.findByRole("dialog")
      await user.click(
        within(discardDialog).getByRole("button", { name: "放弃修改" })
      )

      // 成功切到「注册与审核」
      expect(
        await screen.findByRole("heading", { name: "注册与审核" })
      ).toBeInTheDocument()
    })

    it("新建用户表单有已填内容时切换 Tab 拦截，留存 vs 放弃正常工作", async () => {
      vi.mocked(adminApi.settings).mockResolvedValue(adminSettings())
      const user = userEvent.setup()
      renderAdmin("/admin/users")

      const emailInput = await screen.findByLabelText("邮箱")
      await user.type(emailInput, "draft@example.com")

      // 尝试切换到「邮件配置」Tab
      await user.click(screen.getByRole("tab", { name: "邮件配置" }))

      // 弹出未保存拦截弹窗
      const dialog = await screen.findByRole("dialog")
      expect(dialog).toHaveTextContent("未保存的修改")

      // 点击「留在本页」
      await user.click(within(dialog).getByRole("button", { name: "留在本页" }))
      expect(screen.getByLabelText("邮箱")).toHaveValue("draft@example.com")
      expect(
        screen.queryByRole("heading", { name: "邮件配置" })
      ).not.toBeInTheDocument()

      // 再次尝试切换并选择「放弃修改」
      await user.click(screen.getByRole("tab", { name: "邮件配置" }))
      const discardDialog = await screen.findByRole("dialog")
      await user.click(
        within(discardDialog).getByRole("button", { name: "放弃修改" })
      )

      // 成功切换至邮件配置
      expect(
        await screen.findByRole("heading", { name: "邮件配置" })
      ).toBeInTheDocument()
    })
  })
})

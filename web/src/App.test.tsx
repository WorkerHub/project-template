import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  createMemoryRouter,
  type RouteObject,
  RouterProvider
} from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { routes } from "@/App"
import { ThemeProvider } from "@/components/theme-provider"
import { ApiError } from "@/lib/api"
import {
  SIDEBAR_OPEN_STORAGE_KEY,
  SIDEBAR_WIDTH_STORAGE_KEY
} from "@/lib/sidebar"
import { titleKeyFor } from "@/hooks/use-page-title"
import {
  adminSettings,
  me,
  PROJECT_NAME,
  publicInfo,
  setupState
} from "@/test/fixtures"

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    publicApi: { get: vi.fn() },
    setupApi: { ...actual.setupApi, state: vi.fn() },
    meApi: { ...actual.meApi, get: vi.fn(), update: vi.fn() },
    authApi: { ...actual.authApi, logout: vi.fn() },
    adminApi: {
      ...actual.adminApi,
      settings: vi.fn(),
      users: vi.fn()
    }
  }
})

const { publicApi, setupApi, meApi, adminApi } = await import("@/lib/api")

function renderAt(entries: RouteObject[] = routes, path = "/") {
  const router = createMemoryRouter(entries, { initialEntries: [path] })
  return render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  )
}

function accountUser() {
  // Radix 打开菜单时给 body 加 pointer-events: none，默认检查会拒绝点击。
  return userEvent.setup({ pointerEventsCheck: 0 })
}

async function openAccountMenu() {
  const account = accountUser()
  await account.click(await screen.findByRole("button", { name: "账号" }))
  return account
}

beforeEach(() => {
  vi.mocked(publicApi.get).mockResolvedValue(publicInfo())
  vi.mocked(meApi.get).mockRejectedValue(
    new ApiError({ status: 401, message: "Unauthorized" })
  )
})

describe("路由与根门", () => {
  it("未初始化时打开任意页面都被引导到 setup", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(setupState())
    renderAt(routes, "/")

    expect(await screen.findByLabelText("部署密钥")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "初始化" })).toBeInTheDocument()
  })

  it("已初始化时访客进入公开首页", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    renderAt(routes, "/")

    expect(
      await screen.findByRole("link", { name: "登录" })
    ).toBeInTheDocument()
  })

  it("迁移完成但尚无所有者时不再弹回 setup，注册页可达", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: false, enabled: false })
    )
    renderAt(routes, "/register")

    expect(await screen.findByLabelText("邮箱")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "注册" })).toBeInTheDocument()
  })

  it("会话失效时不留在空白工作台，回到登录页", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    renderAt(routes, "/workbench")

    expect(
      await screen.findByRole("heading", { name: "登录" })
    ).toBeInTheDocument()
  })

  it("首登改密标记会拦住工作台，先进改密页", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    vi.mocked(meApi.get).mockResolvedValue(me({ mustChangePassword: true }))

    renderAt(routes, "/workbench")

    expect(
      await screen.findByRole("heading", { name: "修改密码" })
    ).toBeInTheDocument()
    expect(screen.getByLabelText("当前密码")).toBeInTheDocument()
    expect(screen.queryByTestId("workbench-page")).not.toBeInTheDocument()
  })

  it("管理员能在账号菜单里看到「系统管理」，普通成员看不到", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    vi.mocked(meApi.get).mockResolvedValue(me())

    const view = renderAt(routes, "/workbench")
    await openAccountMenu()
    expect(
      screen.getByRole("menuitem", { name: "系统管理" })
    ).toBeInTheDocument()
    view.unmount()

    vi.mocked(meApi.get).mockResolvedValue(me({ role: "user" }))
    renderAt(routes, "/workbench")
    await openAccountMenu()
    expect(
      screen.getByRole("menuitem", { name: "个人资料" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("menuitem", { name: "系统管理" })
    ).not.toBeInTheDocument()
  })

  it("侧栏只剩工作台一个入口", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    vi.mocked(meApi.get).mockResolvedValue(me())

    renderAt(routes, "/workbench")
    const nav = await screen.findByRole("navigation")
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent)
    ).toEqual(["工作台"])
    expect(within(nav).getByRole("link", { name: "工作台" })).toHaveAttribute(
      "data-active",
      "true"
    )
  })

  it("账号菜单里的个人资料跳到独立页", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    vi.mocked(meApi.get).mockResolvedValue(me())

    renderAt(routes, "/workbench")
    const account = await openAccountMenu()
    await account.click(screen.getByRole("menuitem", { name: "个人资料" }))

    expect(
      await screen.findByRole("heading", { level: 1, name: "个人资料" })
    ).toBeInTheDocument()
  })

  it("头像显示昵称首字", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    vi.mocked(meApi.get).mockResolvedValue(me({ displayName: "水手" }))

    renderAt(routes, "/workbench")
    const trigger = await screen.findByRole("button", { name: "账号" })
    expect(within(trigger).getByText("水")).toBeInTheDocument()
  })
  it("标签页 title 跟随页面并带站名后缀", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    renderAt(routes, "/login")
    await screen.findByRole("heading", { name: "登录" })
    expect(document.title).toBe(`登录 · ${PROJECT_NAME}`)
  })

  it("登录态工作台标签页 title 为「工作台 · 站名」", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    vi.mocked(meApi.get).mockResolvedValue(me())

    renderAt(routes, "/workbench")
    await screen.findByRole("heading", { name: "工作台" })
    expect(document.title).toBe(`工作台 · ${PROJECT_NAME}`)
  })

  it("侧栏站名是回工作台的链接，底部显示三段式版本号", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    vi.mocked(meApi.get).mockResolvedValue(me())

    renderAt(routes, "/workbench")
    await screen.findByRole("heading", { name: "工作台" })

    const brand = screen.getByRole("link", { name: PROJECT_NAME })
    expect(brand.getAttribute("href")).toBe("/workbench")
    // 站点标是装饰性图形：带在链接里，但不进可访问名（名仍只是站名）。
    const mark = brand.querySelector("svg")
    expect(mark).not.toBeNull()
    expect(mark).toHaveAttribute("aria-hidden", "true")
    expect(
      screen.getByText(
        new RegExp(
          `${PROJECT_NAME} · \\d+\\.\\d+\\.\\d+ · [0-9a-f]+\\+build\\.\\d+`
        )
      )
    ).toBeInTheDocument()
  })

  it("移动抽屉页头的站名同样带站点标", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    vi.mocked(meApi.get).mockResolvedValue(me())

    renderAt(routes, "/workbench")
    await screen.findByRole("heading", { name: "工作台" })

    await accountUser().click(screen.getByRole("button", { name: "菜单" }))

    const dialog = await screen.findByRole("dialog")
    const brand = within(dialog).getByRole("link", { name: PROJECT_NAME })
    expect(brand.getAttribute("href")).toBe("/workbench")
    expect(brand.querySelector("svg")).toHaveAttribute("aria-hidden", "true")
  })

  it("侧栏宽度与收起状态从 localStorage 恢复，展开后写回", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    vi.mocked(meApi.get).mockResolvedValue(me())
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, "320")
    localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, "false")

    const view = renderAt(routes, "/workbench")
    await screen.findByRole("heading", { name: "工作台" })

    const sidebar = view.container.querySelector('[data-slot="sidebar"]')
    expect(sidebar).toHaveAttribute("data-state", "collapsed")
    expect(sidebar).toHaveAttribute("data-collapsible", "icon")

    const wrapper = view.container.querySelector(
      '[data-slot="sidebar-wrapper"]'
    ) as HTMLElement
    expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("320px")

    await userEvent.click(screen.getByRole("button", { name: "展开侧栏" }))

    expect(sidebar).toHaveAttribute("data-state", "expanded")
    expect(localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY)).toBe("true")
    // 收起 / 展开不覆盖用户调好的宽度。
    expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe("320")
  })

  it("拖动右缘改宽、夹到上限，拖动后的尾随 click 不收起", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    vi.mocked(meApi.get).mockResolvedValue(me())

    const view = renderAt(routes, "/workbench")
    await screen.findByRole("heading", { name: "工作台" })

    const wrapper = view.container.querySelector(
      '[data-slot="sidebar-wrapper"]'
    ) as HTMLElement
    const sidebar = view.container.querySelector('[data-slot="sidebar"]')
    const rail = screen.getByRole("button", { name: "切换侧栏" })
    expect(rail).toHaveClass("touch-none")

    fireEvent.pointerDown(rail, { pointerId: 1, button: 0, clientX: 500 })
    fireEvent.pointerMove(rail, { pointerId: 1, clientX: 560 })
    expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("300px")
    expect(wrapper).toHaveAttribute("data-resizing", "true")

    // 越过上限夹到 360，松手才落盘。
    fireEvent.pointerMove(rail, { pointerId: 1, clientX: 900 })
    expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("360px")
    expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBeNull()

    fireEvent.pointerUp(rail, { pointerId: 1, clientX: 900 })
    expect(wrapper).not.toHaveAttribute("data-resizing")
    expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe("360")

    // 拖动过：尾随 click 被吞掉，侧栏保持展开。
    fireEvent.click(rail)
    expect(sidebar).toHaveAttribute("data-state", "expanded")

    // 原地点击（位移 ≤ 3px）仍走 SidebarRail 原生切换。
    fireEvent.pointerDown(rail, { pointerId: 2, button: 0, clientX: 500 })
    fireEvent.pointerUp(rail, { pointerId: 2, clientX: 501 })
    fireEvent.click(rail)
    expect(sidebar).toHaveAttribute("data-state", "collapsed")
    expect(localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY)).toBe("false")
    expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("360px")
  })

  it("收起态顶部只留站点标，站名转 sr-only", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    vi.mocked(meApi.get).mockResolvedValue(me())
    localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, "false")

    const view = renderAt(routes, "/workbench")
    await screen.findByRole("heading", { name: "工作台" })

    const sidebar = view.container.querySelector('[data-slot="sidebar"]')
    expect(sidebar).toHaveAttribute("data-state", "collapsed")

    const brand = screen.getByRole("link", { name: PROJECT_NAME })
    expect(brand.className).not.toContain(
      "group-data-[collapsible=icon]:hidden"
    )
    expect(brand.querySelector("svg")).not.toBeNull()
    expect(within(brand).getByText(PROJECT_NAME).className).toContain(
      "group-data-[collapsible=icon]:sr-only"
    )
  })

  it("收起/展开按钮只留图标，与版本文字同排靠右，悬停出两态提示", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    vi.mocked(meApi.get).mockResolvedValue(me())

    renderAt(routes, "/workbench")
    await screen.findByRole("heading", { name: "工作台" })

    const collapse = screen.getByRole("button", { name: "收起侧栏" })
    expect(collapse.textContent).toBe("")

    const version = screen.getByText(
      new RegExp(
        `${PROJECT_NAME} · \\d+\\.\\d+\\.\\d+ · [0-9a-f]+\\+build\\.\\d+`
      )
    )
    expect(version.parentElement).toBe(collapse.parentElement)
    expect(collapse.parentElement?.className).toContain("justify-between")

    const user = accountUser()
    await user.hover(collapse)
    expect(await screen.findByRole("tooltip")).toHaveTextContent("收起侧栏")
    await user.unhover(collapse)

    await user.click(collapse)
    const expand = screen.getByRole("button", { name: "展开侧栏" })
    // 点击后指针仍停在按钮上，先移开再进入，确保触发新的 pointerenter。
    await user.unhover(expand)
    await user.hover(expand)
    expect(await screen.findByRole("tooltip")).toHaveTextContent("展开侧栏")
  })

  it("系统管理与设置页 tab 独立 URL 直达与重定向", async () => {
    vi.mocked(setupApi.state).mockResolvedValue(
      setupState({ ownerExists: true, enabled: false })
    )
    vi.mocked(meApi.get).mockResolvedValue(me({ role: "admin" }))
    vi.mocked(adminApi.settings).mockResolvedValue(adminSettings())

    // 1. /admin 重定向至 /admin/email
    const { unmount: u1 } = renderAt(routes, "/admin")
    expect(
      await screen.findByRole("heading", { name: "邮件配置" })
    ).toBeInTheDocument()
    u1()

    // 2. /admin/invalid 重定向至 /admin/email
    const { unmount: u2 } = renderAt(routes, "/admin/invalid")
    expect(
      await screen.findByRole("heading", { name: "邮件配置" })
    ).toBeInTheDocument()
    u2()

    // 3. /settings 重定向至 /settings/security
    const { unmount: u3 } = renderAt(routes, "/settings")
    expect(
      await screen.findByRole("heading", { name: "两步验证" })
    ).toBeInTheDocument()
    u3()

    // 4. /settings/invalid 重定向至 /settings/security
    const { unmount: u4 } = renderAt(routes, "/settings/invalid")
    expect(
      await screen.findByRole("heading", { name: "两步验证" })
    ).toBeInTheDocument()
    u4()

    // 5. /admin/database 独立 URL 直达
    const { unmount: u5 } = renderAt(routes, "/admin/database")
    expect(
      await screen.findByRole("heading", { name: "数据库维护" })
    ).toBeInTheDocument()
    u5()

    // 6. /admin/maintenance 重定向至 /admin/database
    const { unmount: u6 } = renderAt(routes, "/admin/maintenance")
    expect(
      await screen.findByRole("heading", { name: "数据库维护" })
    ).toBeInTheDocument()
    u6()
  })

  it("页面标题映射支持 /admin/* 与 /settings/* 子路径", () => {
    expect(titleKeyFor("/admin")).toBe("workbench.nav.admin")
    expect(titleKeyFor("/admin/email")).toBe("workbench.nav.admin")
    expect(titleKeyFor("/admin/registration")).toBe("workbench.nav.admin")
    expect(titleKeyFor("/admin/users")).toBe("workbench.nav.admin")
    expect(titleKeyFor("/admin/database")).toBe("workbench.nav.admin")
    expect(titleKeyFor("/admin/maintenance")).toBe("workbench.nav.admin")
    expect(titleKeyFor("/admin/other-subpath")).toBe("workbench.nav.admin")

    expect(titleKeyFor("/settings")).toBe("settings.title")
    expect(titleKeyFor("/settings/security")).toBe("settings.title")
    expect(titleKeyFor("/settings/preferences")).toBe("settings.title")
    expect(titleKeyFor("/settings/other-subpath")).toBe("settings.title")
  })
})

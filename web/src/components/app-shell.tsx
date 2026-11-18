import {
  InfoIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MenuIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UserIcon
} from "lucide-react"
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState
} from "react"
import { useTranslation } from "react-i18next"
import { NavLink, Outlet, useLocation, useNavigate } from "react-router"
import { SiteLogo } from "@/components/site-logo"
import { ThemeCycleButton } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from "@/components/ui/sheet"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail
} from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { UserAvatar } from "@/components/user-avatar"
import { titleKeyFor } from "@/hooks/use-page-title"
import { buildVersionLabel } from "@/lib/build-info"
import {
  clampSidebarWidth,
  readSidebarOpen,
  readSidebarWidth,
  writeSidebarOpen,
  writeSidebarWidth
} from "@/lib/sidebar"
import { accountPrimaryLabel } from "@/lib/user-identity"
import { useAuthStore } from "@/stores/auth"
import { useSiteStore } from "@/stores/site"

const SIDEBAR_ITEMS = [
  {
    to: "/workbench",
    labelKey: "workbench.nav.workbench",
    icon: LayoutDashboardIcon
  }
] as const

/** 头像下拉里的页面入口；系统管理仍只对管理员显示。 */
const ACCOUNT_ITEMS = [
  { to: "/profile", labelKey: "profile.title", icon: UserIcon },
  {
    to: "/admin",
    labelKey: "workbench.nav.admin",
    icon: ShieldCheckIcon,
    adminOnly: true
  },
  { to: "/settings", labelKey: "workbench.nav.settings", icon: SettingsIcon },
  { to: "/about", labelKey: "workbench.nav.about", icon: InfoIcon }
] as const

/** 位移不超过这个值仍算点击：交给 SidebarRail 原生切换，不进入拖拽。 */
const RESIZE_CLICK_THRESHOLD_PX = 3

function isActivePath(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`)
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation()

  return (
    <nav className="flex flex-col gap-1 p-2">
      {SIDEBAR_ITEMS.map((item) => {
        const Icon = item.icon
        return (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              isActive
                ? "flex items-center gap-2 rounded-lg bg-sidebar-accent px-2.5 py-1.5 text-sm font-medium text-sidebar-accent-foreground"
                : "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            }
          >
            <Icon className="size-4" aria-hidden="true" />
            {t(item.labelKey)}
          </NavLink>
        )
      })}
    </nav>
  )
}

/**
 * 登录后的应用壳：侧边栏 + 顶栏 + 内容区（技术方案 §3C 的三件套骨架）。
 *
 * 侧栏只留工作台；个人资料 / 系统管理 / 设置 / 关于在顶栏头像菜单里
 * （系统管理按角色隐藏，接口层另有 403）。移动端把同一份侧栏装进 Sheet。
 *
 * 桌面侧栏用 shadcn/ui Sidebar 的 `collapsible="icon"` 收起成图标栏，
 * 收起 / 图标 / 悬停提示都是官方能力；只有右缘拖动是这里补的：宽度与开合
 * 状态由本组件受控，并只写 localStorage（键见 lib/sidebar.ts）。
 */
export function AppShell() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)
  const role = useAuthStore((state) => state.user?.role)
  const name = useSiteStore((state) => state.info?.name ?? "")
  const [mobileOpen, setMobileOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarOpen)
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth)
  const [resizing, setResizing] = useState(false)
  const dragRef = useRef<{
    startX: number
    startWidth: number
    width: number
    moved: boolean
  } | null>(null)
  const suppressRailClickRef = useRef(false)

  const titleKey = titleKeyFor(location.pathname)
  const primaryLabel = accountPrimaryLabel(user)
  const toggleLabelKey = sidebarOpen
    ? "workbench.sidebar.collapse"
    : "workbench.sidebar.expand"

  const signOut = async () => {
    await logout()
    navigate("/login", { replace: true })
  }

  const changeSidebarOpen = (open: boolean) => {
    setSidebarOpen(open)
    writeSidebarOpen(open)
  }

  /** 右缘按下只记录起点；位移超过阈值才真正开始拖。 */
  const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    // 收起态宽度固定走官方 3rem，非主键不参与拖拽。
    if (!sidebarOpen || event.button !== 0) return
    dragRef.current = {
      startX: event.clientX,
      startWidth: sidebarWidth,
      width: sidebarWidth,
      moved: false
    }
    // 上一次拖拽若没等来 click，不能让它吃掉这一次正常点击。
    suppressRailClickRef.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const resizeSidebar = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const delta = event.clientX - drag.startX
    if (!drag.moved && Math.abs(delta) <= RESIZE_CLICK_THRESHOLD_PX) return
    drag.moved = true
    drag.width = clampSidebarWidth(drag.startWidth + delta)
    setResizing(true)
    setSidebarWidth(drag.width)
  }

  /** 拖动中只改内存宽度，松手才落盘；没收住位移则完全不碰开合状态。 */
  const endResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setResizing(false)
    if (!drag.moved) return
    suppressRailClickRef.current = true
    writeSidebarWidth(drag.width)
  }

  const cancelResize = () => {
    if (!dragRef.current) return
    dragRef.current = null
    setResizing(false)
  }

  const guardRailClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (!suppressRailClickRef.current) return
    suppressRailClickRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <SidebarProvider
      open={sidebarOpen}
      onOpenChange={changeSidebarOpen}
      data-resizing={resizing ? "true" : undefined}
      className="bg-background text-foreground"
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <Sidebar collapsible="icon">
        <SidebarHeader className="p-0">
          <NavLink
            to="/workbench"
            className="flex h-14 items-center gap-2 px-4 font-heading text-sm font-semibold tracking-tight transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
          >
            <SiteLogo />
            <span className="truncate group-data-[collapsible=icon]:sr-only">
              {name}
            </span>
          </NavLink>
        </SidebarHeader>

        <SidebarContent>
          <nav className="p-2">
            <SidebarMenu>
              {SIDEBAR_ITEMS.map((item) => {
                const Icon = item.icon
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActivePath(location.pathname, item.to)}
                      tooltip={t(item.labelKey)}
                    >
                      <NavLink to={item.to}>
                        <Icon aria-hidden="true" />
                        <span>{t(item.labelKey)}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </nav>
        </SidebarContent>

        <SidebarFooter className="border-t border-sidebar-border">
          <div className="flex items-center justify-between gap-2">
            <div className="px-2 py-1 text-xs text-sidebar-foreground/60 group-data-[collapsible=icon]:hidden">
              {buildVersionLabel(name || undefined)}
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <SidebarMenuButton
                  type="button"
                  aria-label={t(toggleLabelKey)}
                  onClick={() => changeSidebarOpen(!sidebarOpen)}
                  className="size-8! shrink-0"
                >
                  {sidebarOpen ? <PanelLeftCloseIcon /> : <PanelLeftOpenIcon />}
                </SidebarMenuButton>
              </TooltipTrigger>
              <TooltipContent side="right" align="center">
                {t(toggleLabelKey)}
              </TooltipContent>
            </Tooltip>
          </div>
        </SidebarFooter>

        <SidebarRail
          className="touch-none"
          aria-label={t("workbench.sidebar.toggle")}
          title={t("workbench.sidebar.toggle")}
          onPointerDown={startResize}
          onPointerMove={resizeSidebar}
          onPointerUp={endResize}
          onPointerCancel={cancelResize}
          onClickCapture={guardRailClick}
        />
      </Sidebar>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="md:hidden"
                aria-label={t("workbench.menu")}
              >
                <MenuIcon aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 bg-sidebar p-0">
              <SheetHeader className="border-b px-4 py-3">
                <SheetTitle className="text-sm font-semibold">
                  <NavLink
                    to="/workbench"
                    onClick={() => setMobileOpen(false)}
                    className="inline-flex items-center gap-2"
                  >
                    <SiteLogo />
                    {name}
                  </NavLink>
                </SheetTitle>
              </SheetHeader>
              <Navigation onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          <h1 className="truncate font-heading text-sm font-medium">
            {t(titleKey)}
          </h1>

          <div className="ml-auto flex items-center gap-1">
            <ThemeCycleButton />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  className="rounded-full"
                  aria-label={t("workbench.account")}
                >
                  <UserAvatar user={user} className="size-7" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="flex items-center gap-2">
                  <UserAvatar user={user} className="size-9" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium text-foreground">
                      {primaryLabel}
                    </span>
                    {primaryLabel === user?.email ? null : (
                      <span className="truncate text-xs font-normal">
                        {user?.email}
                      </span>
                    )}
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {ACCOUNT_ITEMS.filter(
                  (item) => !("adminOnly" in item) || role === "admin"
                ).map((item) => {
                  const Icon = item.icon
                  return (
                    <DropdownMenuItem
                      key={item.to}
                      onSelect={() => navigate(item.to)}
                    >
                      <Icon aria-hidden="true" />
                      {t(item.labelKey)}
                    </DropdownMenuItem>
                  )
                })}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void signOut()}>
                  <LogOutIcon aria-hidden="true" />
                  {t("workbench.logout")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 p-4">
          <Outlet />
        </main>
      </div>
    </SidebarProvider>
  )
}

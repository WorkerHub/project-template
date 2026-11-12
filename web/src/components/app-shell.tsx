import {
  ChevronDownIcon,
  InfoIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MenuIcon,
  SettingsIcon,
  ShieldCheckIcon
} from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { NavLink, Outlet, useLocation, useNavigate } from "react-router"
import { LanguageCycleButton } from "@/components/language-toggle"
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
import { useAuthStore } from "@/stores/auth"
import { useSiteStore } from "@/stores/site"

const NAV_ITEMS = [
  {
    to: "/workbench",
    labelKey: "workbench.nav.workbench",
    icon: LayoutDashboardIcon
  },
  { to: "/settings", labelKey: "workbench.nav.settings", icon: SettingsIcon },
  { to: "/about", labelKey: "workbench.nav.about", icon: InfoIcon },
  {
    to: "/admin",
    labelKey: "workbench.nav.admin",
    icon: ShieldCheckIcon,
    adminOnly: true
  }
] as const

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation()
  const role = useAuthStore((state) => state.user?.role)

  return (
    <nav className="flex flex-col gap-1 p-2">
      {NAV_ITEMS.filter(
        (item) => !("adminOnly" in item) || role === "admin"
      ).map((item) => {
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
 * 侧边栏只放页面导航；「系统管理」按角色隐藏（接口层另有 403）。
 * 移动端把同一份导航装进 Sheet。
 */
export function AppShell() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)
  const name = useSiteStore((state) => state.info?.name ?? "")
  const [mobileOpen, setMobileOpen] = useState(false)

  const current =
    NAV_ITEMS.find((item) => location.pathname.startsWith(item.to)) ??
    NAV_ITEMS[0]

  const signOut = async () => {
    await logout()
    navigate("/login", { replace: true })
  }

  return (
    <div className="flex min-h-svh bg-background text-foreground">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex h-14 items-center px-4 font-heading text-sm font-semibold tracking-tight">
          {name}
        </div>
        <Navigation />
      </aside>

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
                  {name}
                </SheetTitle>
              </SheetHeader>
              <Navigation onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          <h1 className="truncate font-heading text-sm font-medium">
            {t(current.labelKey)}
          </h1>

          <div className="ml-auto flex items-center gap-1">
            <LanguageCycleButton />
            <ThemeCycleButton />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1"
                >
                  <span className="max-w-40 truncate">{user?.email}</span>
                  <ChevronDownIcon className="size-3.5" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="truncate">
                  {user?.email}
                </DropdownMenuLabel>
                <DropdownMenuItem disabled>
                  {t(`common.role.${user?.role ?? "user"}`)}
                </DropdownMenuItem>
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
    </div>
  )
}

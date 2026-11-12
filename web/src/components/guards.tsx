import { Loader2Icon } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Navigate, Outlet, useLocation } from "react-router"
import { useAuthStore } from "@/stores/auth"
import { useSetupStore } from "@/stores/setup"
import { useSiteStore } from "@/stores/site"

function LoadingScreen() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-svh items-center justify-center bg-background">
      <Loader2Icon
        className="size-5 animate-spin text-muted-foreground"
        aria-label={t("common.loading")}
        role="status"
      />
    </div>
  )
}

/**
 * 根门：首屏并行拉公开信息、setup 状态与自己；再决定要不要把访客送去 /setup。
 *
 * 还没建所有者且初始化页开着（后端对未初始化的库恒回 enabled=true）时，
 * 打开任意页面都会被引导到初始化页（技术方案 §5A.1）。迁移完成、页面按
 * 初始化动作显式写关之后就不再拦——首个用户要去注册页，不能被弹回 setup。
 */
export function RootGate() {
  const location = useLocation()
  const setupState = useSetupStore((state) => state.state)
  const siteLoaded = useSiteStore((state) => state.loaded)
  const authStatus = useAuthStore((state) => state.status)
  const siteName = useSiteStore((state) => state.info?.name)
  const [booted, setBooted] = useState(false)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      useSiteStore.getState().load(),
      useSetupStore.getState().load(),
      useAuthStore.getState().load()
    ]).then(() => {
      if (!cancelled) setBooted(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // 页面标题跟随身份单点（index.html 的 <title> 只是首屏静态值）。
  useEffect(() => {
    if (siteName) document.title = siteName
  }, [siteName])

  if (!booted || !siteLoaded || authStatus === "loading" || !setupState) {
    return <LoadingScreen />
  }

  if (
    setupState.ownerExists === false &&
    setupState.enabled &&
    location.pathname !== "/setup"
  ) {
    return <Navigate to="/setup" replace />
  }

  return <Outlet />
}

/** 已登录专属页面。 */
export function RequireAuth() {
  const user = useAuthStore((state) => state.user)
  const location = useLocation()
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }
  return <Outlet />
}

/** 未登录页（登录/注册/找回密码/公开首页）：已登录就回工作台。 */
export function GuestOnly() {
  const user = useAuthStore((state) => state.user)
  if (user) return <Navigate to="/workbench" replace />
  return <Outlet />
}

/** 管理员页面：菜单隐藏只是体验，接口 403 才是边界；这里拦的是直接拼 URL。 */
export function RequireAdmin() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.user)
  if (user?.role !== "admin") {
    return (
      <div className="mx-auto max-w-md rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        {t("errors.codes.FORBIDDEN")}
      </div>
    )
  }
  return <Outlet />
}

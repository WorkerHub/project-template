import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { useLocation } from "react-router"
import { useSiteStore } from "@/stores/site"

/**
 * 页面 → i18n 标题 key 的映射。已登录壳的顶栏标题（app-shell.tsx）与浏览器
 * 标签页 title 共用这一份，避免两处漂移；未命中路径（404 等）回落 errors.notFound。
 */
export const PAGE_TITLE_KEYS: Record<string, string> = {
  "/": "common.home",
  "/login": "auth.login.title",
  "/register": "auth.register.title",
  "/forgot-password": "auth.forgot.title",
  "/change-password": "changePassword.title",
  "/setup": "setup.title",
  "/workbench": "workbench.nav.workbench",
  "/profile": "profile.title",
  "/settings": "settings.title",
  "/settings/security": "settings.title",
  "/settings/preferences": "settings.title",
  "/about": "workbench.nav.about",
  "/admin": "workbench.nav.admin",
  "/admin/email": "workbench.nav.admin",
  "/admin/registration": "workbench.nav.admin",
  "/admin/users": "workbench.nav.admin",
  "/admin/others": "workbench.nav.admin"
}

/** 按当前路径取标题 key，未命中回落 errors.notFound。 */
export function titleKeyFor(pathname: string): string {
  if (PAGE_TITLE_KEYS[pathname]) {
    return PAGE_TITLE_KEYS[pathname]
  }
  if (pathname.startsWith("/admin/")) {
    return "workbench.nav.admin"
  }
  if (pathname.startsWith("/settings/")) {
    return "settings.title"
  }
  return "errors.notFound"
}

/**
 * 让 `document.title` 跟随当前路由：`页面名 · 站名`（站名未加载时只页面名）。
 * 挂在 RootGate 上即可覆盖全部路由（含未登录页与 404），无需各页各自调用。
 */
export function usePageTitle(): void {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const siteName = useSiteStore((state) => state.info?.name)

  useEffect(() => {
    const page = t(titleKeyFor(pathname))
    document.title = siteName ? `${page} · ${siteName}` : page
  }, [pathname, siteName, t])
}

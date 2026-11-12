import {
  createBrowserRouter,
  type RouteObject,
  RouterProvider
} from "react-router"
import { Toaster } from "@/components/ui/sonner"
import { AppShell } from "@/components/app-shell"
import {
  RootGate,
  GuestOnly,
  RequireAdmin,
  RequireAuth
} from "@/components/guards"
import { ThemeProvider } from "@/components/theme-provider"
import { AboutPage } from "@/pages/about"
import { AdminPage } from "@/pages/admin/admin-page"
import { ForgotPasswordPage } from "@/pages/auth/forgot-password"
import { LoginPage } from "@/pages/auth/login"
import { RegisterPage } from "@/pages/auth/register"
import { HomePage } from "@/pages/home"
import { NotFoundPage } from "@/pages/not-found"
import { SettingsPage } from "@/pages/settings"
import { SetupPage } from "@/pages/setup"
import { WorkbenchPage } from "@/pages/workbench"

/**
 * 路由表单独导出：测试用 createMemoryRouter(routes) 拿到同一份定义。
 *
 * 层级：
 * - RootGate：首屏拉公开信息/setup/自己，未初始化一律去 /setup；
 * - GuestOnly：公开页（首页/登录/注册/找回密码）；
 * - SetupPage：初始化页自带三形态，不进登录壳；
 * - RequireAuth + AppShell：工作台/设置/关于/系统管理；
 * - RequireAdmin：系统管理再拦一层（接口 403 才是最终边界）。
 */
export const routes: RouteObject[] = [
  {
    element: <RootGate />,
    children: [
      {
        element: <GuestOnly />,
        children: [
          { path: "/", element: <HomePage /> },
          { path: "/login", element: <LoginPage /> },
          { path: "/register", element: <RegisterPage /> },
          { path: "/forgot-password", element: <ForgotPasswordPage /> }
        ]
      },
      { path: "/setup", element: <SetupPage /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            children: [
              { path: "/workbench", element: <WorkbenchPage /> },
              { path: "/settings", element: <SettingsPage /> },
              { path: "/about", element: <AboutPage /> },
              {
                element: <RequireAdmin />,
                children: [{ path: "/admin", element: <AdminPage /> }]
              }
            ]
          }
        ]
      },
      { path: "*", element: <NotFoundPage /> }
    ]
  }
]

const router = createBrowserRouter(routes)

export function App() {
  return (
    <ThemeProvider>
      <RouterProvider router={router} />
      <Toaster position="top-center" />
    </ThemeProvider>
  )
}

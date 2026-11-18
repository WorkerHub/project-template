import {
  createBrowserRouter,
  Navigate,
  type RouteObject,
  RouterProvider
} from "react-router"
import { Toaster } from "@/components/ui/sonner"
import { AppShell } from "@/components/app-shell"
import {
  RootGate,
  GuestOnly,
  RequireAdmin,
  RequireAuth,
  RequirePasswordChanged
} from "@/components/guards"
import { ThemeProvider } from "@/components/theme-provider"
import { AboutPage } from "@/pages/about"
import { AdminPage, AdminUsersTab } from "@/pages/admin/admin-page"
import { EmailSection } from "@/pages/admin/email-section"
import { MaintenanceSection } from "@/pages/admin/maintenance-section"
import { RegistrationSection } from "@/pages/admin/registration-section"
import { ForgotPasswordPage } from "@/pages/auth/forgot-password"
import { LoginPage } from "@/pages/auth/login"
import { RegisterPage } from "@/pages/auth/register"
import { ChangePasswordPage } from "@/pages/change-password"
import { HomePage } from "@/pages/home"
import { NotFoundPage } from "@/pages/not-found"
import { ProfilePage } from "@/pages/profile"
import { SettingsPage } from "@/pages/settings"
import { PreferencesSection } from "@/pages/settings/preferences-section"
import { SecuritySection } from "@/pages/settings/security-section"
import { SetupPage } from "@/pages/setup"
import { WorkbenchPage } from "@/pages/workbench"

/**
 * 路由表单独导出：测试用 createMemoryRouter(routes) 拿到同一份定义。
 *
 * - RootGate：首屏拉公开信息/setup/自己，未初始化一律去 /setup；
 * - GuestOnly：公开页（首页/登录/注册/找回密码）；
 * - SetupPage：初始化页自带三形态，不进登录壳；
 * - RequireAuth + /change-password：首登强制改密页，不入应用壳；
 * - RequirePasswordChanged + AppShell：带改密标记的账号先被送回改密页；
 * - RequireAdmin：系统管理再拦一层（接口 403 才是最终边界）。
 * - /settings、/admin：已全面路径化为独立路径段子路由（不用 query 参数）。
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
          { path: "/change-password", element: <ChangePasswordPage /> },
          {
            element: <RequirePasswordChanged />,
            children: [
              {
                element: <AppShell />,
                children: [
                  { path: "/workbench", element: <WorkbenchPage /> },
                  { path: "/profile", element: <ProfilePage /> },
                  {
                    path: "/settings",
                    element: <SettingsPage />,
                    children: [
                      {
                        index: true,
                        element: <Navigate to="/settings/security" replace />
                      },
                      { path: "security", element: <SecuritySection /> },
                      { path: "preferences", element: <PreferencesSection /> },
                      {
                        path: "*",
                        element: <Navigate to="/settings/security" replace />
                      }
                    ]
                  },
                  { path: "/about", element: <AboutPage /> },
                  {
                    element: <RequireAdmin />,
                    children: [
                      {
                        path: "/admin",
                        element: <AdminPage />,
                        children: [
                          {
                            index: true,
                            element: <Navigate to="/admin/email" replace />
                          },
                          { path: "email", element: <EmailSection /> },
                          {
                            path: "registration",
                            element: <RegistrationSection />
                          },
                          { path: "users", element: <AdminUsersTab /> },
                          {
                            path: "database",
                            element: <MaintenanceSection />
                          },
                          {
                            path: "maintenance",
                            element: <Navigate to="/admin/database" replace />
                          },
                          {
                            path: "*",
                            element: <Navigate to="/admin/email" replace />
                          }
                        ]
                      }
                    ]
                  }
                ]
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

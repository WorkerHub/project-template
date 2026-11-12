import type { ReactNode } from "react"
import { LanguageCycleButton } from "@/components/language-toggle"
import { ThemeCycleButton } from "@/components/theme-toggle"
import { buildInfo } from "@/lib/build-info"
import { useSiteStore } from "@/stores/site"

/**
 * 未登录页面的统一外壳：品牌、主题与语言切换、页脚版本号（技术方案 §5A.2）。
 */
export function AuthShell({
  title,
  subtitle,
  children
}: {
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
}) {
  const name = useSiteStore((state) => state.info?.name ?? "")

  return (
    <div className="relative flex min-h-svh flex-col bg-background">
      <div className="absolute top-3 right-3 flex items-center gap-1">
        <LanguageCycleButton />
        <ThemeCycleButton />
      </div>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-2 text-center">
            <p className="font-heading text-sm font-medium tracking-tight text-muted-foreground">
              {name}
            </p>
            <h1 className="font-heading text-xl font-semibold tracking-tight">
              {title}
            </h1>
            {subtitle ? (
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          <div className="rounded-xl border bg-card p-5 shadow-xs">
            {children}
          </div>
        </div>
      </main>

      <footer className="px-4 pb-4 text-center text-[11px] text-muted-foreground">
        {name ? `${name} · ${buildInfo.version}` : buildInfo.version}
      </footer>
    </div>
  )
}

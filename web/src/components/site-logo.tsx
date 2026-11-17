import { cn } from "@/lib/utils"

type SiteLogoProps = {
  className?: string
}

/**
 * 站点标（菱形环）：外菱形挖掉内菱形，靠 evenodd 成环。
 *
 * 单色几何标，颜色一律继承 `currentColor`：亮/暗主题与侧栏前景色共用一份，
 * 不做两套资源。纯装饰——可访问名交给同一行里的站名，因此 aria-hidden 后
 * 不进入链接名。默认 `size-5`，尺寸需要时由调用方经 `cn` 覆盖。
 */
export function SiteLogo({ className }: SiteLogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={cn("size-5 shrink-0", className)}
    >
      <path
        fillRule="evenodd"
        d="M12 2.5 21.5 12 12 21.5 2.5 12 12 2.5Z M12 8.6 15.4 12 12 15.4 8.6 12 12 8.6Z"
      />
    </svg>
  )
}

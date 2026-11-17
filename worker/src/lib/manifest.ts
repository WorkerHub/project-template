/**
 * Web App Manifest 组装（规格第 4 项）：manifest 由 Worker 动态下发，name / short_name
 * 从身份真源 config/project.ts 取，全仓不再出现第二份名字字面量。
 *
 * 图标是随仓提交的静态 PNG（scripts/export-pwa-icons.mjs 按 site-logo.tsx 的菱形环
 * 几何导出，见 web/public/icons/），路径走 ASSETS 静态服务。
 */
import { PROJECT_NAME, PROJECT_TAGLINE } from "../config/project"

export interface ManifestIcon {
  src: string
  sizes: string
  type: string
  purpose?: "any" | "maskable"
}

export interface WebAppManifest {
  id: string
  name: string
  short_name: string
  description: string
  start_url: string
  display: string
  background_color: string
  theme_color: string
  icons: ManifestIcon[]
}

/** 静态站点默认主题色，与 web/index.html 内联脚本的亮色字面量一致。 */
const THEME_COLOR = "#ffffff"

export function buildWebAppManifest(): WebAppManifest {
  return {
    id: "/",
    name: PROJECT_NAME,
    short_name: PROJECT_NAME,
    description: PROJECT_TAGLINE,
    start_url: "/",
    display: "standalone",
    background_color: THEME_COLOR,
    theme_color: THEME_COLOR,
    icons: [
      { src: "/icons/pwa-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/pwa-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/pwa-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ]
  }
}

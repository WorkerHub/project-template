import { create } from "zustand"
import type { PublicInfo } from "@/lib/api-types"
import { publicApi } from "@/lib/api"

/**
 * 公开站点信息（`GET /api/public`）：项目名、一句话说明、仓库地址、档位与两个
 * 公开开关。名字不从源码常量里取——身份单点在 worker 的 project.ts，经这里读。
 */
interface SiteState {
  info: PublicInfo | null
  loaded: boolean
  load: () => Promise<PublicInfo | null>
}

export const useSiteStore = create<SiteState>((set) => ({
  info: null,
  loaded: false,

  load: async () => {
    try {
      const info = await publicApi.get()
      set({ info, loaded: true })
      return info
    } catch {
      // 公开信息读不到时页面仍要能渲染（文案走 i18n），不把首屏变成错误页。
      set({ loaded: true })
      return null
    }
  }
}))

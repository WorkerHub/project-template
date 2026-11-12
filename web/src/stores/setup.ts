import { create } from "zustand"
import type { SetupState } from "@/lib/api-types"
import { setupApi } from "@/lib/api"

/**
 * setup 状态（`GET /api/setup/state`）。RootGate 与 /setup 页共用这一份，
 * 初始化成功后重拉一次，根门立刻放行。
 *
 * 读取失败时按「未初始化」处理（与后端 fail-open 同口径）：`ownerExists=false`
 * 会被引导到 /setup，而不是把首屏变成 500。
 */
const UNKNOWN_STATE: SetupState = {
  enabled: true,
  ownerExists: false,
  tablePrefix: ""
}

interface SetupGateState {
  state: SetupState | null
  loaded: boolean
  load: () => Promise<SetupState>
  apply: (state: SetupState) => void
}

export const useSetupStore = create<SetupGateState>((set) => ({
  state: null,
  loaded: false,

  load: async () => {
    try {
      const state = await setupApi.state()
      set({ state, loaded: true })
      return state
    } catch {
      set({ state: UNKNOWN_STATE, loaded: true })
      return UNKNOWN_STATE
    }
  },

  apply: (state) => set({ state, loaded: true })
}))

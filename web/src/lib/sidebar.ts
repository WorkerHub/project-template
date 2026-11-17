/**
 * 侧栏宽度与收起状态的持久化（规格 §6）。
 *
 * 只存本机：localStorage 的 `app-sidebar-width` / `app-sidebar-open`，
 * 不进用户属性、不随账号同步。宽度按整数 px 存字符串；开合状态只有明确的
 * `"false"` 才算收起，缺失或非法一律按展开（与官方侧栏默认展开一致）。
 */
export const SIDEBAR_WIDTH_STORAGE_KEY = "app-sidebar-width"
export const SIDEBAR_OPEN_STORAGE_KEY = "app-sidebar-open"

export const SIDEBAR_WIDTH_DEFAULT = 240
export const SIDEBAR_WIDTH_MIN = 200
export const SIDEBAR_WIDTH_MAX = 360

/** 整数 px 且夹在 [MIN, MAX]；非有限数回落默认宽度。 */
export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_WIDTH_DEFAULT
  return Math.min(
    SIDEBAR_WIDTH_MAX,
    Math.max(SIDEBAR_WIDTH_MIN, Math.round(width))
  )
}

/** 读宽度：缺失回落默认；越界夹到边界；非数字回落默认；存储不可用也回落默认。 */
export function readSidebarWidth(): number {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)
    if (raw === null) return SIDEBAR_WIDTH_DEFAULT
    const parsed = Number.parseFloat(raw)
    if (!Number.isFinite(parsed)) return SIDEBAR_WIDTH_DEFAULT
    return clampSidebarWidth(parsed)
  } catch {
    return SIDEBAR_WIDTH_DEFAULT
  }
}

/** 读开合状态：只有明确写过 `"false"` 才收起，其余按展开。 */
export function readSidebarOpen(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY) !== "false"
  } catch {
    return true
  }
}

export function writeSidebarWidth(width: number): void {
  try {
    window.localStorage.setItem(
      SIDEBAR_WIDTH_STORAGE_KEY,
      String(clampSidebarWidth(width))
    )
  } catch {
    // 存储不可用（隐私模式等）只影响下次刷新，不打断交互。
  }
}

export function writeSidebarOpen(open: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, String(open))
  } catch {
    // 同上。
  }
}

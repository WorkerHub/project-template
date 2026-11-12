/**
 * 项目身份单点（规格 §4）：从模板生成新项目时，改名成本收敛到这里 + 一份令牌清单。
 *
 * 令牌允许出现的位置（生成清单，全部用 `pnpm check:identity` 校验）：
 * - 本文件（PROJECT_NAME / PROJECT_SLUG / DEFAULT_TABLE_PREFIX）
 * - 根 package.json 的 name
 * - web/package.json 的 name
 * - worker/wrangler.toml 的 name
 * - README.md 标题与说明
 * - web/index.html 的 <title>
 *
 * 除此之外全仓不得再出现项目名/slug 字面量：界面展示名一律经 /api/public 取，
 * 前端不放第二份常量。
 */

/** 展示名（首页、关于页、页面标题）。 */
export const PROJECT_NAME = "Project Template"

/** 仓库名 / Worker 名（wrangler.toml 与 package.json 的 name）。 */
export const PROJECT_SLUG = "project-template"

/** 未配置 TABLE_PREFIX 时使用的默认前缀（不含尾部下划线，见 table-prefix.ts）。 */
export const DEFAULT_TABLE_PREFIX = "template"

/** 一句话说明（首页与「关于」页）。 */
export const PROJECT_TAGLINE =
  "WorkerHub 薄骨架：迁移、setup 与鉴权的最小实现。"

/**
 * 源码仓库地址（「关于」页的开源地址来源）。生成新项目时与上面几个令牌一起改。
 * 属身份单点内的常量，因此仍是唯一真源，前端不得再写一份。
 */
export const PROJECT_REPOSITORY_URL =
  "https://github.com/WorkerHub/project-template"

/**
 * 档位开关（规格 §6.4）：默认多用户档；置单人档只影响注册/初始化/开关展示，
 * 不长出第二套页面或第二套鉴权。本单只定义开关，行为由后续单接。
 */
export type AppMode = "multi" | "single"

export const APP_MODE: AppMode = "multi"

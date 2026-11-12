/**
 * 工作台壳：只有布局骨架（侧边栏 + 顶栏 + 内容区），不放任何占位文案。
 * 具体页面与导航项由前端单填进来。
 */
export function WorkbenchShell() {
  return (
    <div
      data-testid="workbench-shell"
      className="flex min-h-dvh bg-background text-foreground"
    >
      <aside className="hidden w-60 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex md:flex-col">
        <div className="h-14 shrink-0 border-b border-sidebar-border" />
        <nav className="flex-1 p-2" />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4" />
        <main className="flex-1 p-4" />
      </div>
    </div>
  )
}

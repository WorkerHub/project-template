import { BrowserRouter, Route, Routes } from "react-router"
import { WorkbenchShell } from "./components/WorkbenchShell"

/**
 * 路由骨架：本单只落一个空白工作台壳（侧边栏 + 顶栏 + 内容区），
 * 页面内容由前端单接在同样位置上。
 */
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="*" element={<WorkbenchShell />} />
      </Routes>
    </BrowserRouter>
  )
}

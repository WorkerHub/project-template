import "./index.css"
import "./i18n"
import { createRoot } from "react-dom/client"
import { App } from "./App"

const root = document.getElementById("root")
if (!root) throw new Error("Missing #root mount point")

createRoot(root).render(<App />)

import { expect, test } from "vitest"
import { render, screen } from "@testing-library/react"
import { App } from "./App"

test("工作台壳可以渲染", () => {
  render(<App />)
  expect(screen.getByTestId("workbench-shell")).toBeTruthy()
})

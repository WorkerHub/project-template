import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { AuthShell } from "@/components/auth-shell"
import { buildInfo } from "@/lib/build-info"
import { AboutPage } from "@/pages/about"
import { publicInfo } from "@/test/fixtures"
import { useSiteStore } from "@/stores/site"

describe("关于页", () => {
  it("版本号、构建日期/时间与页脚同源，仓库地址来自身份单点", () => {
    useSiteStore.setState({
      info: publicInfo({
        name: "Template",
        tagline: "A thin skeleton",
        repositoryUrl: "https://example.com/template"
      }),
      loaded: true
    })

    render(
      <>
        <AboutPage />
        <AuthShell title="x">y</AuthShell>
      </>
    )

    // 页脚与关于页都来自同一个构建常量
    expect(screen.getByText(buildInfo.version)).toBeInTheDocument()
    expect(
      screen.getByText(
        new RegExp(`· ${buildInfo.version.replace(/\./g, "\\.")}$`)
      )
    ).toBeInTheDocument()

    expect(screen.getByText("构建日期")).toBeInTheDocument()
    expect(screen.getByText("构建时间")).toBeInTheDocument()
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "https://example.com/template"
    )
  })
})

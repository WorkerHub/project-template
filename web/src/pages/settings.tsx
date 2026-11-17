import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PreferencesSection } from "@/pages/settings/preferences-section"
import { SecuritySection } from "@/pages/settings/security-section"

/** 设置页（技术方案 §5A.3）：安全与偏好两项；个人资料是独立页 `/profile`。 */
export function SettingsPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState("security")

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="security">
            {t("settings.tabs.security")}
          </TabsTrigger>
          <TabsTrigger value="preferences">
            {t("settings.tabs.preferences")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="security" className="pt-4">
          <SecuritySection />
        </TabsContent>
        <TabsContent value="preferences" className="pt-4">
          <PreferencesSection />
        </TabsContent>
      </Tabs>
    </div>
  )
}

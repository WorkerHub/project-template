import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PreferencesSection } from "@/pages/settings/preferences-section"
import { ProfileSection } from "@/pages/settings/profile-section"
import { SecuritySection } from "@/pages/settings/security-section"

/** 设置页（技术方案 §5A.3）：只放「当前用户本人」的三块。 */
export function SettingsPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState("profile")

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="profile">
            {t("settings.tabs.profile")}
          </TabsTrigger>
          <TabsTrigger value="security">
            {t("settings.tabs.security")}
          </TabsTrigger>
          <TabsTrigger value="preferences">
            {t("settings.tabs.preferences")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="pt-4">
          <ProfileSection />
        </TabsContent>
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

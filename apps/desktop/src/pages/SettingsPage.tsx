import { useSearchParams } from "react-router-dom";
import { SettingsContent } from "@/components/settings/SettingsContent";
import {
  resolveSettingsView,
  type SettingsViewId,
} from "@/lib/settings-views";

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const activeView = resolveSettingsView(params.get("tab"));

  function onViewChange(view: SettingsViewId) {
    setParams({ tab: view }, { replace: true });
  }

  return (
    <div className="settings-page-shell">
      <SettingsContent activeView={activeView} onViewChange={onViewChange} />
    </div>
  );
}

import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useSheetClose } from "@/components/shell/useSheetBackground";
import { SettingsOverlay } from "@/components/settings/SettingsOverlay";
import {
  resolveSettingsView,
  type SettingsViewId,
} from "@/lib/settings-views";

/**
 * The settings sheet, as the router sees it.
 *
 * The tab lives in the query string so a link can open one page of it
 * (`/settings?tab=domains`, which the old `/domains` route redirects to), and
 * closing goes *back* to the page the sheet was opened over rather than to a
 * fixed route: the sheet is a surface on top of the app, so leaving it should
 * put the operator back where they were. A cold start that opens `/settings`
 * directly has nowhere to go back to, so it falls through to the dashboard.
 */
export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const activeView = resolveSettingsView(params.get("tab"));
  const onClose = useSheetClose();

  const onViewChange = useCallback(
    (view: SettingsViewId) => {
      setParams({ tab: view }, { replace: true });
    },
    [setParams],
  );

  return (
    <SettingsOverlay
      activeView={activeView}
      onViewChange={onViewChange}
      onClose={onClose}
    />
  );
}

import { type ReactNode } from "react";
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { AppShell } from "@/components/shell/AppShell";
import { SplashGate } from "@/components/shell/SplashGate";
import { WindowTitleBar } from "@/components/shell/WindowTitleBar";
import { DoctrineEditorPage } from "@/components/doctrine/DoctrineEditorPage";
import ActPage from "@/pages/ActPage";
import AutomationsPage from "@/pages/AutomationsPage";
import DailyNotePage from "@/pages/DailyNotePage";
import DailySchedulePage from "@/pages/DailySchedulePage";
import ArchitecturePage from "@/pages/ArchitecturePage";
import ChainPage from "@/pages/ChainPage";
import ChartPage from "@/pages/ChartPage";
import DataPage from "@/pages/DataPage";
import DatabasePage from "@/pages/DatabasePage";
import PagesPage from "@/pages/PagesPage";
import PageCanvasPage from "@/pages/PageCanvasPage";
import DecisionsPage from "@/pages/DecisionsPage";
import DocumentsPage from "@/pages/DocumentsPage";
import DreamPage from "@/pages/DreamPage";
import VisionPage from "@/pages/VisionPage";
import IdealStatePage from "@/pages/IdealStatePage";
import ImagesPage from "@/pages/ImagesPage";
import GoalsPage from "@/pages/GoalsPage";
import ProjectPage from "@/pages/ProjectPage";
import ProjectsPage from "@/pages/ProjectsPage";
import HomePage from "@/pages/HomePage";
import LogPage from "@/pages/LogPage";
import PersonnelPage from "@/pages/PersonnelPage";
import SettingsPage from "@/pages/SettingsPage";
import ReviewPage from "@/pages/ReviewPage";
import WelcomePage from "@/pages/WelcomePage";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { CompanionSetupScreen } from "@/components/hermes/CompanionSetupScreen";
import { DecisionInboxAutoOpen } from "@/components/decisions/DecisionInboxAutoOpen";
import { useSheetBackground } from "@/components/shell/useSheetBackground";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { AutomationScheduler } from "@/state/AutomationScheduler";
import { NavDockProvider } from "@/state/NavDockProvider";
import { CompanionProvider, useCompanion } from "@/state/CompanionProvider";
import { LiveDataProvider } from "@/state/LiveDataProvider";
import { UpdateProvider } from "@/state/UpdateProvider";
import { UpdateNotice } from "@/components/shell/UpdateNotice";
import { VaultProvider, useVault } from "@/state/VaultProvider";

function RequireVault({ children }: { children: ReactNode }) {
  const { snapshot, booting } = useVault();
  const location = useLocation();

  if (booting) {
    return null;
  }

  if (!snapshot && location.pathname !== "/welcome") {
    return <Navigate to="/welcome" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  const { snapshot, booting } = useVault();
  const { status, ensuring } = useCompanion();
  /*
   * Settings and Decisions are sheets over the app, not pages of it (see
   * `SheetOverlay`), so the routes keep rendering the page the operator was on
   * while a sheet path is in the address bar, and the sheet is painted above it.
   */
  const { background, sheet, sheetOverBackground } = useSheetBackground();

  if (ensuring || !status || status.kind !== "ready") {
    return <CompanionSetupScreen />;
  }

  if (booting) {
    return null;
  }

  return (
    <>
      <Routes location={background}>
        <Route path="/welcome" element={<WelcomePage />} />
        <Route
          element={
            <RequireVault>
              <AppShell />
            </RequireVault>
          }
        >
          <Route path="/home" element={<HomePage />} />
          <Route path="/data" element={<DataPage />} />
          <Route path="/data/:slug/:dbId" element={<DatabasePage />} />
          <Route path="/pages" element={<PagesPage />} />
          <Route path="/pages/:slug/:pageId" element={<PageCanvasPage />} />
          <Route
            path="/domains"
            element={<Navigate to="/settings?tab=domains" replace />}
          />
          <Route path="/chain" element={<ChainPage />} />
          <Route path="/dream" element={<DreamPage />} />
          <Route
            path="/dream/:slug/:kind"
            element={<DoctrineEditorPage backTo="/dream" />}
          />
          <Route path="/vision" element={<VisionPage />} />
          <Route
            path="/vision/:slug/:kind"
            element={<DoctrineEditorPage backTo="/vision" />}
          />
          <Route path="/ideal-state" element={<IdealStatePage />} />
          <Route path="/images" element={<ImagesPage />} />
          <Route path="/goals" element={<GoalsPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:id" element={<ProjectPage />} />
          <Route path="/chart" element={<ChartPage />} />
          <Route path="/track" element={<ArchitecturePage />} />
          <Route
            path="/track/:slug/:kind"
            element={<DoctrineEditorPage backTo="/track" />}
          />
          <Route path="/act" element={<ActPage />} />
          <Route path="/notes" element={<DailyNotePage />} />
          <Route path="/automations" element={<AutomationsPage />} />
          <Route path="/daily" element={<DailySchedulePage />} />
          <Route path="/review/:cadence" element={<ReviewPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/decisions" element={<DecisionsPage />} />
          <Route path="/log" element={<LogPage />} />
          <Route path="/personnel" element={<PersonnelPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route
          path="/"
          element={<Navigate to={snapshot ? "/home" : "/welcome"} replace />}
        />
        <Route
          path="*"
          element={<Navigate to={snapshot ? "/home" : "/welcome"} replace />}
        />
      </Routes>
      {sheetOverBackground && sheet === "settings" ? <SettingsPage /> : null}
      {sheetOverBackground && sheet === "decisions" ? <DecisionsPage /> : null}
      {/* Inside the router and the vault, outside every page: a filing has to be
          able to open the inbox from wherever the operator happens to be, and
          the sheet it opens must sit over the page they were already reading. */}
      <DecisionInboxAutoOpen />
    </>
  );
}

export default function App() {
  // HashRouter works with file:// production loads (no server history API).
  return (
    <HashRouter>
      <ThemeProvider>
        {/* Above the companion gate on purpose: the launch's one update check
            runs whether or not a gateway is up, because a newer LifeQuest is
            news the operator wants before they go looking for why chat is
            quiet. */}
        <UpdateProvider>
          {/* The notice lives above every route and outside the vault gate: a
              release published while the operator is on the welcome screen is
              still news, and the dialog it opens needs only the update state. It
              portals to the body, so the shell's grid never clips it. */}
          <UpdateNotice />
          <CompanionProvider>
            <VaultProvider>
              {/* Inside the vault, outside every page: a card's numbers are a
                  function of the vault and the clock, and this is the one place
                  both are watched for the whole app. */}
              <LiveDataProvider>
                <AutomationScheduler />
                <SplashGate />
                <ChatDockProvider>
                  <NavDockProvider>
                    <div className="app-root">
                      <WindowTitleBar />
                      <div className="app-root__body">
                        <AppRoutes />
                      </div>
                    </div>
                  </NavDockProvider>
                </ChatDockProvider>
              </LiveDataProvider>
            </VaultProvider>
          </CompanionProvider>
        </UpdateProvider>
      </ThemeProvider>
    </HashRouter>
  );
}

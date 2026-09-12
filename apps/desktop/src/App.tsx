import type { ReactNode } from "react";
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
import ArchitecturePage from "@/pages/ArchitecturePage";
import ChainPage from "@/pages/ChainPage";
import ChartPage from "@/pages/ChartPage";
import DecisionsPage from "@/pages/DecisionsPage";
import DocumentsPage from "@/pages/DocumentsPage";
import DreamPage from "@/pages/DreamPage";
import GoalsPage from "@/pages/GoalsPage";
import HomePage from "@/pages/HomePage";
import LogPage from "@/pages/LogPage";
import PersonnelPage from "@/pages/PersonnelPage";
import SettingsPage from "@/pages/SettingsPage";
import StubPage from "@/pages/StubPage";
import WelcomePage from "@/pages/WelcomePage";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { CompanionSetupScreen } from "@/components/hermes/CompanionSetupScreen";
import { ChatDockProvider } from "@/state/ChatDockProvider";
import { CompanionProvider, useCompanion } from "@/state/CompanionProvider";
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

  if (ensuring || !status || status.kind !== "ready") {
    return <CompanionSetupScreen />;
  }

  if (booting) {
    return null;
  }

  return (
    <Routes>
      <Route path="/welcome" element={<WelcomePage />} />
      <Route
        element={
          <RequireVault>
            <AppShell />
          </RequireVault>
        }
      >
        <Route path="/home" element={<HomePage />} />
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
        <Route path="/goals" element={<GoalsPage />} />
        <Route path="/chart" element={<ChartPage />} />
        <Route path="/track" element={<ArchitecturePage />} />
        <Route
          path="/track/:slug/:kind"
          element={<DoctrineEditorPage backTo="/track" />}
        />
        <Route path="/act" element={<ActPage />} />
        <Route path="/review/daily" element={<StubPage title="Daily Review" />} />
        <Route path="/review/weekly" element={<StubPage title="Weekly Review" />} />
        <Route path="/review/monthly" element={<StubPage title="Monthly Review" />} />
        <Route path="/review/quarterly" element={<StubPage title="Quarterly Review" />} />
        <Route path="/review/yearly" element={<StubPage title="Yearly Review" />} />
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
  );
}

export default function App() {
  // HashRouter works with file:// production loads (no server history API).
  return (
    <HashRouter>
      <ThemeProvider>
        <CompanionProvider>
          <VaultProvider>
            <SplashGate />
            <ChatDockProvider>
              <div className="app-root">
                <WindowTitleBar />
                <div className="app-root__body">
                  <AppRoutes />
                </div>
              </div>
            </ChatDockProvider>
          </VaultProvider>
        </CompanionProvider>
      </ThemeProvider>
    </HashRouter>
  );
}

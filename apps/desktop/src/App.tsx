import type { ReactNode } from "react";
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { AppShell } from "@/components/shell/AppShell";
import ActPage from "@/pages/ActPage";
import ChainPage from "@/pages/ChainPage";
import DecisionsPage from "@/pages/DecisionsPage";
import DocumentsPage from "@/pages/DocumentsPage";
import DomainsPage from "@/pages/DomainsPage";
import HomePage from "@/pages/HomePage";
import LogPage from "@/pages/LogPage";
import PersonnelPage from "@/pages/PersonnelPage";
import RoomPage from "@/pages/RoomPage";
import SettingsPage from "@/pages/SettingsPage";
import WelcomePage from "@/pages/WelcomePage";
import { VaultProvider, useVault } from "@/state/VaultProvider";

function RequireVault({ children }: { children: ReactNode }) {
  const { snapshot, booting } = useVault();
  const location = useLocation();

  if (booting) {
    return (
      <main className="centered-status">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  if (!snapshot && location.pathname !== "/welcome") {
    return <Navigate to="/welcome" replace />;
  }

  return <>{children}</>;
}

function ShellRoute({ children }: { children: ReactNode }) {
  return (
    <RequireVault>
      <AppShell>{children}</AppShell>
    </RequireVault>
  );
}

function AppRoutes() {
  const { snapshot, booting } = useVault();

  if (booting) {
    return (
      <main className="centered-status">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  return (
    <Routes>
      <Route path="/welcome" element={<WelcomePage />} />
      <Route
        path="/home"
        element={
          <ShellRoute>
            <HomePage />
          </ShellRoute>
        }
      />
      <Route
        path="/domains"
        element={
          <ShellRoute>
            <DomainsPage />
          </ShellRoute>
        }
      />
      <Route
        path="/chain"
        element={
          <ShellRoute>
            <ChainPage />
          </ShellRoute>
        }
      />
      <Route
        path="/dream"
        element={
          <ShellRoute>
            <RoomPage room="dream" />
          </ShellRoute>
        }
      />
      <Route
        path="/chart"
        element={
          <ShellRoute>
            <RoomPage room="chart" />
          </ShellRoute>
        }
      />
      <Route
        path="/track"
        element={
          <ShellRoute>
            <RoomPage room="track" />
          </ShellRoute>
        }
      />
      <Route
        path="/act"
        element={
          <ShellRoute>
            <ActPage />
          </ShellRoute>
        }
      />
      <Route
        path="/documents"
        element={
          <ShellRoute>
            <DocumentsPage />
          </ShellRoute>
        }
      />
      <Route
        path="/decisions"
        element={
          <ShellRoute>
            <DecisionsPage />
          </ShellRoute>
        }
      />
      <Route
        path="/log"
        element={
          <ShellRoute>
            <LogPage />
          </ShellRoute>
        }
      />
      <Route
        path="/personnel"
        element={
          <ShellRoute>
            <PersonnelPage />
          </ShellRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ShellRoute>
            <SettingsPage />
          </ShellRoute>
        }
      />
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
      <VaultProvider>
        <AppRoutes />
      </VaultProvider>
    </HashRouter>
  );
}

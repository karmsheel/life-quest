import type { ReactNode } from "react";
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import WelcomePage from "@/pages/WelcomePage";
import { VaultProvider, useVault } from "@/state/VaultProvider";

/** Placeholder for routes that land in later tasks (shell, rooms, etc.). */
function StubPage({ title }: { title: string }) {
  const { snapshot, activeSlug } = useVault();
  return (
    <main className="app-shell">
      <h1>{title}</h1>
      <p className="muted">
        {snapshot
          ? `Vault: ${snapshot.lifequest.name} · Active: ${activeSlug ?? "—"}`
          : "No vault open"}
      </p>
    </main>
  );
}

function RequireVault({ children }: { children: ReactNode }) {
  const { snapshot, booting } = useVault();
  const location = useLocation();

  if (booting) {
    return (
      <main className="app-shell">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  if (!snapshot && location.pathname !== "/welcome") {
    return <Navigate to="/welcome" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  const { snapshot, booting } = useVault();

  if (booting) {
    return (
      <main className="app-shell">
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
          <RequireVault>
            <StubPage title="Home" />
          </RequireVault>
        }
      />
      <Route
        path="/domains"
        element={
          <RequireVault>
            <StubPage title="Domains" />
          </RequireVault>
        }
      />
      <Route
        path="/dream"
        element={
          <RequireVault>
            <StubPage title="Dream" />
          </RequireVault>
        }
      />
      <Route
        path="/chart"
        element={
          <RequireVault>
            <StubPage title="Chart" />
          </RequireVault>
        }
      />
      <Route
        path="/track"
        element={
          <RequireVault>
            <StubPage title="Track" />
          </RequireVault>
        }
      />
      <Route
        path="/act"
        element={
          <RequireVault>
            <StubPage title="Act" />
          </RequireVault>
        }
      />
      <Route
        path="/documents"
        element={
          <RequireVault>
            <StubPage title="Documents" />
          </RequireVault>
        }
      />
      <Route
        path="/decisions"
        element={
          <RequireVault>
            <StubPage title="Decisions" />
          </RequireVault>
        }
      />
      <Route
        path="/log"
        element={
          <RequireVault>
            <StubPage title="Log" />
          </RequireVault>
        }
      />
      <Route
        path="/personnel"
        element={
          <RequireVault>
            <StubPage title="Personnel" />
          </RequireVault>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireVault>
            <StubPage title="Settings" />
          </RequireVault>
        }
      />
      <Route
        path="/"
        element={
          <Navigate to={snapshot ? "/home" : "/welcome"} replace />
        }
      />
      <Route
        path="*"
        element={
          <Navigate to={snapshot ? "/home" : "/welcome"} replace />
        }
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

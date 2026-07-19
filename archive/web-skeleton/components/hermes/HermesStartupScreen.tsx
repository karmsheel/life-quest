"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Plug } from "lucide-react";
import { loadHermesConfig } from "@/lib/hermes-storage.ts";
import { safeInternalPath } from "@/lib/safe-redirect.ts";
import { GatewayConnectingOverlay } from "./GatewayConnectingOverlay";
import { HermesConnectionErrorModal } from "./HermesConnectionErrorModal";
import { HermesSplashScreen } from "./HermesSplashScreen";
import { useHermesConnection } from "./HermesConnectionProvider";

const SPLASH_MS = 3000;

type StartupPhase = "splash" | "connecting" | "idle" | "leaving";

export function HermesStartupScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = safeInternalPath(searchParams.get("from"));
  const { isConnected, isBusy, autoConnect, setupApiServer, restartGateway, status } =
    useHermesConnection();

  const hadSavedConfig = useRef(false);
  const splashDone = useRef(false);
  const autoConnectStarted = useRef(false);
  const autoConnectErrorShown = useRef(false);

  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<StartupPhase>("splash");
  const [splashLeaving, setSplashLeaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [errorModalOpen, setErrorModalOpen] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    hadSavedConfig.current = Boolean(loadHermesConfig());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || splashDone.current) return;

    let leaveTimer: number | undefined;
    const timer = window.setTimeout(() => {
      splashDone.current = true;
      setSplashLeaving(true);
      leaveTimer = window.setTimeout(() => {
        setSplashLeaving(false);
        setPhase(hadSavedConfig.current ? "connecting" : "idle");
      }, 520);
    }, SPLASH_MS);

    return () => {
      window.clearTimeout(timer);
      if (leaveTimer !== undefined) window.clearTimeout(leaveTimer);
    };
  }, [mounted]);

  useEffect(() => {
    if (phase === "splash" || phase === "leaving") return;

    if (hadSavedConfig.current && !autoConnectStarted.current) {
      autoConnectStarted.current = true;
      setPhase("connecting");
    }
  }, [phase]);

  useEffect(() => {
    if (isBusy && (phase === "idle" || phase === "connecting")) {
      setPhase("connecting");
    }
  }, [isBusy, phase]);

  const refreshDiscovery = useCallback(async () => {
    try {
      const res = await fetch("/api/hermes/discover", { method: "POST" });
      const data = await res.json();
      setHasApiKey(Boolean(data.hasApiKey));
      return data;
    } catch {
      setHasApiKey(null);
      return null;
    }
  }, []);

  useEffect(() => {
    if (!splashDone.current || phase === "splash" || phase === "leaving") return;

    if (isConnected) {
      setErrorModalOpen(false);
      setPhase("leaving");
      return;
    }

    // Returning users with saved config: after auto-connect settles on error,
    // open the error modal once so they get setup/restart (not blank idle only).
    if (
      hadSavedConfig.current &&
      !isBusy &&
      !isConnected &&
      status.state === "error" &&
      !autoConnectErrorShown.current
    ) {
      autoConnectErrorShown.current = true;
      void refreshDiscovery();
      setErrorModalOpen(true);
      setPhase("idle");
      return;
    }

    if (phase !== "connecting") return;

    if (!isBusy && !isConnected) {
      setPhase("idle");
    }
  }, [isBusy, isConnected, phase, refreshDiscovery, status.state]);
  const handleExitComplete = useCallback(() => {
    void (async () => {
      // After Hermes connects: skip sign-in when a session already exists.
      try {
        const res = await fetch("/api/auth/me", { credentials: "same-origin" });
        const data = await res.json().catch(() => ({}));
        if (data?.user) {
          router.push(redirectTo);
          return;
        }
      } catch {
        /* fall through to sign-in */
      }

      const dest = `/sign-in?from=${encodeURIComponent(redirectTo)}`;
      router.push(dest);
    })();
  }, [redirectTo, router]);

  async function handleConnect() {
    setErrorModalOpen(false);
    setActionMessage(null);
    setConnecting(true);
    setPhase("connecting");

    let connected = false;
    try {
      connected = await autoConnect();
    } finally {
      setConnecting(false);
    }

    if (!connected) {
      await refreshDiscovery();
      setErrorModalOpen(true);
    }
  }

  async function handleSetupApiServer() {
    setSettingUp(true);
    setActionMessage(null);
    try {
      const result = await setupApiServer();
      if (result.ok) {
        setHasApiKey(true);
        setActionMessage(result.message || "API server settings updated.");
        if (result.gatewayReachable) {
          setErrorModalOpen(false);
        }
      } else {
        setActionMessage(result.error || result.message || "API server setup failed.");
      }
    } finally {
      setSettingUp(false);
    }
  }

  async function handleRestartGateway() {
    setRestarting(true);
    setActionMessage(null);
    try {
      const result = await restartGateway();
      if (result.ok) {
        setActionMessage(result.message || "Gateway restarted.");
        setErrorModalOpen(false);
      } else {
        setActionMessage(result.error || result.message || "Gateway restart failed.");
      }
    } finally {
      setRestarting(false);
    }
  }

  if (!mounted) {
    return <HermesSplashScreen />;
  }

  if (phase === "splash") {
    return <HermesSplashScreen leaving={splashLeaving} />;
  }

  if (phase === "connecting" || phase === "leaving") {
    return (
      <>
        <GatewayConnectingOverlay
          leaving={phase === "leaving"}
          onExitComplete={handleExitComplete}
        />
        <HermesConnectionErrorModal
          open={errorModalOpen}
          onClose={() => setErrorModalOpen(false)}
          error={status.error}
          kind={status.kind}
          hasApiKey={hasApiKey}
          settingUp={settingUp}
          restarting={restarting}
          actionMessage={actionMessage}
          onEnableApiServer={() => void handleSetupApiServer()}
          onRestartGateway={() => void handleRestartGateway()}
        />
      </>
    );
  }

  return (
    <>
      <div className="hermes-startup">
        <div className="hermes-startup__card">
          <div className="hermes-startup__brand">
            <div className="hermes-startup__mark" aria-hidden="true">
              LQ
            </div>
            <span className="hermes-startup__brand-name">LifeQuest</span>
          </div>

          <p className="hermes-startup__eyebrow">Hermes Agent</p>

          <h1 className="hermes-startup__title">Connect to Hermes</h1>
          <p className="hermes-startup__copy">
            LifeQuest runs on your machine and talks to a local Hermes gateway — connect once on
            startup, then sign in to continue.
          </p>

          <button
            type="button"
            onClick={() => void handleConnect()}
            disabled={connecting || isBusy}
            className="hermes-startup__connect"
          >
            {connecting || isBusy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Plug className="w-4 h-4" />
                Connect to Hermes
              </>
            )}
          </button>

          <p className="hermes-startup__hint">
            Make sure Hermes Agent is installed locally. If connection fails, we will help you
            enable the API server and restart the gateway.
          </p>
        </div>
      </div>

      <HermesConnectionErrorModal
        open={errorModalOpen}
        onClose={() => setErrorModalOpen(false)}
        error={status.error}
        kind={status.kind}
        hasApiKey={hasApiKey}
        settingUp={settingUp}
        restarting={restarting}
        actionMessage={actionMessage}
        onEnableApiServer={() => void handleSetupApiServer()}
        onRestartGateway={() => void handleRestartGateway()}
      />
    </>
  );
}

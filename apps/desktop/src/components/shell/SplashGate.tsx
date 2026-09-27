import { useEffect, useRef } from "react";
import { useCompanion } from "@/state/CompanionProvider";
import { useVault } from "@/state/VaultProvider";
import { shouldHoldSplash } from "./splashHold.ts";

const FADE_MS = 200;

export function SplashGate() {
  const { booting } = useVault();
  const { status, ensuring } = useCompanion();
  const dismissed = useRef(false);

  useEffect(() => {
    const el = document.getElementById("splash");
    if (!el || dismissed.current) return;

    const t0 = window.__LQ_SPLASH_T0 ?? performance.now();
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;

    const dismiss = () => {
      if (dismissed.current) return;
      dismissed.current = true;
      el.classList.add("splash--out");
      hideTimer = setTimeout(() => {
        el.setAttribute("hidden", "");
        el.classList.add("splash--done");
      }, FADE_MS);
      if (poll) clearInterval(poll);
    };

    const tick = () => {
      const hold = shouldHoldSplash({
        elapsedMs: performance.now() - t0,
        booting,
        ensuring,
        kind: status?.kind,
      });
      if (!hold) dismiss();
    };

    poll = setInterval(tick, 50);
    tick();
    return () => {
      if (poll) clearInterval(poll);
      if (hideTimer) clearTimeout(hideTimer);
      // A later boot update cleans this effect up before the fade timer
      // fires. The dismiss already happened, so hide now instead of leaving
      // the splash up with no second chance.
      if (dismissed.current) {
        el.setAttribute("hidden", "");
        el.classList.add("splash--done");
      }
    };
  }, [booting, ensuring, status?.kind]);

  return null;
}

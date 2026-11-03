import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useVault } from "@/state/VaultProvider";
import { VaultSwitcherDialog } from "./VaultSwitcherDialog";
import { vaultInitials, vaultTitleName, windowTitleLabel } from "./window-title";

/**
 * The vault's own chip, at the foot of the rail.
 *
 * It names the open vault and is the one control that changes it. It used to sit
 * in the titlebar, at the top-left of the window; there it was chrome living
 * beside the rail's toggle and, once the rail collapsed, the re-open control
 * landed on top of it. Living in the sidebar's foot instead, it travels with the
 * navigation it belongs to: the wide rail gives it half the bottom row beside the
 * Log, and the thin rail keeps its mark in the column below the Log's icon.
 *
 * The dialog is a portal on `document.body`; the rail clips at its own edges, so
 * a popup left inside it would be cut off. Focus goes back to the chip when the
 * dialog closes — Escape, the scrim, a completed switch or a refusal — because a
 * dialog that hands focus to <body> strands a keyboard operator at the top of
 * the page.
 */
export function VaultChip() {
  const { snapshot } = useVault();
  const vaultName = vaultTitleName(snapshot?.lifequest.name);
  const initials = vaultInitials(snapshot?.lifequest.name);
  const label = windowTitleLabel(snapshot?.lifequest.name);
  const [open, setOpen] = useState(false);
  const chipRef = useRef<HTMLButtonElement>(null);
  /*
   * Whether the switcher has really been open, so the chip does not grab the
   * focus on first paint. It is state, not a ref to the open flag: the effect
   * below must also see the mount where the switcher was never up.
   */
  const wasOpen = useRef(false);

  useEffect(() => {
    if (wasOpen.current && !open) chipRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  return (
    <>
      <button
        ref={chipRef}
        type="button"
        className="nav-rail__vault"
        title="Switch vault"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span className="nav-rail__vault-name">{vaultName}</span>
        {/*
          The caret is the chip's own "this opens something" mark; it is laid at
          the trailing edge so the name can ellipsize against it rather than
          shoving it out of the chip.
        */}
        <ChevronDown
          className="nav-rail__vault-chevron"
          size={12}
          aria-hidden
        />
        {/*
          The icon rail's mark: the initials, never the full name. The accessible
          name above stays the full vault name, so a screen reader is not left
          reading one letter; only the paint is reduced.
        */}
        <span className="nav-rail__vault-initials" aria-hidden>
          {initials}
        </span>
      </button>
      <VaultSwitcherDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

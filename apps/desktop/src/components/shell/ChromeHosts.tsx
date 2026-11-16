import { useTheme } from "@/components/theme/ThemeProvider";
import { DomainSwitcher } from "./DomainSwitcher";
import { WingTabs } from "./WingTabs";

/**
 * The shell's chrome, wherever the worn theme says it goes.
 *
 * The rail and the titlebar own the two default homes (the rail's top band and
 * the lens centred in the strip). Every other placement is painted here, over
 * the shell, so a theme can move the wing and area switchers without either
 * component learning about themes at all.
 */
export function ChromeHosts() {
  const { chrome } = useTheme();

  return (
    <>
      {chrome.wingSwitcher.place === "titlebar-left" ? (
        <div
          className="chrome-bar chrome-bar--titlebar-left"
          data-chrome-slot="wing"
          data-chrome-place="titlebar-left"
        >
          <WingTabs variant={chrome.wingSwitcher.variant} />
        </div>
      ) : null}

      {chrome.wingSwitcher.place === "floating-left" ? (
        <div
          className="chrome-floating chrome-floating--wing"
          data-chrome-slot="wing"
          data-chrome-place="floating-left"
        >
          <WingTabs variant={chrome.wingSwitcher.variant} />
        </div>
      ) : null}

      {chrome.domainSwitcher.place === "below-titlebar" ? (
        <div
          className="chrome-bar chrome-bar--below-titlebar"
          data-chrome-slot="domain"
          data-chrome-place="below-titlebar"
        >
          <DomainSwitcher variant={chrome.domainSwitcher.variant} />
        </div>
      ) : null}

      {chrome.domainSwitcher.place === "bottom-center" ? (
        <div
          className="chrome-dock chrome-dock--bottom"
          data-chrome-slot="domain"
          data-chrome-place="bottom-center"
        >
          <DomainSwitcher variant={chrome.domainSwitcher.variant} />
        </div>
      ) : null}

      {chrome.domainSwitcher.place === "floating-bottom-right" ? (
        <div
          className="chrome-dock chrome-dock--floating"
          data-chrome-slot="domain"
          data-chrome-place="floating-bottom-right"
        >
          <DomainSwitcher variant={chrome.domainSwitcher.variant} />
        </div>
      ) : null}
    </>
  );
}

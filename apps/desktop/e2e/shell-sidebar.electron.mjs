/**
 * Drives the shell sidebar harness in a real Electron window and turns the
 * measurements into `e2e/artifacts/shell-sidebar.{json,png}`.
 *
 * Run with the dev server up (`npm run dev`):
 *
 *   node e2e/shell-sidebar.electron.mjs
 *
 * Exit code 0 = every invariant held. The JSON report is the repeatable
 * artifact: same command, same numbers, no eyeballing the app required. It carries
 * the colour ladder too — night and day, surface ink and luminance — so the
 * "darkest page canvas" claim is a number in a file, not a screenshot to squint at.
 *
 * NOT covered here: whether Windows lets the click through the titlebar's drag
 * band. Synthetic DOM clicks bypass the OS hit test, so the `-webkit-app-region:
 * no-drag` carve-out on the toggle can only be confirmed by clicking it in the
 * real window. Nothing asserts that carve-out any more — the source-text
 * contract that read it out of the CSS went with the unit tests.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

// An occluded window stops painting, and a window that stops painting stops
// firing requestAnimationFrame: a rig that waits on a frame then hangs until its
// watchdog instead of failing, and reports only which step it was on. A rig runs
// hidden beside every other rig in the suite, so it has to keep painting.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/shell-sidebar.html";
const DEFAULT_SIZE = { width: 1280, height: 900 };

const SAMPLE = `(() => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: Math.round(r.left),
      top: Math.round(r.top),
      right: Math.round(r.right),
      bottom: Math.round(r.bottom),
      width: Math.round(r.width),
      height: Math.round(r.height)
    };
  };
  const px = (value) => Math.round(parseFloat(value) || 0);
  const root = getComputedStyle(document.documentElement);
  const rail = document.querySelector(".nav-rail");
  const header = document.querySelector(".nav-rail__header");
  const controls = header
    ? Array.from(header.querySelectorAll("button, a, input, select, [role=button]"))
    : [];
  const titlebar = document.querySelector(".window-titlebar");
  const leading = document.querySelector(".window-titlebar__leading");
  // Round 2: the vault chip left the titlebar for the rail's foot. The old
  // selector is queried only to prove that nothing renders it any more.
  const titlebarVault = document.querySelector(".window-titlebar__vault");
  const railVault = document.querySelector(".nav-rail__vault");
  const foot = document.querySelector('.nav-rail__foot[data-nav-group="footer"]');
  const railToggle = document.querySelector(".nav-rail .nav-toggle");
  // The reported bug's second toggle: queried only to prove that it no longer
  // exists in EITHER state — the rail keeps its own toggle in its header.
  const titlebarToggle = document.querySelector(".window-titlebar__nav-toggle");
  const chats = document.querySelector(".chats-rail");
  // The divider directly above the chats: it belongs to the wide rail's middle
  // section and must leave with it when the rail narrows.
  const chatsDivider = document.querySelector(".nav-rail__divider--chats");
  // Every text label in the rail, and every row that carries one. A thin rail
  // hides the labels; it must not hide the rows, their icons or their names.
  const railLabels = Array.from(document.querySelectorAll(".nav-rail__label"));
  const navRows = Array.from(document.querySelectorAll(".nav-rail__link"));
  const main = document.querySelector(".shell__main");
  const chat = document.querySelector(".chat-panel");
  const dockActions = document.querySelector(".chat-panel__actions");
  const topBar = document.querySelector(".top-bar");
  const chatHeader = document.querySelector(".chat-panel__header");
  const shell = document.querySelector(".shell");
  const wings = document.querySelector(".nav-rail__wings");
  const wingsBand = document.querySelector(".nav-rail__wings-band");
  const wingRows = document.querySelector(".nav-rail__section--wing");
  const domainSwitcher = document.querySelector(".domain-switcher");
  const titlebarHeight = px(root.getPropertyValue("--window-titlebar-height"));

  // The accent ink the chip wears, read through a probe so a color-mix() or a
  // skin-specific serialisation still compares as the computed colour.
  const colorProbe = document.createElement("span");
  colorProbe.style.cssText = "position:absolute;left:-9999px;top:0";
  colorProbe.style.color = "var(--accent)";
  document.body.appendChild(colorProbe);
  const accent = getComputedStyle(colorProbe).color;
  colorProbe.remove();

  // Read a track width from a token rather than assuming a pixel value: the rail
  // is 16rem wide when expanded and one icon column (3.5rem) when collapsed, and
  // the rig names the column the shell actually gave it. A hard-coded 56 here
  // would pass even if the CSS never read the collapsed token.
  const measure = (width) => {
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;left:-9999px;top:0;height:0;width:" + width;
    document.body.appendChild(probe);
    const value = probe.offsetWidth;
    probe.remove();
    return value;
  };
  const track = measure("var(--shell-nav-width)");
  const collapsedTrack = measure("var(--shell-nav-width-collapsed)");

  // Who owns the window's top-left corner right now: the point titlebar text
  // would collide with if nothing had stepped aside. Measured at the CURRENT
  // rail's half-width — a thin rail is only 56px wide, so the expanded track's
  // midpoint would land in the sheet and read the wrong pane.
  const railBoxNow = rail ? rail.getBoundingClientRect() : null;
  const cornerEl = document.elementFromPoint(
    Math.round((railBoxNow ? railBoxNow.width : track) / 2),
    Math.round(titlebarHeight / 2)
  );

  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    tokens: {
      track,
      collapsedTrack,
      frame: px(root.getPropertyValue("--shell-frame")),
      titlebarHeight,
      radiusSm: root.getPropertyValue("--radius-sm").trim()
    },
    theme: {
      dataTheme: document.documentElement.getAttribute("data-theme"),
      skin: document.documentElement.getAttribute("data-skin"),
      canvasBase: root.getPropertyValue("--canvas-base").trim(),
      accent,
      titlebarBg: root.getPropertyValue("--titlebar-bg").trim(),
      background: root.getPropertyValue("--background").trim(),
      card: root.getPropertyValue("--card").trim(),
      bgPanel: root.getPropertyValue("--bg-panel").trim(),
      mutedSurface: root.getPropertyValue("--muted-surface").trim()
    },
    cards: Object.fromEntries(
      Array.from(document.querySelectorAll("[data-probe]")).map((el) => [
        el.getAttribute("data-probe"),
        getComputedStyle(el).backgroundColor
      ])
    ),
    dockActions: dockActions
      ? getComputedStyle(dockActions).backgroundColor
      : null,
    rail: rail
      ? {
          box: box(rail),
          marginTop: getComputedStyle(rail).marginTop,
          marginLeft: getComputedStyle(rail).marginLeft,
          marginBottom: getComputedStyle(rail).marginBottom,
          borderRightWidth: getComputedStyle(rail).borderRightWidth,
          borderTopWidth: getComputedStyle(rail).borderTopWidth,
          borderBottomWidth: getComputedStyle(rail).borderBottomWidth,
          borderLeftWidth: getComputedStyle(rail).borderLeftWidth,
          borderRadius: getComputedStyle(rail).borderRadius,
          background: getComputedStyle(rail).backgroundColor,
          backdropFilter: getComputedStyle(rail).backdropFilter,
          scrollTop: rail.scrollTop,
          scrollHeight: rail.scrollHeight,
          clientHeight: rail.clientHeight
        }
      : null,
    railDisplay: rail ? getComputedStyle(rail).display : null,
    header: header
      ? {
          box: box(header),
          background: getComputedStyle(header).backgroundColor,
          appRegion: getComputedStyle(header).getPropertyValue("-webkit-app-region"),
          controls: controls.map((el) => ({
            tag: el.tagName.toLowerCase(),
            label: el.getAttribute("aria-label"),
            title: el.getAttribute("title")
          }))
        }
      : null,
    railToggle: railToggle
      ? {
          label: railToggle.getAttribute("aria-label"),
          box: box(railToggle),
          // The rail's toggle is the only collapse control at either width, so
          // its own state pair is measured rather than a titlebar stand-in's.
          ariaExpanded: railToggle.getAttribute("aria-expanded"),
          ariaControls: railToggle.getAttribute("aria-controls"),
          // Lucide names the icon in the svg's class list, so the expand/collapse
          // pair is read off the shipping icon and not inferred from the label.
          icon: (() => {
            const svg = railToggle.querySelector("svg");
            return svg ? svg.getAttribute("class") || "" : null;
          })(),
          appRegion: getComputedStyle(railToggle).getPropertyValue("-webkit-app-region")
        }
      : null,
    titlebarToggle: titlebarToggle
      ? {
          label: titlebarToggle.getAttribute("aria-label"),
          box: box(titlebarToggle)
        }
      : null,
    titlebarClass: titlebar ? titlebar.className : null,
    firstLink: box(document.querySelector(".nav-rail__link")),
    wingSection: box(document.querySelector(".nav-rail__section--wing")),
    bottomSection: box(document.querySelector(".nav-rail__section--bottom")),
    titlebar: box(titlebar),
    leading: box(leading),
    // Negative regression claim: the chip is not in the titlebar any more.
    titlebarVault: titlebarVault
      ? { box: box(titlebarVault), text: (titlebarVault.textContent || "").trim() }
      : null,
    // The rail's foot: the Log row and the vault chip on one line when the rail
    // is wide, stacked when it is thin.
    foot: foot
      ? {
          box: box(foot),
          display: getComputedStyle(foot).display,
          flexDirection: getComputedStyle(foot).flexDirection,
          children: Array.from(foot.children).map((el) => ({
            tag: el.tagName.toLowerCase(),
            className: typeof el.className === "string" ? el.className : "",
            box: box(el)
          })),
          logRow: box(foot.querySelector(".nav-rail__link"))
        }
      : null,
    // The vault chip's new home. Every claim the titlebar chip used to carry is
    // made here instead: its full name, its accent fill, its dialog, and — in
    // the thin rail — the initials-only mark that keeps it in the icon column.
    vaultChip: railVault
      ? {
          box: box(railVault),
          tag: railVault.tagName.toLowerCase(),
          title: railVault.getAttribute("title"),
          ariaLabel: railVault.getAttribute("aria-label"),
          haspopup: railVault.getAttribute("aria-haspopup"),
          ariaExpanded: railVault.getAttribute("aria-expanded"),
          background: getComputedStyle(railVault).backgroundColor,
          color: getComputedStyle(railVault).color,
          radius: getComputedStyle(railVault).borderRadius,
          name: (() => {
            const el = railVault.querySelector(".nav-rail__vault-name");
            return el
              ? { text: (el.textContent || "").trim(), display: getComputedStyle(el).display }
              : null;
          })(),
          initials: (() => {
            const el = railVault.querySelector(".nav-rail__vault-initials");
            return el
              ? { text: (el.textContent || "").trim(), display: getComputedStyle(el).display }
              : null;
          })(),
          chevronDisplay: (() => {
            const el = railVault.querySelector(".nav-rail__vault-chevron");
            return el ? getComputedStyle(el).display : null;
          })(),
          inRail: Boolean(rail && rail.contains(railVault)),
          inFoot: Boolean(foot && foot.contains(railVault)),
          // The chip is the last visible control in the rail: no button or link
          // after it may still be on screen. That is what makes it the foot.
          isLastControl: (() => {
            if (!rail) return false;
            const visible = Array.from(
              rail.querySelectorAll("button, a, [role=button]")
            ).filter((el) => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0;
            });
            return visible.length > 0 && visible[visible.length - 1] === railVault;
          })()
        }
      : null,
    legacyBrand: Boolean(
      document.querySelector(".window-titlebar__brand") ||
        document.querySelector(".window-titlebar__logo") ||
        document.querySelector(".window-titlebar__label")
    ),
    leadingText: (leading?.textContent || "").trim(),
    // Which arrangement the shell is in, and the tracks it actually laid out:
    // the collapse narrows the first track, it does not remove a pane.
    shellClass: shell ? shell.className : null,
    shellNavCollapsed: Boolean(shell?.classList.contains("shell--nav-collapsed")),
    titlebarBackground: titlebar
      ? getComputedStyle(titlebar).backgroundColor
      : null,
    // The chats section, inside the one wide sidebar: between the wing's rows
    // and the governed shelf at the foot. A thin rail hides the whole section —
    // and the divider above it — rather than squeezing it into the icon column.
    chats: chats
      ? {
          box: box(chats),
          display: getComputedStyle(chats).display,
          inRail: Boolean(rail && rail.contains(chats)),
          title: (chats.querySelector(".chats-rail__title")?.textContent || "").trim(),
          newChat: Boolean(chats.querySelector(".chats-rail__new")),
          scrollRegion: getComputedStyle(chats.querySelector(".chats-rail__list")).overflowY
        }
      : null,
    chatsDivider: chatsDivider
      ? {
          display: getComputedStyle(chatsDivider).display,
          box: box(chatsDivider)
        }
      : null,
    // The rail's text labels and its rows. The collapse hides the labels and
    // keeps the rows, so both are measured separately: a rail that hid the rows
    // too would leave an empty column and still pass a label-only claim.
    railLabels: {
      count: railLabels.length,
      display: railLabels.length ? getComputedStyle(railLabels[0]).display : null
    },
    railRows: navRows.map((row) => {
      const label = row.querySelector(".nav-rail__label");
      const svg = row.querySelector("svg");
      return {
        title: row.getAttribute("title"),
        ariaLabel: row.getAttribute("aria-label"),
        label: (label?.textContent || "").trim(),
        labelDisplay: label ? getComputedStyle(label).display : null,
        icon: svg ? svg.getAttribute("class") || "" : null,
        iconBox: box(svg),
        badge: Boolean(row.querySelector(".nav-rail__badge")),
        justifyContent: getComputedStyle(row).justifyContent,
        box: box(row)
      };
    }),
    main: box(main),
    mainBackground: main ? getComputedStyle(main).backgroundColor : null,
    topBar: topBar
      ? {
          box: box(topBar),
          borderBottomWidth: getComputedStyle(topBar).borderBottomWidth,
          borderBottomColor: getComputedStyle(topBar).borderBottomColor,
          background: getComputedStyle(topBar).backgroundColor
        }
      : null,
    // The sheet's band now carries one selector only — the domain lens — and the
    // band centres it. The wing switcher moved to the rail's own band above it,
    // so this list is the lens alone. Measured by selector rather than by a
    // single class so the report names the control that regressed.
    topBarSelectors: [".domain-switcher__tabs"].map((selector) => {
      const el = document.querySelector(selector);
      if (!el) return { selector, optionCount: 0 };
      const style = getComputedStyle(el);
      const active = el.querySelector(".ui-segmented__option.is-active");
      return {
        selector,
        borderTopWidth: style.borderTopWidth,
        borderRightWidth: style.borderRightWidth,
        borderBottomWidth: style.borderBottomWidth,
        borderLeftWidth: style.borderLeftWidth,
        background: style.backgroundColor,
        activeBorderWidth: active ? getComputedStyle(active).borderTopWidth : null,
        activeBackground: active
          ? getComputedStyle(active).backgroundColor
          : null,
        optionCount: el.querySelectorAll(".ui-segmented__option").length
      };
    }),
    // One control on the sheet's band, and it is the domain lens — the wing
    // switcher must not have left a copy behind in the sheet.
    bandControlCount: topBar
      ? topBar.querySelectorAll(".ui-segmented").length
      : 0,
    domainLens: domainSwitcher
      ? {
          box: box(domainSwitcher),
          labels: Array.from(
            domainSwitcher.querySelectorAll(".ui-segmented__option")
          ).map((el) => (el.textContent || "").trim())
        }
      : null,
    // The rail's first level: the five-wing switcher, in a band of its own above
    // the active wing's pages. Wide, the band sits on the sheet's top-bar row and
    // the control is horizontal; thin, the control turns vertical and stays in the
    // icon column — the wings must never leave the operator's reach.
    wingsBand: wingsBand
      ? {
          box: box(wingsBand),
          display: getComputedStyle(wingsBand).display,
          borderBottomWidth: getComputedStyle(wingsBand).borderBottomWidth
        }
      : null,
    wingSwitcher: wings
      ? {
          box: box(wings),
          inRail: Boolean(rail && rail.contains(wings)),
          role: wings.getAttribute("role"),
          ariaLabel: wings.getAttribute("aria-label"),
          labels: Array.from(
            wings.querySelectorAll(".ui-segmented__option")
          ).map((el) => (el.textContent || "").trim()),
          active:
            (
              wings.querySelector(".ui-segmented__option.is-active")
                ?.textContent || ""
            ).trim() || null,
          optionCount: wings.querySelectorAll(".ui-segmented__option").length,
          // The collapsed band turns the segmented control vertical; the option
          // boxes prove the five tabs really stack in the icon column rather
          // than merely having a column flex-direction.
          flexDirection: getComputedStyle(wings).flexDirection,
          // The switcher is a square block set inside the rail's own padding, and
          // its options must not crowd their words: both are read off the
          // shipping control rather than inferred from the stylesheet.
          borderRadius: getComputedStyle(wings).borderRadius,
          padding: (() => {
            const style = getComputedStyle(wings);
            return {
              top: parseFloat(style.paddingTop),
              right: parseFloat(style.paddingRight),
              bottom: parseFloat(style.paddingBottom),
              left: parseFloat(style.paddingLeft)
            };
          })(),
          options: Array.from(
            wings.querySelectorAll(".ui-segmented__option")
          ).map((el) => {
            const style = getComputedStyle(el);
            return {
              label: (el.textContent || "").trim(),
              active: el.classList.contains("is-active"),
              box: box(el),
              borderRadius: style.borderRadius,
              padding: {
                top: parseFloat(style.paddingTop),
                right: parseFloat(style.paddingRight),
                bottom: parseFloat(style.paddingBottom),
                left: parseFloat(style.paddingLeft)
              },
              // A word wider than the option's content box overflows its rule;
              // the numbers say whether the label really fits.
              scrollWidth: el.scrollWidth,
              clientWidth: el.clientWidth
            };
          }),
          background: getComputedStyle(wings).backgroundColor
        }
      : null,
    wingRows: wingRows
      ? Array.from(wingRows.querySelectorAll(".nav-rail__link")).map((a) => ({
          label: (a.querySelector(".nav-rail__label")?.textContent || "").trim(),
          href: a.getAttribute("href"),
          active: a.classList.contains("nav-rail__link--active")
        }))
      : [],
    chatHeader: chatHeader
      ? {
          box: box(chatHeader),
          borderBottomWidth: getComputedStyle(chatHeader).borderBottomWidth,
          borderBottomColor: getComputedStyle(chatHeader).borderBottomColor,
          background: getComputedStyle(chatHeader).backgroundColor
        }
      : null,
    sheet: main
      ? {
          box: box(main),
          borderRadius: getComputedStyle(main).borderRadius,
          borderTopLeftRadius: getComputedStyle(main).borderTopLeftRadius,
          borderTopRightRadius: getComputedStyle(main).borderTopRightRadius,
          borderBottomRightRadius: getComputedStyle(main).borderBottomRightRadius,
          borderBottomLeftRadius: getComputedStyle(main).borderBottomLeftRadius,
          borderTopWidth: getComputedStyle(main).borderTopWidth,
          borderRightWidth: getComputedStyle(main).borderRightWidth,
          borderBottomWidth: getComputedStyle(main).borderBottomWidth,
          borderLeftWidth: getComputedStyle(main).borderLeftWidth,
          background: getComputedStyle(main).backgroundColor,
          boxShadow: getComputedStyle(main).boxShadow
        }
      : null,
    chat: chat
      ? {
          box: box(chat),
          borderRadius: getComputedStyle(chat).borderRadius,
          borderTopWidth: getComputedStyle(chat).borderTopWidth,
          borderRightWidth: getComputedStyle(chat).borderRightWidth,
          borderBottomWidth: getComputedStyle(chat).borderBottomWidth,
          borderLeftWidth: getComputedStyle(chat).borderLeftWidth,
          background: getComputedStyle(chat).backgroundColor,
          backdropFilter: getComputedStyle(chat).backdropFilter,
          boxShadow: getComputedStyle(chat).boxShadow,
          marginRight: getComputedStyle(chat).marginRight,
          marginBottom: getComputedStyle(chat).marginBottom
        }
      : null,
    shell: shell
      ? {
          className: shell.className,
          gridTemplateColumns: getComputedStyle(shell).gridTemplateColumns,
          // The first track as laid out. The collapse must change THIS number
          // from the expanded track to the icon column, and leave the others.
          gridColumns: getComputedStyle(shell).gridTemplateColumns
            .split(" ")
            .filter(Boolean)
            .map((value) => Math.round(parseFloat(value))),
          gap: getComputedStyle(shell).gap,
          box: box(shell)
        }
      : null,
    corner: cornerEl
      ? {
          tag: cornerEl.tagName.toLowerCase(),
          className: typeof cornerEl.className === "string" ? cornerEl.className : "",
          insideRail: Boolean(rail && rail.contains(cornerEl)),
          insideTitlebar: Boolean(titlebar && titlebar.contains(cornerEl))
        }
      : null,
    overflow: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }
  };
})()`;

const failures = [];
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}: ${detail}`);
  return Boolean(condition);
};

/**
 * The last step the rig reached.
 *
 * A throw anywhere inside the run leaves `report` as the catch branch, so without
 * this the failure reads as a bare "Script failed to execute" with no indication
 * of which evaluation produced it — which is a bisect instead of a diagnosis.
 */
let step = "start";
const at = (name) => {
  step = name;
};

/** A "highlighted" chip paints a real fill — any alpha above a rounding crumb,
 *  and not the surface behind it. */
const isHighlighted = (color) => {
  const match = /^rgba?\(([^)]+)\)$/.exec(color ?? "");
  if (!match) return false;
  const parts = match[1].split(",").map((part) => parseFloat(part));
  const alpha = parts.length > 3 ? parts[3] : 1;
  return alpha > 0.05;
};

/**
 * WCAG relative luminance of a computed `rgb()` colour, 0 = black, 1 = white.
 * The ladder is an ordering claim, so it is asserted on gamma-corrected numbers
 * rather than on the hex strings — a skin is free to move the inks as long as the
 * order holds.
 */
const luminance = (color) => {
  const match = /^rgba?\(([^)]+)\)$/.exec(color ?? "");
  if (!match) return Number.NaN;
  const [r, g, b] = match[1]
    .split(",")
    .slice(0, 3)
    .map((part) => parseFloat(part) / 255);
  const linear = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
};

/**
 * The `rgb()` Chromium computes for one of the palette's `#rrggbb` tokens, so a
 * token read off `<html>` can be compared with a computed background without
 * guessing at its serialisation. Any other token text — a `color-mix()` a skin
 * never resolved, for instance — is returned untouched and will simply not match.
 */
const rgbOf = (hex) => {
  const clean = (hex ?? "").trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(clean)) return hex ?? null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

/** The ladder as numbers, for the report and the stdout table. */
const ladderOf = (state) => {
  const surfaces = {
    chrome: state.rail?.background ?? null,
    titlebar: state.titlebarBackground ?? null,
    page: state.mainBackground ?? null,
    dock: state.chat?.background ?? null,
    dockActions: state.dockActions ?? null,
    card: state.cards?.["home-card"] ?? null,
    viewCard: state.cards?.["view-card"] ?? null,
  };
  return {
    dataTheme: state.theme?.dataTheme ?? null,
    skin: state.theme?.skin ?? null,
    tokens: state.theme ?? null,
    surfaces,
    luminance: Object.fromEntries(
      Object.entries(surfaces).map(([key, color]) => [key, luminance(color)]),
    ),
  };
};

/**
 * The app's own scrollbar, measured on the two scrollers the operator names: the
 * sheet's content (`.shell__content`) and the chat transcript
 * (`.chat-panel__body`).
 *
 * What makes this falsifiable is the GUTTER. Chromium lays out a styled
 * scrollbar at exactly the width the CSS asks for, and leaves a platform bar at
 * the platform's own width — 15 to 17 px on Windows. So `offsetWidth -
 * clientWidth` is 8 on a scroller that got the app's treatment and something
 * else on one that did not, and no amount of eyeballing is needed to tell them
 * apart.
 *
 * The pseudo-element reads are Chromium's; where an engine does not answer for
 * them the field is null and the gutter above still carries the claim. That is
 * recorded rather than assumed: `pseudoReadable` in the report says which kind of
 * run this was, so a silently-absent assertion cannot pass for a held one.
 */
const SCROLL_CHROME = `(() => {
  const read = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const thumb = getComputedStyle(el, "::-webkit-scrollbar-thumb");
    const track = getComputedStyle(el, "::-webkit-scrollbar-track");
    const bar = getComputedStyle(el, "::-webkit-scrollbar");
    const r = el.getBoundingClientRect();
    return {
      selector,
      box: {
        left: Math.round(r.left),
        top: Math.round(r.top),
        right: Math.round(r.right),
        bottom: Math.round(r.bottom),
        width: Math.round(r.width),
        height: Math.round(r.height)
      },
      // 0 when nothing overflows: the claim below refuses that run first.
      gutterX: el.offsetWidth - el.clientWidth,
      gutterY: el.offsetHeight - el.clientHeight,
      overflowsY: el.scrollHeight > el.clientHeight,
      // Whether the browser itself considers this scroller hovered. This is what
      // separates "the rig cannot make a hidden window hover" — which is a limit
      // of the rig and is recorded as one — from "the hover rule does not fire",
      // which would be a bug in the stylesheet.
      hovered: el.matches(":hover"),
      barWidth: bar ? bar.width : null,
      thumbBackground: thumb ? thumb.backgroundColor : null,
      thumbRadius: thumb ? thumb.borderTopLeftRadius : null,
      trackBackground: track ? track.backgroundColor : null
    };
  };
  const root = getComputedStyle(document.documentElement);
  return {
    sheet: read(".shell__content"),
    transcript: read(".chat-panel__body"),
    thumbToken: root.getPropertyValue("--scrollbar-thumb").trim(),
    mutedForeground: root.getPropertyValue("--muted-foreground").trim(),
    accent: root.getPropertyValue("--accent").trim(),
    primary: root.getPropertyValue("--primary").trim()
  };
})()`;

/**
 * A colour's alpha, or NaN when the value is not a colour at all.
 *
 * Chromium answers a plain `rgba()` for a transparent thumb but a
 * `color(srgb r g b / a)` for one painted by `color-mix()`, so both forms are
 * read here rather than only the first.
 */
const alphaOf = (color) => {
  const value = (color ?? "").trim();
  const rgb = /^rgba?\(([^)]+)\)$/.exec(value);
  if (rgb) {
    const parts = rgb[1].split(/[,/ ]+/).filter(Boolean).map(parseFloat);
    return parts.length > 3 ? parts[3] : 1;
  }
  const srgb = /^color\(srgb\s+([^)]+)\)$/.exec(value);
  if (srgb) {
    const parts = srgb[1].split(/[/ ]+/).filter(Boolean).map(parseFloat);
    return parts.length > 3 ? parts[3] : 1;
  }
  return Number.NaN;
};

/**
 * The scrollbar claims for one palette. `label` names the mode the caller put the
 * window in, so a failure says which run it came from.
 *
 * Every scroller in the window is styled, but only two of them are *asserted*: a
 * claim needs a region that really scrolls, and these are the two the operator
 * named. The rail, the settings overlays and the dialogs take the same rule by
 * cascade, so a regression in the rule shows up here.
 */
function checkScrollChrome(label, scroll) {
  const both = [scroll.sheet, scroll.transcript];
  check(
    `${label}: both named scrollers exist and really overflow`,
    both.every((region) => region && region.overflowsY),
    `sheet ${JSON.stringify(scroll.sheet?.overflowsY)} / transcript ${JSON.stringify(scroll.transcript?.overflowsY)}`,
  );

  for (const [name, region] of [
    ["the sheet's content", scroll.sheet],
    ["the chat transcript", scroll.transcript],
  ]) {
    if (!region) {
      check(`${label}: ${name} was found`, false, "the region is not in the tree");
      continue;
    }
    // The load-bearing one: the platform bar is 15-17px on Windows and the app's
    // is 0.5rem. A gutter of 8 is proof the app's rules won, not a proxy for it.
    check(
      `${label}: ${name} wears the app's 8px bar, not the platform's`,
      region.gutterX === 8,
      `gutter ${region.gutterX}px (bar width ${JSON.stringify(region.barWidth)})`,
    );
    if (region.thumbBackground !== null) {
      // Drawn at rest, and quiet: present enough to read as a bar, faint enough
      // not to compete with the content. A fully transparent thumb is the failure
      // this pins shut — it is invisible, and an operator reads that as "there is
      // no scrollbar here".
      check(
        `${label}: ${name} draws its thumb at rest, quietly`,
        alphaOf(region.thumbBackground) > 0 && alphaOf(region.thumbBackground) <= 0.2,
        `thumb background ${JSON.stringify(region.thumbBackground)}`,
      );
      check(
        `${label}: ${name} draws no track`,
        alphaOf(region.trackBackground) === 0,
        `track background ${JSON.stringify(region.trackBackground)}`,
      );
    }
  }

  // The ink is a neutral taken from the palette's mid ink — the same one muted
  // text wears — and never the accent. A brand-tinted scrollbar is chrome wearing
  // the brand's colour, which is what this pins shut.
  check(
    `${label}: the thumb ink is the palette's mid ink, not the accent`,
    scroll.thumbToken !== "" &&
      scroll.thumbToken === scroll.mutedForeground &&
      scroll.thumbToken !== scroll.accent &&
      scroll.thumbToken !== scroll.primary,
    `--scrollbar-thumb ${JSON.stringify(scroll.thumbToken)} vs --muted-foreground ${JSON.stringify(scroll.mutedForeground)}, --accent ${JSON.stringify(scroll.accent)}`,
  );
}

async function main() {
  fs.mkdirSync(artifactsDir, { recursive: true });

  // The rig opens a real window on the operator's desktop: paint it in the
  // theme the app itself defaults to (tokens.css, [data-theme="dark"]) so a
  // test run is not a white sheet flashing across the screen.
  nativeTheme.themeSource = "dark";

  const win = new BrowserWindow({
    ...DEFAULT_SIZE,
    show: false,
    backgroundColor: "#1a1917",
    // A hidden rig shares the machine with every other rig in the suite, and
    // Chromium throttles a backgrounded window's timers: a real 220 ms hold
    // becomes a coin toss without this. Painting is the switch above.
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });

  const run = (expression) => win.webContents.executeJavaScript(expression, true);

  // Vite re-optimises dependencies the first time a new import appears and
  // reloads the page when it does, which clears the harness globals mid-wait —
  // so poll instead of assuming the first evaluate lands after the module ran.
  // Returns the vault name the harness handed the shell.
  const waitForHarness = async (timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    let lastError = "harness globals never appeared";
    while (Date.now() < deadline) {
      try {
        const ready = await run(`(async () => {
          if (typeof window.shellHarnessReady !== "object") return null;
          await window.shellHarnessReady;
          return typeof window.shellHarnessVaultName === "string"
            ? window.shellHarnessVaultName
            : null;
        })()`);
        if (typeof ready === "string") return ready;
        lastError = "harness globals not present yet";
      } catch (error) {
        lastError = String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`harness never became ready: ${lastError}`);
  };

  const sample = async (attempt = 0) => {
    let value;
    try {
      value = await run(SAMPLE);
    } catch (error) {
      if (attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
      return sample(attempt + 1);
    }
    if (!value) throw new Error("harness returned no sample");
    return value;
  };

  const settled = async (ms = 220) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return sample();
  };

  const clickToggle = async (selector) =>
    run(`(async () => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return true;
    })()`);

  /** Click one tab of the rail's wing switcher, through React's own handler. */
  const clickWing = async (label) =>
    run(`(async () => {
      const nodes = Array.from(document.querySelectorAll(".nav-rail__wings .ui-segmented__option"));
      const el = nodes.find((n) => ((n.textContent || "").trim()) === ${JSON.stringify(label)});
      if (!el) return false;
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, view: window }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return true;
    })()`);

  /**
   * The harness's own theme switch: `applyThemePreference` + `applySkin`, the two
   * calls the provider makes when the preference or the skin changes. It returns
   * the skin it resolved, so a sweep can prove the palette landed rather than
   * measure the previous one.
   */
  const applyTheme = async (skinName, mode) => {
    const applied = await run(
      `window.shellHarnessApplyTheme?.(${JSON.stringify(skinName)}, ${JSON.stringify(mode)}) ?? null`,
    );
    check(
      `the harness switched to ${skinName} ${mode}`,
      applied === skinName,
      `harness resolved ${JSON.stringify(applied)}`,
    );
    return applied;
  };

  /**
   * Every night palette in the app. Named here rather than discovered so a run
   * measures a fixed set; the suite cross-checks this list against the skin
   * registry, so a new dark skin cannot land without being measured.
   */
  const NIGHT_SKINS = [
    "forge-os",
    "nous",
    "nous-classic",
    "midnight",
    "ember",
    "mono",
    "cyberpunk",
  ];

  let report;
  const timeout = setTimeout(() => {
    console.error("shell-sidebar: timed out after 90s");
    app.exit(1);
  }, 90_000);

  try {
    await win.loadURL(url);
    const vaultName = await waitForHarness();

    // Fixed content size so every number is comparable run to run.
    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await new Promise((resolve) => setTimeout(resolve, 250));
    win.showInactive();

    // The rig pins the palette it measures. A rig shares this window's storage
    // with the operator's own dev profile, so whatever skin and mode they last
    // chose would otherwise decide what "expanded" is painted in — and a forge-os
    // claim measured on another palette is worse than no claim at all.
    await applyTheme("forge-os", "dark");

    const expanded = await settled();
    const { track, collapsedTrack, titlebarHeight } = expanded.tokens;
    const { height: viewportHeight, width: viewportWidth } = expanded.viewport;

    // The native caption strip is painted by the OS, beside the web content and in
    // the same row the CSS titlebar fills. The provider hands it the titlebar token
    // on every repaint; the harness makes the same third call the provider makes
    // after a skin change, so this read covers the night palette the rig pins.
    const overlayCalls = await run(
      "window.shellHarnessOverlayCalls?.() ?? []",
    );
    check(
      "the native caption strip wears the titlebar's fill",
      Array.isArray(overlayCalls) &&
        overlayCalls.length > 0 &&
        rgbOf(overlayCalls[overlayCalls.length - 1]?.color) ===
          expanded.titlebarBackground,
      `overlay ${JSON.stringify(overlayCalls[overlayCalls.length - 1] ?? null)} vs titlebar ${expanded.titlebarBackground}`,
    );

    // 1 — flush: the rail owns the window's top, left and bottom edges.
    check("rail exists", Boolean(expanded.rail), "no .nav-rail in the shell");
    check(
      "rail flush left",
      expanded.rail?.box.left === 0,
      `left inset ${expanded.rail?.box.left}px`,
    );
    check(
      "rail flush top",
      expanded.rail?.box.top === 0,
      `top inset ${expanded.rail?.box.top}px`,
    );
    check(
      "rail flush bottom",
      expanded.rail?.box.bottom === viewportHeight,
      `bottom ${expanded.rail?.box.bottom}px vs window ${viewportHeight}px`,
    );
    check(
      "rail spans the window height",
      expanded.rail?.box.height === viewportHeight,
      `height ${expanded.rail?.box.height}px vs window ${viewportHeight}px`,
    );
    check(
      "the collapsed track token is the icon column",
      expanded.tokens.collapsedTrack === 56,
      `--shell-nav-width-collapsed resolved to ${expanded.tokens.collapsedTrack}px, not the 56px icon column`,
    );
    check(
      "rail keeps the track width",
      expanded.rail?.box.width === track,
      `rail ${expanded.rail?.box.width}px vs --shell-nav-width ${track}px`,
    );
    // The rail is a pane, not a card: square, flush, and carrying exactly one
    // hairline — on its trailing edge, inside its own width, so the sheet starts
    // on the line rather than one pixel past it. Its other three edges paint
    // nothing; a line there would either box the sidebar in or double the seam
    // the sheet already reads.
    check(
      "rail stays square",
      expanded.rail?.borderRadius === "0px",
      `radius ${expanded.rail?.borderRadius}`,
    );
    check(
      "the rail draws one hairline on its trailing edge and no other edge",
      parseFloat(expanded.rail?.borderRightWidth ?? "0") > 0 &&
        parseFloat(expanded.rail?.borderRightWidth ?? "0") <= 1 &&
        expanded.rail?.borderLeftWidth === "0px" &&
        expanded.rail?.borderTopWidth === "0px" &&
        expanded.rail?.borderBottomWidth === "0px",
      `borders t/r/b/l ${expanded.rail?.borderTopWidth}/${expanded.rail?.borderRightWidth}/${expanded.rail?.borderBottomWidth}/${expanded.rail?.borderLeftWidth}`,
    );

    // 2 — the topband: the titlebar row, carrying exactly one control.
    check(
      "topband sits on the window edge",
      expanded.header?.box.top === 0 && expanded.header?.box.bottom === titlebarHeight,
      `band ${expanded.header?.box.top}–${expanded.header?.box.bottom}px vs titlebar height ${titlebarHeight}px`,
    );
    check(
      "topband holds one control",
      expanded.header?.controls.length === 1,
      `controls ${JSON.stringify(expanded.header?.controls)}`,
    );
    check(
      "that control is the collapse toggle",
      expanded.railToggle?.label === "Collapse sidebar",
      `label ${JSON.stringify(expanded.railToggle?.label)}`,
    );
    check(
      "the toggle is the rail's own, wearing the collapse state",
      expanded.railToggle?.ariaExpanded === "true" &&
        expanded.railToggle?.ariaControls === "nav-rail" &&
        (expanded.railToggle?.icon ?? "").includes("lucide-panel-left-close"),
      `aria-expanded ${JSON.stringify(expanded.railToggle?.ariaExpanded)}, controls ${JSON.stringify(expanded.railToggle?.ariaControls)}, icon ${JSON.stringify(expanded.railToggle?.icon)}`,
    );
    check(
      "the toggle stays inside the rail's box",
      Boolean(expanded.railToggle && expanded.rail) &&
        expanded.railToggle.box.left >= expanded.rail.box.left &&
        expanded.railToggle.box.right <= expanded.rail.box.right,
      `toggle ${JSON.stringify(expanded.railToggle?.box)} in rail ${JSON.stringify(expanded.rail?.box)}`,
    );
    // The wide rail is the full column: labels, the five-wing band, the chats
    // section and the divider above it. Hiding any of them is a thin-rail rule
    // leaking into the expanded state.
    check(
      "the wide rail keeps its text labels",
      expanded.railLabels?.count > 0 && expanded.railLabels?.display !== "none",
      `labels ${expanded.railLabels?.count} display ${JSON.stringify(expanded.railLabels?.display)}`,
    );
    check(
      "the wide rail keeps the wing switcher's band",
      expanded.wingsBand !== null && expanded.wingsBand?.display !== "none",
      `band display ${JSON.stringify(expanded.wingsBand?.display)}`,
    );
    check(
      "the wide rail keeps the chats section and the divider above it",
      expanded.chats !== null &&
        expanded.chats?.display !== "none" &&
        expanded.chatsDivider !== null &&
        expanded.chatsDivider?.display !== "none",
      `chats display ${JSON.stringify(expanded.chats?.display)}, divider ${JSON.stringify(expanded.chatsDivider?.display)}`,
    );
    check(
      "nav rows start under the topband",
      (expanded.firstLink?.top ?? 0) >= (expanded.header?.box.bottom ?? 0),
      `first row top ${expanded.firstLink?.top}px vs band bottom ${expanded.header?.box.bottom}px`,
    );

    // 2b — the sidebar's first level: the five-wing switcher in its own band,
    // above the wing's pages and on the sheet's top-bar row. The band paints no
    // line of its own: the strip's hairline stays in the sheet, under the lens.
    const wingBand = expanded.wingsBand;
    const switcher = expanded.wingSwitcher;
    check(
      "the wing switcher lives in the rail",
      Boolean(switcher?.inRail),
      `switcher ${JSON.stringify(switcher?.box)} in rail ${JSON.stringify(expanded.rail?.box)}`,
    );
    check(
      "the wide wing switcher is horizontal",
      expanded.wingSwitcher?.flexDirection === "row",
      `wings flex-direction ${JSON.stringify(expanded.wingSwitcher?.flexDirection)}`,
    );
    check(
      "the wing switcher is the five wings, in order",
      Boolean(switcher) &&
        switcher.role === "tablist" &&
        switcher.optionCount === 5 &&
        JSON.stringify(switcher.labels) ===
          JSON.stringify(["Home", "Define", "Plan", "Act", "Review"]) &&
        switcher.active === "Home",
      `role ${switcher?.role}, options ${JSON.stringify(switcher?.labels)}, active ${JSON.stringify(switcher?.active)}`,
    );
    check(
      "the wing switcher sits above the wing's rows",
      Boolean(wingBand && switcher && expanded.firstLink) &&
        wingBand.box.top >= (expanded.header?.box.bottom ?? 0) &&
        switcher.box.top >= wingBand.box.top &&
        switcher.box.bottom <= wingBand.box.bottom &&
        wingBand.box.bottom <= expanded.firstLink.top + 1,
      `band ${JSON.stringify(wingBand)}, control ${JSON.stringify(switcher?.box)}, first row ${JSON.stringify(expanded.firstLink)}`,
    );
    // The switcher is a rectangular block, not the shared pill: every corner is
    // square, and the rail's own padding is its only margin — one thin gap either
    // side, equal, which is what centres the block in the column.
    check(
      "the wide wing switcher is a square block, not a pill",
      switcher?.borderRadius === "0px" &&
        (switcher?.options ?? []).every(
          (option) => option.borderRadius === "0px",
        ),
      `frame ${JSON.stringify(switcher?.borderRadius)}, tabs ${JSON.stringify(switcher?.options?.map((option) => option.borderRadius))}`,
    );
    check(
      "the wide wing switcher sits centred with one thin margin each side",
      Boolean(switcher && wingBand && expanded.rail) &&
        Math.abs(
          switcher.box.left -
            expanded.rail.box.left -
            (expanded.rail.box.right - switcher.box.right),
        ) <= 1 &&
        switcher.box.left - expanded.rail.box.left >= 3 &&
        expanded.rail.box.right - switcher.box.right >= 3 &&
        switcher.box.left === wingBand.box.left &&
        switcher.box.right === wingBand.box.right,
      `rail ${JSON.stringify(expanded.rail?.box)}, band ${JSON.stringify(wingBand?.box)}, switcher ${JSON.stringify(switcher?.box)}`,
    );
    check(
      "the wide wing switcher's words are clear of its rules",
      Boolean(switcher) &&
        (switcher?.options ?? []).every(
          (option) =>
            option.padding.top >= 5 &&
            option.padding.bottom >= 5 &&
            option.padding.left >= 3 &&
            option.padding.right >= 3 &&
            option.scrollWidth <= option.clientWidth,
        ),
      `padding ${JSON.stringify(switcher?.options?.map((option) => option.padding))}, widths ${JSON.stringify(switcher?.options?.map((option) => [option.scrollWidth, option.clientWidth]))}`,
    );
    check(
      "the rail's band shares the top bar's row",
      Boolean(wingBand && expanded.topBar) &&
        wingBand.box.top === expanded.topBar.box.top &&
        wingBand.box.bottom === expanded.topBar.box.bottom,
      `rail band ${JSON.stringify(wingBand)} vs top bar ${JSON.stringify(expanded.topBar?.box)}`,
    );
    check(
      "the sidebar band paints no line of its own",
      wingBand?.borderBottomWidth === "0px" &&
        parseFloat(expanded.topBar?.borderBottomWidth ?? "0") > 0,
      `rail band border ${wingBand?.borderBottomWidth}, top bar border ${expanded.topBar?.borderBottomWidth}`,
    );

    // 3 — paint order: the rail's topband, not the titlebar, owns the corner.
    check(
      "rail paints over the titlebar",
      expanded.corner?.insideRail === true,
      `corner element ${JSON.stringify(expanded.corner)}`,
    );

    // 4 — the titlebar no longer names the vault. Round 2 moved the chip into the
    // rail's foot: the strip's leading half is an empty drag handle and it no
    // longer reserves the rail's column with `--nav-column` classes. The chip
    // keeps every part of its old contract (a button, the vault's name, an accent
    // fill, a dialog) but it now lives with the navigation it belongs to.
    check(
      "the titlebar renders no vault chip",
      expanded.titlebarVault === null,
      `a .window-titlebar__vault is still in the strip: ${JSON.stringify(expanded.titlebarVault)}`,
    );
    check(
      "the titlebar's leading strip is empty",
      expanded.leadingText === "",
      `the strip still carries text: ${JSON.stringify(expanded.leadingText)}`,
    );
    check(
      "the app mark and wordmark are gone",
      expanded.legacyBrand === false,
      "a brand/logo/label element is still in the titlebar",
    );
    // The reported bug: a second toggle rendered in the titlebar when the rail
    // collapsed, on top of the vault chip. There is no titlebar toggle in either
    // state any more — the rail keeps its own in its header at both widths.
    check(
      "no titlebar toggle exists while the rail is open",
      expanded.titlebarToggle === null,
      `titlebar toggle present: ${JSON.stringify(expanded.titlebarToggle)}`,
    );
    check(
      "the collapse toggle sits at the sidebar's trailing edge",
      Boolean(expanded.railToggle) &&
        expanded.railToggle.box.right > expanded.rail.box.left + track * 0.7 &&
        expanded.railToggle.box.right <= expanded.rail.box.right,
      `rail toggle ends at ${expanded.railToggle?.box.right}px, sidebar ends at ${expanded.rail?.box.right}px`,
    );

    // The chip's new home: the rail's foot. Wide, the foot is one row — the Log
    // row and the chip split it in half — and the chip shows the vault's full
    // name. A chip that stayed behind in the strip, or a chip that did not take
    // the row's other half, is the feature missing rather than moved.
    check(
      "the rail foot renders the vault chip",
      Boolean(expanded.vaultChip),
      "no .nav-rail__vault in the rail",
    );
    check(
      "the chip lives in the rail, in its foot group",
      expanded.vaultChip?.inRail === true && expanded.vaultChip?.inFoot === true,
      `in rail ${expanded.vaultChip?.inRail}, in foot ${expanded.vaultChip?.inFoot}`,
    );
    check(
      "the foot's two controls are the Log row and the vault chip",
      Boolean(expanded.foot) &&
        expanded.foot.children.length === 2 &&
        expanded.foot.children[0].className.includes("nav-rail__link") &&
        expanded.foot.children[1].className.includes("nav-rail__vault"),
      `foot children ${JSON.stringify(expanded.foot?.children)}`,
    );
    check(
      "the wide foot is one row",
      expanded.foot?.display === "flex" &&
        expanded.foot?.flexDirection === "row",
      `foot display ${JSON.stringify(expanded.foot?.display)} direction ${JSON.stringify(expanded.foot?.flexDirection)}`,
    );
    check(
      "the Log and the vault chip split the foot in half",
      Boolean(expanded.foot?.logRow && expanded.vaultChip) &&
        expanded.foot.logRow.width > 0 &&
        Math.abs(expanded.foot.logRow.width - expanded.vaultChip.box.width) <= 1 &&
        expanded.foot.logRow.width >= expanded.foot.box.width * 0.4,
      `log ${JSON.stringify(expanded.foot?.logRow)} chip ${JSON.stringify(expanded.vaultChip?.box)} foot ${JSON.stringify(expanded.foot?.box)}`,
    );
    check(
      "the Log and the vault chip share the foot's row",
      Boolean(expanded.foot?.logRow && expanded.vaultChip) &&
        Math.abs(
          (expanded.foot.logRow.top + expanded.foot.logRow.bottom) / 2 -
            (expanded.vaultChip.box.top + expanded.vaultChip.box.bottom) / 2,
        ) <= 1 &&
        Math.abs(expanded.foot.logRow.height - expanded.vaultChip.box.height) <= 1,
      `log ${JSON.stringify(expanded.foot?.logRow)} chip ${JSON.stringify(expanded.vaultChip?.box)}`,
    );
    check(
      "the wide chip shows the vault's name and hides the initials",
      expanded.vaultChip?.name?.text === vaultName &&
        expanded.vaultChip?.name?.display !== "none" &&
        expanded.vaultChip?.initials?.display === "none",
      `name ${JSON.stringify(expanded.vaultChip?.name)} initials ${JSON.stringify(expanded.vaultChip?.initials)}`,
    );
    check(
      "the wide chip shows its chevron",
      Boolean(expanded.vaultChip?.chevronDisplay) &&
        expanded.vaultChip?.chevronDisplay !== "none",
      `chevron display ${JSON.stringify(expanded.vaultChip?.chevronDisplay)}`,
    );
    check(
      "the chip is a button that opens the vault switcher",
      expanded.vaultChip?.tag === "button" &&
        expanded.vaultChip?.haspopup === "dialog" &&
        expanded.vaultChip?.ariaExpanded === "false" &&
        expanded.vaultChip?.title === "Switch vault",
      `tag ${expanded.vaultChip?.tag}, popup ${expanded.vaultChip?.haspopup}, expanded ${JSON.stringify(expanded.vaultChip?.ariaExpanded)}, title ${JSON.stringify(expanded.vaultChip?.title)}`,
    );
    check(
      "the chip's accessible name carries the full vault name",
      (expanded.vaultChip?.ariaLabel ?? "").includes(vaultName),
      `aria-label ${JSON.stringify(expanded.vaultChip?.ariaLabel)} vs vault ${JSON.stringify(vaultName)}`,
    );
    check(
      "the chip wears a highlighted accent fill",
      isHighlighted(expanded.vaultChip?.background) &&
        expanded.vaultChip?.background !== expanded.rail?.background,
      `chip background ${expanded.vaultChip?.background} on rail ${expanded.rail?.background}`,
    );
    check(
      "the chip's ink is the accent, not the rail's text ink",
      expanded.vaultChip?.color === expanded.theme?.accent,
      `chip ink ${expanded.vaultChip?.color} vs --accent ${expanded.theme?.accent}`,
    );
    check(
      "the chip is a rounded chip, not the old square strip tab",
      expanded.vaultChip?.radius !== "0px" &&
        expanded.vaultChip?.radius === expanded.tokens.radiusSm,
      `radius ${expanded.vaultChip?.radius} vs --radius-sm ${expanded.tokens.radiusSm}`,
    );
    check(
      "the chip sits inside the rail's column",
      Boolean(expanded.vaultChip && expanded.rail) &&
        expanded.vaultChip.box.left >= expanded.rail.box.left &&
        expanded.vaultChip.box.right <= expanded.rail.box.right,
      `chip ${JSON.stringify(expanded.vaultChip?.box)} in rail ${JSON.stringify(expanded.rail?.box)}`,
    );
    check(
      "the chip is the last control in the rail",
      expanded.vaultChip?.isLastControl === true,
      "a visible control follows the vault chip in the rail",
    );

    check(
      "the chats section lives inside the sidebar",
      Boolean(expanded.chats?.inRail) &&
        expanded.chats.box.left >= expanded.rail.box.left &&
        expanded.chats.box.right <= expanded.rail.box.right &&
        expanded.chats.title === "Chats" &&
        expanded.chats.newChat &&
        expanded.chats.scrollRegion === "auto",
      `chats ${JSON.stringify(expanded.chats?.box)} inside rail ${JSON.stringify(expanded.rail?.box)}, title ${JSON.stringify(expanded.chats?.title)}, new ${expanded.chats?.newChat}, list overflow ${expanded.chats?.scrollRegion}`,
    );
    check(
      "the chats section is the middle band: under the wing's rows, above the foot",
      Boolean(expanded.chats && expanded.wingSection && expanded.bottomSection) &&
        expanded.chats.box.top >= expanded.wingSection.bottom - 1 &&
        expanded.chats.box.bottom <= expanded.bottomSection.top + 1,
      `chats ${JSON.stringify(expanded.chats?.box)}, wing ends ${expanded.wingSection?.bottom}, foot starts ${expanded.bottomSection?.top}`,
    );
    check(
      "the sheet abuts the sidebar's trailing edge",
      expanded.main?.left === expanded.rail?.box.right,
      `sheet left ${expanded.main?.left}px vs sidebar right ${expanded.rail?.box.right}px`,
    );

    // 5 — the workspace sheet is flush to the rail and the dock, and meets the
    // strip with no mat between them. The rail's box reaches over the titlebar row
    // and paints the mat there, so the sidebar runs to the window's top; the
    // titlebar's own fill begins only where the rail ends, at the sheet's leading
    // edge. The topband draws no fill of its own — it is the rail's mat showing.
    check(
      "the sidebar runs to the window's top wearing the mat",
      expanded.header?.background === "rgba(0, 0, 0, 0)" &&
        expanded.rail?.background === rgbOf(expanded.theme?.canvasBase) &&
        expanded.header?.box.top === 0 &&
        expanded.header?.box.bottom === titlebarHeight &&
        expanded.titlebarBackground !== expanded.rail?.background,
      `rail topband ${expanded.header?.background} vs rail ${expanded.rail?.background} vs --canvas-base ${expanded.theme?.canvasBase}; topband ${JSON.stringify(expanded.header?.box)}`,
    );
    check(
      "the rail is unfrosted",
      expanded.rail?.backdropFilter === "none",
      `backdrop ${expanded.rail?.backdropFilter}`,
    );
    // The strip used to reserve the rail's column so the vault chip could start
    // where the sheet does. Round 2 deleted that reservation with the chip: the
    // titlebar carries no nav-column classes. The rail still paints over the
    // strip's leading column, so the studio's top-left corner stays its mat.
    check(
      "the titlebar reserves no rail column and the rail still paints its corner",
      !String(expanded.titlebarClass ?? "").includes("window-titlebar--nav-column") &&
        !String(expanded.titlebarClass ?? "").includes("window-titlebar--nav-collapsed") &&
        expanded.corner?.insideRail === true,
      `titlebar ${JSON.stringify(expanded.titlebarClass)}, corner ${JSON.stringify(expanded.corner)}`,
    );
    check(
      "the sheet closes the gap to the dock and the window's bottom",
      Boolean(
        expanded.main &&
          expanded.chat &&
          expanded.main.right === expanded.chat.box.left &&
          expanded.main.bottom === viewportHeight,
      ),
      `sheet right ${expanded.main?.right}px vs dock left ${expanded.chat?.box.left}px, sheet bottom ${expanded.main?.bottom}px vs window ${viewportHeight}px`,
    );
    // The panel is the rightmost pane now, and it is flush rather than inset.
    check(
      "the chat panel is flush to the window's right and bottom",
      viewportWidth - (expanded.chat?.box.right ?? 0) === 0 &&
        (expanded.chat?.box.bottom ?? 0) === viewportHeight,
      `right inset ${viewportWidth - (expanded.chat?.box.right ?? 0)}px, panel bottom ${expanded.chat?.box.bottom}px of ${viewportHeight}px`,
    );
    check(
      "the chat panel has square corners",
      expanded.chat?.borderRadius === "0px",
      `radius ${expanded.chat?.borderRadius}`,
    );
    check(
      "the dock paints no line of its own",
      expanded.chat?.borderTopWidth === "0px" &&
        expanded.chat?.borderRightWidth === "0px" &&
        expanded.chat?.borderBottomWidth === "0px" &&
        expanded.chat?.borderLeftWidth === "0px",
      `borders t/r/b/l ${expanded.chat?.borderTopWidth}/${expanded.chat?.borderRightWidth}/${expanded.chat?.borderBottomWidth}/${expanded.chat?.borderLeftWidth}`,
    );
    check(
      "the panel's top edge is level with the sheet's",
      expanded.chat?.box.top === titlebarHeight,
      `panel top ${expanded.chat?.box.top}px vs sheet top ${titlebarHeight}px`,
    );
    check(
      "the chat panel wears the sheet's own surface, unfrosted",
      expanded.chat?.backdropFilter === "none" &&
        expanded.chat?.background === expanded.mainBackground,
      `panel ${expanded.chat?.background} backdrop ${expanded.chat?.backdropFilter} vs sheet ${expanded.mainBackground}`,
    );
    check(
      "no shadow survives the flush panel",
      expanded.chat?.boxShadow === "none",
      `shadow ${expanded.chat?.boxShadow}`,
    );
    check(
      "the sheet meets the strip with no pane gap",
      expanded.main?.top === titlebarHeight,
      `sheet top ${expanded.main?.top}px (want ${titlebarHeight}px)`,
    );
    // Square on all four corners: the sheet is a pane, not a card, and no corner
    // of it is notched out of the mat — in either arrangement.
    check(
      "the sheet is square on all four corners",
      expanded.sheet?.borderTopLeftRadius === "0px" &&
        expanded.sheet?.borderTopRightRadius === "0px" &&
        expanded.sheet?.borderBottomRightRadius === "0px" &&
        expanded.sheet?.borderBottomLeftRadius === "0px",
      `corners tl/tr/br/bl ${expanded.sheet?.borderTopLeftRadius}/${expanded.sheet?.borderTopRightRadius}/${expanded.sheet?.borderBottomRightRadius}/${expanded.sheet?.borderBottomLeftRadius}`,
    );
    // Two seams, one line each, and no doubles. The sheet's trailing hairline is
    // the seam with the dock. The rail draws the rail|sheet seam on its own
    // trailing edge, inside its width; the sheet's leading edge paints nothing,
    // so the operator reads one hairline and not a two-pixel band.
    check(
      "the sheet wears one hairline, on its trailing edge",
      parseFloat(expanded.sheet?.borderRightWidth ?? "0") > 0 &&
        parseFloat(expanded.sheet?.borderRightWidth ?? "0") <= 1 &&
        expanded.sheet?.borderTopWidth === "0px" &&
        expanded.sheet?.borderBottomWidth === "0px" &&
        expanded.sheet?.borderLeftWidth === "0px",
      `borders t/r/b/l ${expanded.sheet?.borderTopWidth}/${expanded.sheet?.borderRightWidth}/${expanded.sheet?.borderBottomWidth}/${expanded.sheet?.borderLeftWidth}`,
    );
    check(
      "the rail|sheet seam is one line, drawn by the rail",
      parseFloat(expanded.rail?.borderRightWidth ?? "0") > 0 &&
        parseFloat(expanded.rail?.borderRightWidth ?? "0") <= 1 &&
        expanded.sheet?.borderLeftWidth === "0px",
      `rail right ${expanded.rail?.borderRightWidth}, sheet left ${expanded.sheet?.borderLeftWidth}`,
    );
    check(
      "the sheet's top edge sits directly under the strip",
      expanded.sheet?.box.top === titlebarHeight,
      `sheet top at y=${expanded.sheet?.box.top}px, strip ends at ${titlebarHeight}px`,
    );
    // The line the strip reads as its own is the top bar's, under the domain lens, and
    // not a frame on the sheet's top edge.
    check(
      "the line under the domain lens is the top bar's own",
      parseFloat(expanded.topBar?.borderBottomWidth ?? "0") > 0 &&
        parseFloat(expanded.topBar?.borderBottomWidth ?? "0") <= 1 &&
        expanded.topBar?.background === expanded.mainBackground,
      `top bar bottom ${expanded.topBar?.borderBottomWidth} on ${expanded.topBar?.background} vs page ${expanded.mainBackground}`,
    );
    // ...and it is one line across both panes: the dock's header wears the same
    // band height, so the two underlines land on the same row rather than stepping
    // a pixel apart where they meet.
    check(
      "the sheet's top bar and the dock's header are one band",
      Boolean(expanded.topBar && expanded.chatHeader) &&
        expanded.topBar.box.top === expanded.chatHeader.box.top &&
        expanded.topBar.box.bottom === expanded.chatHeader.box.bottom &&
        expanded.topBar.box.top === titlebarHeight &&
        parseFloat(expanded.chatHeader.borderBottomWidth || "0") > 0,
      `top bar ${JSON.stringify(expanded.topBar?.box)} vs dock header ${JSON.stringify(expanded.chatHeader?.box)}, header underline ${expanded.chatHeader?.borderBottomWidth}`,
    );
    // The chip can no longer be measured against the sheet's leading edge — it
    // lives at the foot of the rail now, not on the titlebar row. What replaces
    // that claim is where the foot sits: the rail's last band, under the chats.
    check(
      "the rail foot closes the rail under the chats section",
      Boolean(expanded.foot && expanded.chats && expanded.rail) &&
        expanded.foot.box.top >= expanded.chats.box.bottom - 1 &&
        expanded.foot.box.bottom <= expanded.rail.box.bottom + 1 &&
        expanded.foot.box.left >= expanded.rail.box.left &&
        expanded.foot.box.right <= expanded.rail.box.right,
      `foot ${JSON.stringify(expanded.foot?.box)}, chats ${JSON.stringify(expanded.chats?.box)}, rail ${JSON.stringify(expanded.rail?.box)}`,
    );

    // The night ladder: the studio is a frame around the darkest page. The page
    // canvas is the floor, the cards step up off it, and the mat — the rail and
    // the window frame — wears the palette's quiet band, under the cards and clear
    // of the floor. The titlebar and the dock's action band are the one surface
    // off that band: their own step, darker than the mat and lighter than the page.
    const night = ladderOf(expanded);
    const { chrome, titlebar, page, card, viewCard } = night.luminance;
    const band = night.luminance.dockActions;
    check(
      "the rig is painted in the night skin",
      night.dataTheme === "dark" && night.skin === "forge-os",
      `theme ${night.dataTheme}, skin ${night.skin}`,
    );
    check(
      "the card probes are on screen",
      Number.isFinite(card) && Number.isFinite(viewCard),
      `probe fills ${JSON.stringify(expanded.cards)}`,
    );
    check(
      "night: the dock's action band wears the strip's fill",
      Number.isFinite(band) &&
        night.surfaces.dockActions === night.surfaces.titlebar &&
        night.tokens.canvasBase === night.tokens.mutedSurface,
      `bar ${night.surfaces.dockActions} vs strip ${night.surfaces.titlebar}; tokens ${night.tokens.canvasBase} vs ${night.tokens.mutedSurface}`,
    );
    check(
      "night: the chrome band sits under the cards and off the page",
      chrome > page && chrome < card && chrome < viewCard,
      `mat ${chrome.toFixed(4)} between page ${page.toFixed(4)} and card ${card.toFixed(4)}/${viewCard.toFixed(4)}`,
    );
    check(
      "night: the titlebar and the dock's bar take one step below the mat",
      titlebar < chrome && titlebar > page && band < chrome && band > page,
      `strip ${night.surfaces.titlebar} (${titlebar.toFixed(4)}) / bar ${night.surfaces.dockActions} (${band.toFixed(4)}) between mat ${night.surfaces.chrome} (${chrome.toFixed(4)}) and page ${night.surfaces.page} (${page.toFixed(4)})`,
    );
    check(
      "night: the cards step up off the page canvas",
      card > page && viewCard > page,
      `card ${night.surfaces.card} (${card.toFixed(4)}), view card ${night.surfaces.viewCard} (${viewCard.toFixed(4)}) vs page ${page.toFixed(4)}`,
    );
    check(
      "night: the page canvas is the darkest surface in the window",
      [chrome, titlebar, page, night.luminance.dock, band, card, viewCard].every(
        (lum) => Number.isFinite(lum) && lum >= page,
      ),
      `page ${page.toFixed(4)} against ${JSON.stringify(night.luminance)}`,
    );
    check(
      "nothing spills past the window",
      expanded.overflow.scrollWidth <= viewportWidth,
      `scrollWidth ${expanded.overflow.scrollWidth}px vs window ${viewportWidth}px`,
    );
    check(
      "rail does not scroll its own topband away",
      expanded.rail?.scrollTop === 0 &&
        (expanded.rail?.scrollHeight ?? 0) <= (expanded.rail?.clientHeight ?? 0),
      `scrollTop ${expanded.rail?.scrollTop}, content ${expanded.rail?.scrollHeight}px in ${expanded.rail?.clientHeight}px`,
    );

    // The sheet's band carries one control now — the domain lens — with no frame
    // of its own, centred in the pane. The frame only doubled the pair's outlines
    // when the wing switcher shared the row; dropping it must not cost the
    // control its shape — the fill sets it off the band, and the active tab keeps
    // the line that makes it the current one.
    const selectors = expanded.topBarSelectors ?? [];
    check(
      "the sheet's band carries the domain lens alone",
      selectors.length === 1 &&
        selectors[0].selector === ".domain-switcher__tabs" &&
        expanded.bandControlCount === 1,
      `selectors ${JSON.stringify(selectors.map((entry) => entry.selector))}, controls ${expanded.bandControlCount}`,
    );
    check(
      "the domain lens wears no frame of its own",
      selectors.length === 1 &&
        selectors.every(
          (entry) =>
            entry.borderTopWidth === "0px" &&
            entry.borderRightWidth === "0px" &&
            entry.borderBottomWidth === "0px" &&
            entry.borderLeftWidth === "0px",
        ),
      `borders ${JSON.stringify(selectors.map((entry) => [entry.selector, entry.borderTopWidth, entry.borderRightWidth, entry.borderBottomWidth, entry.borderLeftWidth]))}`,
    );
    check(
      "the domain lens still reads as a control without it",
      selectors.length === 1 &&
        selectors.every(
          (entry) =>
            entry.optionCount > 0 &&
            isHighlighted(entry.background) &&
            entry.activeBorderWidth !== "0px",
        ),
      `fills ${JSON.stringify(selectors.map((entry) => [entry.selector, entry.background, entry.optionCount, entry.activeBorderWidth]))}`,
    );
    check(
      "the domain lens is centred in the sheet",
      Boolean(expanded.domainLens && expanded.topBar) &&
        Math.abs(
          (expanded.domainLens.box.left + expanded.domainLens.box.right) / 2 -
            (expanded.topBar.box.left + expanded.topBar.box.right) / 2,
        ) <= 1,
      `lens centre ${((expanded.domainLens?.box.left ?? 0) + (expanded.domainLens?.box.right ?? 0)) / 2} vs band centre ${((expanded.topBar?.box.left ?? 0) + (expanded.topBar?.box.right ?? 0)) / 2}`,
    );

    const expandedShot = await win.webContents.capturePage();
    const expandedFile = path.join(artifactsDir, "shell-sidebar-expanded.png");
    fs.writeFileSync(expandedFile, expandedShot.toPNG());
    const cornerShot = await win.webContents.capturePage({
      x: 0,
      y: 0,
      width: 420,
      height: 260,
    });
    const cornerFile = path.join(artifactsDir, "shell-sidebar-corner.png");
    fs.writeFileSync(cornerFile, cornerShot.toPNG());
    // The seam where the two bands meet, zoomed to the one line they should share —
    // the claim the colour and border checks make, in pixels.
    const seamShot = await win.webContents.capturePage({
      x: Math.max(0, (expanded.chat?.box.left ?? 0) - 140),
      y: titlebarHeight,
      width: 280,
      height: 120,
    });
    const seamFile = path.join(artifactsDir, "shell-sidebar-seam.png");
    fs.writeFileSync(seamFile, seamShot.toPNG());
    // The band itself, cropped to the sheet's width: the pixel reading of the two
    // border checks above — one outline per control (the active tab's), none
    // around the control, fill still doing the separating.
    const bandShot = await win.webContents.capturePage({
      x: expanded.main?.left ?? 0,
      y: expanded.topBar?.box.top ?? 0,
      width: Math.max(
        1,
        (expanded.chat?.box.left ?? 0) - (expanded.main?.left ?? 0),
      ),
      height: Math.max(
        1,
        (expanded.topBar?.box.bottom ?? 0) -
          (expanded.topBar?.box.top ?? 0) +
          1,
      ),
    });
    const bandFile = path.join(artifactsDir, "shell-sidebar-band.png");
    fs.writeFileSync(bandFile, bandShot.toPNG());

    // 5b — the switcher is live where it now sits: Define moves the rail to the
    // Define pages, and Home brings them back. Both are read off the rail itself,
    // so a switcher that renders but does not navigate fails here.
    at("wing switcher: Define");
    const clickedDefine = await clickWing("Define");
    check(
      "rail wing switcher clicked (Define)",
      clickedDefine,
      "no Define tab in the rail switcher",
    );
    const defined = await settled(320);
    check(
      "the rail switcher moves to the Define wing",
      defined.wingSwitcher?.active === "Define" &&
        JSON.stringify(defined.wingRows?.map((row) => row.label)) ===
          JSON.stringify(["Dream", "Vision", "Ideal State", "Images"]),
      `active ${JSON.stringify(defined.wingSwitcher?.active)}, rows ${JSON.stringify(defined.wingRows?.map((row) => row.label))}`,
    );
    at("wing switcher: Home");
    const clickedHome = await clickWing("Home");
    check(
      "rail wing switcher clicked (Home)",
      clickedHome,
      "no Home tab in the rail switcher",
    );
    const homeAgain = await settled(320);
    check(
      "the rail switcher comes back to the Home wing",
      homeAgain.wingSwitcher?.active === "Home" &&
        JSON.stringify(homeAgain.wingRows?.map((row) => row.label)) ===
          JSON.stringify([
            "Dashboard",
            "Data",
            "Pages",
            "Documents",
            "Personnel",
          ]),
      `active ${JSON.stringify(homeAgain.wingSwitcher?.active)}, rows ${JSON.stringify(homeAgain.wingRows?.map((row) => row.label))}`,
    );

    // 6 — the toggle collapses the rail IN PLACE: the same pane, one icon column
    // wide. The rail never leaves the layout, so the sheet and the chip start
    // beside it rather than under a titlebar toggle — the reported bug was a
    // second toggle at the window's leading edge sitting on the vault chip.
    const clickedCollapse = await clickToggle(".nav-rail .nav-toggle");
    check("collapse toggle clicked", clickedCollapse, "no rail toggle to click");
    const collapsed = await settled();

    check(
      "collapse narrows the rail instead of removing it",
      collapsed.rail !== null && collapsed.railDisplay !== "none",
      `rail ${collapsed.rail ? `display:${collapsed.railDisplay}` : "left the tree"}`,
    );
    check(
      "the thin rail keeps the icon column's width",
      collapsed.rail?.box.width === collapsedTrack,
      `rail ${collapsed.rail?.box.width}px vs --shell-nav-width-collapsed ${collapsedTrack}px`,
    );
    check(
      "collapse puts the shell in the nav-collapsed arrangement",
      collapsed.shellNavCollapsed === true &&
        collapsed.shell?.gridColumns?.[0] === collapsedTrack,
      `shell class ${JSON.stringify(collapsed.shellClass)}, first track ${JSON.stringify(collapsed.shell?.gridColumns?.[0])}px vs ${collapsedTrack}px`,
    );
    check(
      "the thin rail is still flush and square at the window's edges",
      collapsed.rail?.box.left === 0 &&
        collapsed.rail?.box.top === 0 &&
        collapsed.rail?.box.bottom === viewportHeight &&
        collapsed.rail?.box.height === viewportHeight &&
        collapsed.rail?.borderRadius === "0px",
      `box ${JSON.stringify(collapsed.rail?.box)} vs window ${viewportWidth}x${viewportHeight}, radius ${collapsed.rail?.borderRadius}`,
    );
    check(
      "the thin rail still draws one hairline on its trailing edge and no other edge",
      parseFloat(collapsed.rail?.borderRightWidth ?? "0") > 0 &&
        parseFloat(collapsed.rail?.borderRightWidth ?? "0") <= 1 &&
        collapsed.rail?.borderLeftWidth === "0px" &&
        collapsed.rail?.borderTopWidth === "0px" &&
        collapsed.rail?.borderBottomWidth === "0px",
      `borders t/r/b/l ${collapsed.rail?.borderTopWidth}/${collapsed.rail?.borderRightWidth}/${collapsed.rail?.borderBottomWidth}/${collapsed.rail?.borderLeftWidth}`,
    );
    check(
      "the thin rail is painted on the same mat as the wide one",
      collapsed.rail?.background === rgbOf(collapsed.theme?.canvasBase),
      `rail ${collapsed.rail?.background} vs --canvas-base ${collapsed.theme?.canvasBase}`,
    );
    // The rail keeps its one control at every width; when it is thin the same
    // header toggle turns into the expand icon and centres in the 56px column.
    check(
      "the thin rail's topband still holds exactly one control",
      collapsed.header?.controls.length === 1 &&
        collapsed.header?.box.top === 0 &&
        collapsed.header?.box.bottom === titlebarHeight,
      `controls ${JSON.stringify(collapsed.header?.controls)}, band ${JSON.stringify(collapsed.header?.box)}`,
    );
    check(
      "that control is the expand toggle in the rail",
      collapsed.railToggle?.label === "Expand sidebar" &&
        collapsed.railToggle?.ariaExpanded === "false" &&
        collapsed.railToggle?.ariaControls === "nav-rail" &&
        (collapsed.railToggle?.icon ?? "").includes("lucide-panel-left-open"),
      `label ${JSON.stringify(collapsed.railToggle?.label)}, aria-expanded ${JSON.stringify(collapsed.railToggle?.ariaExpanded)}, controls ${JSON.stringify(collapsed.railToggle?.ariaControls)}, icon ${JSON.stringify(collapsed.railToggle?.icon)}`,
    );
    check(
      "the rail toggle centres in the icon column",
      Boolean(collapsed.railToggle && collapsed.rail) &&
        Math.abs(
          (collapsed.railToggle.box.left + collapsed.railToggle.box.right) / 2 -
            (collapsed.rail.box.left + collapsed.rail.box.right) / 2,
        ) <= 1,
      `toggle ${JSON.stringify(collapsed.railToggle?.box)} in rail ${JSON.stringify(collapsed.rail?.box)}`,
    );
    check(
      "no titlebar toggle appears when the rail narrows",
      collapsed.titlebarToggle === null,
      `titlebar toggle present: ${JSON.stringify(collapsed.titlebarToggle)}`,
    );
    // The chip travels with the rail: in the thin rail it stacks under the Log's
    // icon and reduces to the vault's initials. It is still the same button — the
    // full vault name stays in its accessible name, so nothing is lost but paint.
    check(
      "the titlebar renders no vault chip when the rail is thin",
      collapsed.titlebarVault === null && collapsed.leadingText === "",
      `titlebar chip ${JSON.stringify(collapsed.titlebarVault)}, leading text ${JSON.stringify(collapsed.leadingText)}`,
    );
    check(
      "the thin rail's foot stacks the Log above the chip",
      Boolean(collapsed.foot?.logRow && collapsed.vaultChip) &&
        collapsed.foot.display === "flex" &&
        collapsed.foot.flexDirection === "column" &&
        collapsed.foot.logRow.bottom <= collapsed.vaultChip.box.top + 1,
      `foot direction ${JSON.stringify(collapsed.foot?.flexDirection)}, log ${JSON.stringify(collapsed.foot?.logRow)}, chip ${JSON.stringify(collapsed.vaultChip?.box)}`,
    );
    check(
      "the thin chip is a small square mark in the icon column",
      Boolean(collapsed.vaultChip && collapsed.rail) &&
        collapsed.vaultChip.box.width > 0 &&
        collapsed.vaultChip.box.height > 0 &&
        Math.abs(collapsed.vaultChip.box.width - collapsed.vaultChip.box.height) <= 1 &&
        collapsed.vaultChip.box.width >= 24 &&
        collapsed.vaultChip.box.width <= 32 &&
        collapsed.vaultChip.box.left >= collapsed.rail.box.left &&
        collapsed.vaultChip.box.right <= collapsed.rail.box.right,
      `chip ${JSON.stringify(collapsed.vaultChip?.box)} in rail ${JSON.stringify(collapsed.rail?.box)}`,
    );
    check(
      "the thin chip keeps its full accessible name and its dialog",
      collapsed.vaultChip?.tag === "button" &&
        collapsed.vaultChip?.haspopup === "dialog" &&
        collapsed.vaultChip?.ariaExpanded === "false" &&
        collapsed.vaultChip?.title === "Switch vault" &&
        (collapsed.vaultChip?.ariaLabel ?? "").includes(vaultName),
      `tag ${collapsed.vaultChip?.tag}, popup ${collapsed.vaultChip?.haspopup}, label ${JSON.stringify(collapsed.vaultChip?.ariaLabel)}, title ${JSON.stringify(collapsed.vaultChip?.title)}`,
    );
    check(
      "the thin chip shows the vault's initials and hides the name",
      collapsed.vaultChip?.initials?.text === "HV" &&
        collapsed.vaultChip?.initials?.display !== "none" &&
        collapsed.vaultChip?.name?.display === "none",
      `initials ${JSON.stringify(collapsed.vaultChip?.initials)} name ${JSON.stringify(collapsed.vaultChip?.name)}`,
    );
    check(
      "the thin chip keeps its accent fill and rounded corners",
      isHighlighted(collapsed.vaultChip?.background) &&
        collapsed.vaultChip?.background !== collapsed.rail?.background &&
        collapsed.vaultChip?.radius !== "0px",
      `background ${collapsed.vaultChip?.background} on rail ${collapsed.rail?.background}, radius ${collapsed.vaultChip?.radius}`,
    );
    check(
      "the chip is the last control in the thin rail",
      collapsed.vaultChip?.isLastControl === true,
      "a visible control follows the vault chip in the thin rail",
    );
    check(
      "the sheet starts at the thin rail, not the window's edge",
      collapsed.main?.left === collapsedTrack,
      `sheet left ${collapsed.main?.left}px vs collapsed track ${collapsedTrack}px`,
    );
    check(
      "the collapse gives back only the rail's own difference",
      Boolean(expanded.main && collapsed.main) &&
        expanded.main.left - collapsed.main.left === track - collapsedTrack,
      `reclaimed ${(expanded.main?.left ?? 0) - (collapsed.main?.left ?? 0)}px, rail difference ${track - collapsedTrack}px`,
    );
    check(
      "the collapse leaves the sheet flush to the dock",
      Boolean(collapsed.main && collapsed.chat) &&
        collapsed.main.right === collapsed.chat.box.left,
      `sheet right ${collapsed.main?.right}px vs dock left ${collapsed.chat?.box.left}px`,
    );
    check(
      "corner still belongs to the rail once collapsed",
      collapsed.corner?.insideRail === true,
      `corner element ${JSON.stringify(collapsed.corner)}`,
    );
    check(
      "collapse spares the chat column",
      collapsed.chat?.box.left === expanded.chat?.box.left &&
        collapsed.chat?.box.width === expanded.chat?.box.width,
      `chat ${JSON.stringify(collapsed.chat?.box)} vs ${JSON.stringify(expanded.chat?.box)}`,
    );

    // The thin rail keeps its first level of navigation: the five-wing switcher
    // turns vertical in the icon column rather than disappearing. The labelled
    // chats section and the row labels still leave, and the page rows stay.
    check(
      "the thin rail keeps the wing switcher's band",
      collapsed.wingsBand !== null && collapsed.wingsBand.display !== "none",
      `band display ${JSON.stringify(collapsed.wingsBand?.display)}`,
    );
    check(
      "the thin wing switcher is vertical",
      collapsed.wingSwitcher?.flexDirection === "column",
      `wings flex-direction ${JSON.stringify(collapsed.wingSwitcher?.flexDirection)}`,
    );
    check(
      "the thin rail stacks all five wings in one column",
      Boolean(collapsed.wingSwitcher && collapsed.rail) &&
        collapsed.wingSwitcher.optionCount === 5 &&
        JSON.stringify(collapsed.wingSwitcher.labels) ===
          JSON.stringify(["Home", "Define", "Plan", "Act", "Review"]) &&
        collapsed.wingSwitcher.options.length === 5 &&
        collapsed.wingSwitcher.options.every(
          (option) =>
            option.box.width > 0 &&
            option.box.height > 0 &&
            option.box.left >= collapsed.rail.box.left &&
            option.box.right <= collapsed.rail.box.right &&
            Math.abs(
              option.box.left - collapsed.wingSwitcher.options[0].box.left,
            ) <= 1 &&
            Math.abs(
              option.box.right - collapsed.wingSwitcher.options[0].box.right,
            ) <= 1,
        ) &&
        collapsed.wingSwitcher.options.every(
          (option, index, all) => index === 0 || option.box.top >= all[index - 1].box.bottom,
        ),
      `direction ${JSON.stringify(collapsed.wingSwitcher?.flexDirection)}, options ${JSON.stringify(collapsed.wingSwitcher?.options)}`,
    );
    check(
      "the thin wing switcher keeps Home marked as the active wing",
      collapsed.wingSwitcher?.active === "Home" &&
        collapsed.wingSwitcher.options.filter((option) => option.active).length === 1,
      `active ${JSON.stringify(collapsed.wingSwitcher?.active)}, active options ${JSON.stringify(collapsed.wingSwitcher?.options.filter((option) => option.active).map((option) => option.label))}`,
    );
    // Square in the thin layout too, and still centred: the icon column's own
    // padding is the thin, equal margin on either side of the block.
    check(
      "the thin wing switcher is a square block, not a pill",
      collapsed.wingSwitcher?.borderRadius === "0px" &&
        (collapsed.wingSwitcher?.options ?? []).every(
          (option) => option.borderRadius === "0px",
        ),
      `frame ${JSON.stringify(collapsed.wingSwitcher?.borderRadius)}, tabs ${JSON.stringify(collapsed.wingSwitcher?.options?.map((option) => option.borderRadius))}`,
    );
    check(
      "the thin wing switcher is centred with one thin margin each side",
      Boolean(collapsed.wingSwitcher && collapsed.wingsBand && collapsed.rail) &&
        Math.abs(
          collapsed.wingSwitcher.box.left -
            collapsed.rail.box.left -
            (collapsed.rail.box.right - collapsed.wingSwitcher.box.right),
        ) <= 1 &&
        collapsed.wingSwitcher.box.left - collapsed.rail.box.left >= 3 &&
        collapsed.rail.box.right - collapsed.wingSwitcher.box.right >= 3 &&
        collapsed.wingSwitcher.box.left === collapsed.wingsBand.box.left &&
        collapsed.wingSwitcher.box.right === collapsed.wingsBand.box.right,
      `rail ${JSON.stringify(collapsed.rail?.box)}, band ${JSON.stringify(collapsed.wingsBand?.box)}, switcher ${JSON.stringify(collapsed.wingSwitcher?.box)}`,
    );
    // The words are the tight dimension in 56px: every tab keeps enough vertical
    // padding for its rule to sit clear of its label, and no label overflows.
    check(
      "the thin wing switcher's words are clear of its rules",
      Boolean(collapsed.wingSwitcher) &&
        (collapsed.wingSwitcher?.options ?? []).every(
          (option) =>
            option.padding.top >= 5 &&
            option.padding.bottom >= 5 &&
            option.padding.left >= 1 &&
            option.padding.right >= 1 &&
            option.scrollWidth <= option.clientWidth,
        ),
      `padding ${JSON.stringify(collapsed.wingSwitcher?.options?.map((option) => option.padding))}, widths ${JSON.stringify(collapsed.wingSwitcher?.options?.map((option) => [option.scrollWidth, option.clientWidth]))}`,
    );
    check(
      "the thin rail's pages sit under the wing switcher",
      Boolean(collapsed.wingsBand && collapsed.firstLink) &&
        collapsed.wingsBand.box.top >= (collapsed.header?.box.bottom ?? 0) - 1 &&
        collapsed.firstLink.top >= collapsed.wingsBand.box.bottom - 1,
      `band ${JSON.stringify(collapsed.wingsBand?.box)}, first row ${JSON.stringify(collapsed.firstLink)}, header bottom ${collapsed.header?.box.bottom}`,
    );
    check(
      "the thin rail hides the chats section and the divider above it",
      (collapsed.chats === null || collapsed.chats.display === "none") &&
        (collapsed.chatsDivider === null ||
          collapsed.chatsDivider.display === "none"),
      `chats display ${JSON.stringify(collapsed.chats?.display)}, divider ${JSON.stringify(collapsed.chatsDivider?.display)}`,
    );
    check(
      "the thin rail hides the row labels",
      collapsed.railLabels?.count > 0 && collapsed.railLabels?.display === "none",
      `labels ${collapsed.railLabels?.count} display ${JSON.stringify(collapsed.railLabels?.display)}`,
    );
    check(
      "the thin rail keeps every nav row",
      Boolean(collapsed.railRows?.length) &&
        collapsed.railRows.length === expanded.railRows?.length,
      `${collapsed.railRows?.length} rows vs ${expanded.railRows?.length}`,
    );
    check(
      "the kept rows stay icon-only and keep their names",
      (collapsed.railRows ?? []).every(
        (row) =>
          row.icon !== null &&
          row.labelDisplay === "none" &&
          Boolean(row.title) &&
          Boolean(row.ariaLabel),
      ),
      `rows ${JSON.stringify(collapsed.railRows?.map((row) => ({ title: row.title, icon: row.icon, label: row.labelDisplay })))}`,
    );
    check(
      "the kept rows centre their icons in the icon column",
      Boolean(collapsed.rail) &&
        (collapsed.railRows ?? []).every(
          (row) =>
            row.iconBox !== null &&
            Math.abs(
              (row.iconBox.left + row.iconBox.right) / 2 -
                (collapsed.rail.box.left + collapsed.rail.box.right) / 2,
            ) <= 1,
        ),
      `icon centres ${JSON.stringify(collapsed.railRows?.map((row) => (row.iconBox ? (row.iconBox.left + row.iconBox.right) / 2 : null)))} vs rail centre ${((collapsed.rail?.box.left ?? 0) + (collapsed.rail?.box.right ?? 0)) / 2}`,
    );

    const collapsedShot = await win.webContents.capturePage();
    const collapsedFile = path.join(artifactsDir, "shell-sidebar-collapsed.png");
    fs.writeFileSync(collapsedFile, collapsedShot.toPNG());

    // 7 — expand from the rail's own toggle: the rail never lost the control, so
    // the way back is exactly where the way in was, not in the titlebar.
    const clickedExpand = await clickToggle(".nav-rail .nav-toggle");
    check("expand toggle clicked", clickedExpand, "no rail toggle to click");
    const restored = await settled();

    check(
      "reopen restores the rail box",
      JSON.stringify(restored.rail?.box) === JSON.stringify(expanded.rail?.box),
      `restored ${JSON.stringify(restored.rail?.box)} vs ${JSON.stringify(expanded.rail?.box)}`,
    );
    check(
      "reopen restores the sheet offset",
      restored.main?.left === expanded.main?.left,
      `sheet left ${restored.main?.left}px vs ${expanded.main?.left}px`,
    );
    check(
      "reopen restores the chip's box in the rail foot",
      JSON.stringify(restored.vaultChip?.box) ===
        JSON.stringify(expanded.vaultChip?.box),
      `restored chip ${JSON.stringify(restored.vaultChip?.box)} vs ${JSON.stringify(expanded.vaultChip?.box)}`,
    );
    check(
      "reopen restores the shell's wide arrangement",
      restored.shellNavCollapsed === false &&
        restored.shell?.gridColumns?.[0] === track,
      `shell class ${JSON.stringify(restored.shellClass)}, first track ${JSON.stringify(restored.shell?.gridColumns?.[0])}px vs ${track}px`,
    );
    check(
      "reopen re-shows the rail's contents",
      restored.railLabels?.display !== "none" &&
        restored.chats?.display !== "none" &&
        restored.chatsDivider?.display !== "none" &&
        restored.wingsBand?.display !== "none",
      `labels ${JSON.stringify(restored.railLabels?.display)}, chats ${JSON.stringify(restored.chats?.display)}, divider ${JSON.stringify(restored.chatsDivider?.display)}, wing band ${JSON.stringify(restored.wingsBand?.display)}`,
    );
    check(
      "reopen turns the rail's toggle back into the collapse control",
      restored.railToggle?.label === "Collapse sidebar" &&
        restored.railToggle?.ariaExpanded === "true" &&
        (restored.railToggle?.icon ?? "").includes("lucide-panel-left-close"),
      `label ${JSON.stringify(restored.railToggle?.label)}, aria-expanded ${JSON.stringify(restored.railToggle?.ariaExpanded)}, icon ${JSON.stringify(restored.railToggle?.icon)}`,
    );
    check(
      "reopen restores the foot's single row and the chip's full name",
      restored.foot?.flexDirection === "row" &&
        restored.vaultChip?.name?.display !== "none" &&
        restored.vaultChip?.initials?.display === "none",
      `foot direction ${JSON.stringify(restored.foot?.flexDirection)}, name ${JSON.stringify(restored.vaultChip?.name)}, initials ${JSON.stringify(restored.vaultChip?.initials)}`,
    );
    check(
      "reopen restores the horizontal wing switcher",
      restored.wingSwitcher?.flexDirection === "row",
      `wings flex-direction ${JSON.stringify(restored.wingSwitcher?.flexDirection)}`,
    );

    // 8 — the ladder is a *night* ladder. Day keeps its own order, where the mat
    // and the panels sink below the sheet; the same rig, the same skin and only
    // the mode flipped, so a day that inherited the night inks fails here rather
    // than on the operator's screen.
    await applyTheme("forge-os", "light");
    const day = await settled();

    const dawn = ladderOf(day);
    check(
      "day renders the same skin in its own mode",
      dawn.dataTheme === "light" && dawn.skin === "forge-os",
      `theme ${dawn.dataTheme}, skin ${dawn.skin}`,
    );
    check(
      "day: the mat still sinks below the sheet",
      dawn.luminance.chrome < dawn.luminance.page &&
        dawn.luminance.titlebar < dawn.luminance.page,
      `mat ${dawn.surfaces.chrome} (${dawn.luminance.chrome.toFixed(4)}) and titlebar ${dawn.luminance.titlebar.toFixed(4)} vs sheet ${dawn.surfaces.page} (${dawn.luminance.page.toFixed(4)})`,
    );
    check(
      "day: the strip keeps the one-band rule",
      day.titlebarBackground === day.rail?.background &&
        day.header?.background === "rgba(0, 0, 0, 0)" &&
        dawn.luminance.titlebar === dawn.luminance.chrome,
      `strip ${day.titlebarBackground} vs rail ${day.rail?.background} / topband ${day.header?.background}; day lum ${dawn.luminance.titlebar.toFixed(4)} vs ${dawn.luminance.chrome.toFixed(4)}`,
    );
    check(
      "day: the dock's action band keeps the one-band rule too",
      day.dockActions === day.titlebarBackground &&
        dawn.luminance.dockActions === dawn.luminance.titlebar,
      `bar ${day.dockActions} vs strip ${day.titlebarBackground}; day lum ${dawn.luminance.dockActions.toFixed(4)} vs ${dawn.luminance.titlebar.toFixed(4)}`,
    );
    check(
      "day: the panels still recess below the sheet",
      dawn.luminance.card < dawn.luminance.page,
      `card ${dawn.surfaces.card} (${dawn.luminance.card.toFixed(4)}) vs sheet ${dawn.luminance.page.toFixed(4)}`,
    );

    const dayShot = await win.webContents.capturePage();
    const dayFile = path.join(artifactsDir, "shell-sidebar-day.png");
    fs.writeFileSync(dayFile, dayShot.toPNG());

    // 8a — the scrollbar is chrome, so it takes the same two claims the ladder
    // does: it is the app's own bar in both modes, and its ink comes from the
    // palette that is on. Measured here in daylight, where a wrong ink is a dark
    // smudge on a white sheet rather than a subtlety.
    at("scroll-chrome: at rest");
    // The X server parks the pointer over the middle of the window, which is over
    // the sheet — so `:hover` is genuinely true before this read and the sheet's
    // bar is drawn in its hovered strength. Park the pointer on the rail's header
    // (no scroller there) and let a frame pass, so "at rest" is measured at rest.
    win.webContents.sendInputEvent({ type: "mouseMove", x: 2, y: 2 });
    await new Promise((resolve) => setTimeout(resolve, 120));
    const dayScroll = await run(SCROLL_CHROME);
    checkScrollChrome("day", dayScroll);
    check(
      "day: the resting read is taken with nothing hovered",
      dayScroll.sheet?.hovered === false && dayScroll.transcript?.hovered === false,
      `sheet hovered ${dayScroll.sheet?.hovered}, transcript hovered ${dayScroll.transcript?.hovered}`,
    );

    // This read IS the resting state now; the hovered one is produced below by
    // the only device that can force it on a hidden window.
    const scrollRest = {
      sheet: dayScroll.sheet?.thumbBackground ?? null,
      transcript: dayScroll.transcript?.thumbBackground ?? null,
    };
    let scrollSheetHover = { sheet: null, transcript: null };
    let scrollHover = { sheet: null, transcript: null };

    /** Wait for painted frames, bounded — the settle a style change needs. */
    const paint = () =>
      run(
        `new Promise((resolve) => {
           let frames = 0;
           const tick = () => {
             frames += 1;
             if (frames >= 3) resolve(true);
             else requestAnimationFrame(tick);
           };
           requestAnimationFrame(tick);
         })`,
      );

    // And the bar is hover-only, which is the whole of the Hermes treatment: not
    // drawn at rest, drawn when the pointer is in the region it belongs to, and
    // still not drawn in the *other* region — a custom scrollbar follows its own
    // scroller, not hover anywhere in the app.
    //
    // A hidden window cannot be made to hover. That is measured, not assumed: with
    // the pointer dispatched through the browser's own input pipeline,
    // `el.matches(":hover")` still reads false in this rig, so every painted
    // reading of the hovered bar returned the resting one. The device that can
    // produce the state is the one DevTools uses — `CSS.forcePseudoState` over the
    // debugger — and it is used here for exactly that reason. Where the debugger
    // is unavailable the claims below are not silently skipped: `hoverForced` in
    // the report says so, and the resting, gutter and ink claims still carry.
    const forced = { hoverForced: false, error: null };
    const forcePseudo = async (selector, on) => {
      const dbg = win.webContents.debugger;
      if (!dbg.isAttached()) {
        dbg.attach("1.3");
        await dbg.sendCommand("DOM.enable");
        await dbg.sendCommand("CSS.enable");
      }
      const { root } = await dbg.sendCommand("DOM.getDocument", { depth: 1 });
      const { nodeId } = await dbg.sendCommand("DOM.querySelector", {
        nodeId: root.nodeId,
        selector,
      });
      if (!nodeId) throw new Error(`no node for ${selector}`);
      await dbg.sendCommand("CSS.forcePseudoState", {
        nodeId,
        forcedPseudoClasses: on ? ["hover"] : [],
      });
    };
    // No strip capture here, deliberately.
    //
    // A 1:1 crop of the edge is the obvious visual proof, and it cannot be taken
    // from this rig: `capturePage` of a small rect stops settling once the
    // debugger session below is open — the window never returns a bitmap and the
    // rig dies on its own watchdog. That was measured, twice, and it is also why
    // the crops taken before the state was forced came back byte-identical.
    //
    // So the hover claim rests on the computed thumb — which does change, and which
    // went red before the state was forced — and the visual check is the full-window
    // captures, where the resting bar is now drawn and therefore visible, plus the
    // running app where the pointer is real.

    at("scroll-chrome: forced hover");
    try {
      await forcePseudo(".shell__content", true);
      await paint();
      const overSheet = await run(SCROLL_CHROME);
      await forcePseudo(".shell__content", false);
      await forcePseudo(".chat-panel__body", true);
      await paint();
      const overTranscript = await run(SCROLL_CHROME);
      await forcePseudo(".chat-panel__body", false);

      scrollSheetHover = {
        sheet: overSheet.sheet?.thumbBackground ?? null,
        transcript: overSheet.transcript?.thumbBackground ?? null,
      };
      scrollHover = {
        transcript: overTranscript.transcript?.thumbBackground ?? null,
        sheet: overTranscript.sheet?.thumbBackground ?? null,
      };
      forced.hoverForced = true;
    } catch (error) {
      forced.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
    }

    check(
      "day: at rest both regions draw a quiet thumb",
      alphaOf(scrollRest.sheet) > 0 && alphaOf(scrollRest.transcript) > 0,
      `sheet ${JSON.stringify(scrollRest.sheet)}, transcript ${JSON.stringify(scrollRest.transcript)}`,
    );
    if (forced.hoverForced) {
      check(
        "day: hovering the sheet strengthens its thumb and leaves the transcript at rest",
        alphaOf(scrollSheetHover.sheet) > alphaOf(scrollRest.sheet) &&
          alphaOf(scrollSheetHover.transcript) === alphaOf(scrollRest.transcript),
        `sheet ${JSON.stringify(scrollSheetHover.sheet)} (rest ${JSON.stringify(scrollRest.sheet)}), transcript ${JSON.stringify(scrollSheetHover.transcript)}`,
      );
      check(
        "day: hovering the transcript strengthens its thumb and leaves the sheet at rest",
        alphaOf(scrollHover.transcript) > alphaOf(scrollRest.transcript) &&
          alphaOf(scrollHover.sheet) === alphaOf(scrollRest.sheet),
        `transcript ${JSON.stringify(scrollHover.transcript)} (rest ${JSON.stringify(scrollRest.transcript)}), sheet ${JSON.stringify(scrollHover.sheet)}`,
      );
    } else {
      failures.push(
        `day: the hovered scrollbar was NOT measured — the debugger could not force :hover (${forced.error ?? "unknown"})`,
      );
    }

    // 9 — the night ladder holds for every dark palette, not just the default one.
    // The same claims per palette: the page canvas is the deepest surface in the
    // window, the cards step up off it, the mat is its own ink and not the page,
    // and the titlebar strip and the dock's action row take one step below the mat.
    const skins = {};
    const scrolls = {};
    const skinShots = [];
    for (const skinName of NIGHT_SKINS) {
      await applyTheme(skinName, "dark");
      const ladder = ladderOf(await settled());
      skins[skinName] = ladder;

      // The scrollbar rides the same sweep: it is chrome, so every palette has to
      // give it its own mid ink, and the app's own bar has to survive every one.
      const scroll = await run(SCROLL_CHROME);
      scrolls[skinName] = scroll;
      checkScrollChrome(`night[${skinName}]`, scroll);

      const skinShot = await win.webContents.capturePage();
      const skinFile = path.join(artifactsDir, `shell-sidebar-night-${skinName}.png`);
      fs.writeFileSync(skinFile, skinShot.toPNG());
      // The strip and the sheet's leading corner, 1:1, in this palette: the two
      // surfaces the corner change and the titlebar token are about, side by side
      // where they meet.
      const skinCornerShot = await win.webContents.capturePage({
        x: 0,
        y: 0,
        width: 420,
        height: 260,
      });
      const skinCornerFile = path.join(
        artifactsDir,
        `shell-sidebar-night-${skinName}-corner.png`,
      );
      fs.writeFileSync(skinCornerFile, skinCornerShot.toPNG());
      skinShots.push(skinCornerFile);
      // The dock's bottom bar, 1:1, in this palette: the strip's fill on the
      // action row, the collapse control and the build number at the trailing end.
      const skinDockShot = await win.webContents.capturePage({
        x: Math.max(0, viewportWidth - 440),
        y: Math.max(0, viewportHeight - 120),
        width: Math.min(440, viewportWidth),
        height: 120,
      });
      const skinDockFile = path.join(
        artifactsDir,
        `shell-sidebar-night-${skinName}-dock-bar.png`,
      );
      fs.writeFileSync(skinDockFile, skinDockShot.toPNG());
      skinShots.push(skinDockFile);
      skinShots.push(skinFile);

      const { luminance, surfaces, tokens } = ladder;
      const floors = [
        "chrome",
        "titlebar",
        "dock",
        "dockActions",
        "card",
        "viewCard",
      ];
      const lum = (key) => (luminance[key] ?? Number.NaN).toFixed(4);
      check(
        `night[${skinName}]: the rig is on that skin`,
        ladder.skin === skinName && ladder.dataTheme === "dark",
        `theme ${ladder.dataTheme}, skin ${ladder.skin}`,
      );
      check(
        `night[${skinName}]: every surface was measured`,
        floors.every((key) => Number.isFinite(luminance[key])),
        `fills ${JSON.stringify(surfaces)}`,
      );
      check(
        `night[${skinName}]: the dock's action band wears the strip's fill`,
        surfaces.dockActions === surfaces.titlebar &&
          tokens.canvasBase === tokens.mutedSurface,
        `bar ${surfaces.dockActions} vs strip ${surfaces.titlebar}; tokens ${tokens.canvasBase} vs ${tokens.mutedSurface}`,
      );
      // Every night palette gets the strip's and the bar's own step, whatever its
      // mat is: darker than the rail, still clear of the page they cap.
      check(
        `night[${skinName}]: the titlebar and the dock's bar step below the mat`,
        surfaces.titlebar !== surfaces.chrome &&
          surfaces.dockActions !== surfaces.chrome &&
          luminance.titlebar < luminance.chrome &&
          luminance.titlebar > luminance.page &&
          luminance.dockActions < luminance.chrome &&
          luminance.dockActions > luminance.page,
        `strip ${surfaces.titlebar} (${lum("titlebar")}) / bar ${surfaces.dockActions} (${lum("dockActions")}) between mat ${surfaces.chrome} (${lum("chrome")}) and page ${surfaces.page} (${lum("page")})`,
      );
      // An imported theme can carry its own elevation direction. `nous` is a
      // faithful copy of GitHub Dark Default, whose cards sit *below* its page.
      // The inverted branch asserts that direction rather than skipping the
      // claim, so a palette that drifts either way still fails.
      const inverted =
        (await run(
          `window.shellHarnessDarkLadder?.(${JSON.stringify(skinName)}) ?? "standard"`,
        )) === "inverted";
      if (inverted) {
        check(
          `night[${skinName}]: the cards sit below the page canvas (upstream ladder)`,
          luminance.card <= luminance.page && luminance.viewCard <= luminance.page,
          `card ${surfaces.card} (${lum("card")}) / viewCard ${surfaces.viewCard} (${lum("viewCard")}) vs page ${surfaces.page} (${lum("page")}) — this skin declares darkLadder "inverted"`,
        );
        check(
          `night[${skinName}]: the mat is still its own ink, above the page`,
          surfaces.chrome !== surfaces.page && luminance.chrome > luminance.page,
          `mat ${surfaces.chrome} (${lum("chrome")}) vs page ${surfaces.page} (${lum("page")})`,
        );
      } else {
        check(
          `night[${skinName}]: the page canvas is the darkest surface in the window`,
          floors.every((key) => luminance[key] >= luminance.page),
          `page ${lum("page")} against ${JSON.stringify(Object.fromEntries(floors.map((key) => [key, lum(key)])))}`,
        );
        check(
          `night[${skinName}]: the mat is its own ink, not the page`,
          surfaces.chrome !== surfaces.page && luminance.chrome > luminance.page,
          `mat ${surfaces.chrome} (${lum("chrome")}) vs page ${surfaces.page} (${lum("page")})`,
        );
        check(
          `night[${skinName}]: the cards step up off the page canvas`,
          luminance.card > luminance.page && luminance.viewCard > luminance.page,
          `card ${surfaces.card} (${lum("card")}) vs page ${surfaces.page} (${lum("page")})`,
        );
      }
    }

    report = {
      url,
      ranAt: new Date().toISOString(),
      window: { ...DEFAULT_SIZE },
      vaultName,
      tokens: expanded.tokens,
      expanded,
      collapsed,
      restored,
      // The rail switcher's own trip: the Define sample and the Home sample it
      // came back to. The tests read the rail rows off these, so the claim that
      // the control navigates is made on the shipping switcher.
      wingSwitch: { defined, home: homeAgain },
      day,
      ladder: { night, day: dawn, skins },
      // Every overlay hand-off the provider (and the harness's repaint stand-in)
      // made, oldest first: the native caption strip's fill is the titlebar's.
      overlay: overlayCalls,
      scroll: {
        day: dayScroll,
        night: scrolls,
        hover: {
          pointerOut: scrollRest,
          overSheet: scrollSheetHover,
          overTranscript: scrollHover,
          // How the hovered state was produced. A hidden window cannot be made to
          // hover by dispatching a pointer (`matches(":hover")` stays false), so the
          // state is forced through the debugger, the way DevTools' `:hov` panel
          // does. Recorded here because it is the difference between a measured
          // claim and an unmeasurable one.
          forcedByDebugger: forced.hoverForced,
          forceError: forced.error,
        },
        // Whether this engine answers for the scrollbar pseudo-elements at all.
        // Where it does not, the gutter is the claim that carries this section,
        // and the absence is visible here instead of passing for a held one.
        pseudoReadable: dayScroll.sheet?.thumbBackground !== null,
      },
      reclaimedPx: (expanded.main?.left ?? 0) - (collapsed.main?.left ?? 0),
      screenshots: [
        expandedFile,
        cornerFile,
        seamFile,
        bandFile,
        collapsedFile,
        dayFile,
        ...skinShots,
      ],
      failures,
      pass: failures.length === 0,
    };
  } catch (error) {
    report = {
      url,
      ranAt: new Date().toISOString(),
      failures: [
        ...failures,
        `threw at ${step}: ${error instanceof Error ? error.message : String(error)}`,
      ],
      pass: false,
    };
  } finally {
    clearTimeout(timeout);
  }

  const reportFile = path.join(artifactsDir, "shell-sidebar.json");
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  const rows = [report.expanded, report.collapsed, report.restored].filter(
    (state) => state && state.tokens,
  );
  const labels = ["expanded", "collapsed", "restored"];
  // The rail keeps the same single toggle in its own header at both widths, so
  // the column is always the toggle's box — there is no second, titlebar-placed
  // control to fall back to.
  const railToggleLeft = (state) =>
    state.railToggle?.box ? String(state.railToggle.box.left) : "—";
  const table = [
    ["state", "rail L/T/B", "rail size", "band ctrls", "toggle L", "foot dir", "chip L/W", "sheet L", "corner"],
  ];
  for (let i = 0; i < rows.length; i += 1) {
    const state = rows[i];
    table.push([
      labels[i],
      state.rail ? `${state.rail.box.left}/${state.rail.box.top}/${state.rail.box.bottom}` : "none",
      state.rail ? `${state.rail.box.width}x${state.rail.box.height}` : "—",
      state.header ? String(state.header.controls.length) : "—",
      railToggleLeft(state),
      String(state.foot?.flexDirection ?? "—"),
      state.vaultChip
        ? `${state.vaultChip.box.left}x${state.vaultChip.box.width}`
        : "—",
      String(state.main?.left ?? "—"),
      state.corner ? (state.corner.insideRail ? "rail" : "titlebar") : "—",
    ]);
  }
  const widths = table[0].map((_, i) => Math.max(...table.map((row) => row[i].length)));
  const format = (row) => row.map((cell, i) => cell.padEnd(widths[i])).join("  ");
  for (const row of table) console.log(format(row));

  // The ladder, palette by palette: surface ink and its luminance, so the ordering
  // the run asserts is readable without opening the JSON.
  if (report.ladder) {
    const cell = (data, key) =>
      data?.surfaces?.[key]
        ? `${data.surfaces[key]} ${(data.luminance[key] ?? Number.NaN).toFixed(4)}`
        : "—";
    const rows = [
      ["palette", "mat (chrome)", "page canvas", "card", "dock action band"],
    ];
    const row = (label, data) =>
      rows.push([
        label,
        cell(data, "chrome"),
        cell(data, "page"),
        cell(data, "card"),
        cell(data, "dockActions"),
      ]);
    for (const [name, data] of Object.entries(report.ladder.skins ?? {})) {
      row(`night ${name}`, data);
    }
    if (report.ladder.day) row("day forge-os", report.ladder.day);
    const widths = rows[0].map((_, i) =>
      Math.max(...rows.map((row) => row[i].length)),
    );
    console.log("");
    for (const row of rows) {
      console.log(row.map((value, i) => value.padEnd(widths[i])).join("  "));
    }
  }

  // The scrollbar, palette by palette: the gutter that proves the app's bar
  // replaced the platform's, and the ink it drew with.
  if (report.scroll) {
    const rows = [["palette", "sheet gutter", "sheet thumb ink", "transcript gutter", "transcript thumb ink"]];
    const row = (label, data) =>
      rows.push([
        label,
        data?.sheet ? `${data.sheet.gutterX}px` : "—",
        data?.thumbToken || "—",
        data?.transcript ? `${data.transcript.gutterX}px` : "—",
        data?.thumbToken || "—",
      ]);
    row("day forge-os", report.scroll.day);
    for (const [name, data] of Object.entries(report.scroll.night ?? {})) {
      row(`night ${name}`, data);
    }
    rows.push([
      "pointer out",
      "—",
      JSON.stringify(report.scroll.hover?.pointerOut?.sheet ?? null),
      "—",
      JSON.stringify(report.scroll.hover?.pointerOut?.transcript ?? null),
    ]);
    rows.push([
      "over sheet",
      "—",
      JSON.stringify(report.scroll.hover?.overSheet?.sheet ?? null),
      "—",
      JSON.stringify(report.scroll.hover?.overSheet?.transcript ?? null),
    ]);
    rows.push([
      "over transcript",
      "—",
      JSON.stringify(report.scroll.hover?.overTranscript?.sheet ?? null),
      "—",
      JSON.stringify(report.scroll.hover?.overTranscript?.transcript ?? null),
    ]);
    const widths = rows[0].map((_, i) =>
      Math.max(...rows.map((r) => r[i].length)),
    );
    console.log("");
    for (const r of rows) {
      console.log(r.map((value, i) => value.padEnd(widths[i])).join("  "));
    }
    console.log(
      `scrollbar pseudo-elements readable: ${report.scroll.pseudoReadable}`,
    );
  }

  console.log("");
  console.log(`report: ${reportFile}`);
  for (const failure of report.failures ?? []) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "shell sidebar: PASS" : "shell sidebar: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`shell-sidebar: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });

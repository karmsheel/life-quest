/**
 * Theme files, v2 — the vertical slice, judged on the REAL app.
 *
 * What the slice claims, and how this rig can falsify each:
 *
 *  1. `a-written-theme-file-is-worn-without-a-restart` — the rig writes a theme
 *     file into the app profile's `themes/` directory (the gesture the companion
 *     makes) and the real shell repaints: the wing switcher leaves the rail's top
 *     band for the window strip, and the area lens leaves the strip's centre for
 *     a bottom dock. No reload, no IPC from the renderer.
 *  2. `the-preview-asks-before-it-stays` — the preview bar is on screen, and it
 *     names the file. A theme that arrived without consent is not silently kept.
 *  3. `an-unkept-theme-reverts-by-itself` — after the ten-second window the
 *     shell is back on the chrome it had, with no preview bar and the wing band
 *     back in the rail. This is the "a bad write cannot strand the operator"
 *     half of the design.
 *  4. `keep-persists-the-theme-across-a-reload` — Keep is pressed, the renderer
 *     reloads, and the moved chrome is still where the theme put it: the choice
 *     is a file name in storage, not a lucky in-memory state.
 *  5. `an-invalid-theme-is-refused-by-name` — a theme with a made-up placement
 *     is refused with an error that names the field, and the chrome does not
 *     move. A silent refusal would look exactly like a working theme that
 *     happened to change nothing.
 *  6. `material-lands-on-the-document` — the theme's radius/density/motion are
 *     written to the document root (the material layer), and are not free CSS.
 *  7. `a-bare-area-lens-wears-no-frame` — the rig writes a theme file with
 *     chrome.domainSwitcher.frame: "bare" on the floating dock; the dock
 *     measures transparent, borderless, shadowless, square-cornered and
 *     1.25rem from both window edges, the inner lens frame is stripped too,
 *     each row paints its own surface, and a made-up frame value
 *     ("bare-metal") is refused naming chrome.domainSwitcher.frame.
 *
 * The world is throwaway: its own profile, its own vault, a stub `hermes` first
 * on PATH, and its own MCP ports. `bootForE2e` runs the product's own main
 * process, preload and renderer, so this is the shipped shell and not a harness
 * page pretending to be it.
 *
 * Run with the checkout's dev server up (`lifequest-e2e` does both):
 *
 *   LQ_THEME_WORLD=<dir> <electron> e2e/theme-chrome.electron.mjs
 *
 * Exit 0 = every check held. The report is `e2e/artifacts/themes-v2.json`, and
 * the pictures are `e2e/artifacts/themes-v2-preview.png` and
 * `e2e/artifacts/themes-v2-kept.png`.
 */
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import {
  countWeeklyVaultFiles,
  createDomain,
  createVault,
  vaultPaths,
} from "@lifequest/vault-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(here, "..");
const artifactsDir = path.join(here, "artifacts");

app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");

const world = process.env.LQ_THEME_WORLD;
const DEV_URL = process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173";
const REPORT = path.join(artifactsDir, "themes-v2.json");
const PREVIEW_PNG = path.join(artifactsDir, "themes-v2-preview.png");
const KEPT_PNG = path.join(artifactsDir, "themes-v2-kept.png");
const FLOATING_PNG = path.join(artifactsDir, "themes-v2-floating.png");
const BARE_FRAME_PNG = path.join(artifactsDir, "themes-v2-bare-frame.png");
const SETTINGS_PNG = path.join(artifactsDir, "themes-v2-settings.png");
const MATERIAL_PNG = path.join(artifactsDir, "themes-v2-material.png");
const LAYOUT_PNG = path.join(artifactsDir, "themes-v2-layout.png");
const VARIANTS_PNG = path.join(artifactsDir, "themes-v2-variants.png");
const SIDEBAR_RIGHT_PNG = path.join(artifactsDir, "themes-v2-sidebar-right.png");
const DOCK_LEFT_PNG = path.join(artifactsDir, "themes-v2-dock-left.png");
const FLOATING_RAIL_PNG = path.join(artifactsDir, "themes-v2-floating-rail.png");
const OUTSIDE_PNG = path.join(artifactsDir, "themes-v2-outside-theme.png");
const SCENE_PNG = path.join(artifactsDir, "themes-v2-scene.png");
const FRAMES_PNG = path.join(artifactsDir, "themes-v2-frames.png");
const SHOWCASE_PNG = path.join(artifactsDir, "themes-v2-showcase.png");
const R3_GATE_PNG = path.join(artifactsDir, "themes-v2-r3-gate.png");
const FOCUS_FLOATING_PNG = path.join(artifactsDir, "themes-v2-focus-floating.png");
const R4_VALIDATION_JSON = path.join(artifactsDir, "themes-v2-r4-validation.json");
const COMPOSITION_PNG = path.join(artifactsDir, "themes-v2-composition.png");
const COMPOSITION_SETTINGS_PNG = path.join(
  artifactsDir,
  "themes-v2-composition-settings.png",
);
const COMPOSITION_ORBIT_PNG = path.join(
  artifactsDir,
  "themes-v2-composition-orbit.png",
);
const COMPOSITION_GRID_PNG = path.join(
  artifactsDir,
  "themes-v2-composition-grid.png",
);
const COMPOSITION_VOCABULARY_PNG = path.join(
  artifactsDir,
  "themes-v2-composition-vocabulary.png",
);
const HELIOS_PNG = path.join(artifactsDir, "themes-v2-helios.png");
const CUSTOMIZATIONS_PNG = path.join(artifactsDir, "themes-v2-extensions.png");
const CUSTOMIZATIONS_ON_PNG = path.join(
  artifactsDir,
  "themes-v2-extensions-on.png",
);
const CUSTOMIZATIONS_OFF_PNG = path.join(
  artifactsDir,
  "themes-v2-extensions-off.png",
);
const TRUST_PNG = path.join(artifactsDir, "themes-v2-trust.png");
const STUDIO_PNG = path.join(artifactsDir, "themes-v2-studio.png");
const STUDIO_LOOK_PNG = path.join(artifactsDir, "themes-v2-studio-look.png");
const GALLERY_PNG = path.join(artifactsDir, "themes-v2-gallery.png");

const failures = [];
const checks = [];
function check(label, pass, detail = null) {
  checks.push({ label, pass: Boolean(pass), detail });
  if (!pass) failures.push(detail ? `${label}: ${detail}` : label);
  return Boolean(pass);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A Hermes host gateway that is serving this profile, and nothing else.
 *
 * Without a live host the app boots into the companion setup screen instead of
 * a vault — which would make every check about a screen the feature never
 * reaches. The stub answers the two probes the app's attach path makes.
 */
function serveHostGateway() {
  return listen(
    http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname.endsWith("/health")) {
        res.writeHead(200, { "content-type": "text/plain" }).end("ok");
        return;
      }
      if (url.pathname.endsWith("/v1/capabilities")) {
        res.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({
            features: {
              session_list: true,
              session_chat: true,
              session_chat_stream: true,
            },
          }),
        );
        return;
      }
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    }),
  );
}

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server.address().port));
  });
}

/** Two ports that were free a moment ago, for the rig's own MCP doors. */
async function freePorts(n) {
  const held = [];
  const ports = [];
  for (let i = 0; i < n; i += 1) {
    const server = net.createServer();
    ports.push(await listen(server));
    held.push(server);
  }
  await Promise.all(
    held.map((server) => new Promise((r) => server.close(r))),
  );
  return ports;
}

/** The `hermes` on PATH: succeeds for seeding, never brings a host up. */
function writeHermesStub(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  const stub = path.join(binDir, "hermes");
  fs.writeFileSync(
    stub,
    ["#!/bin/sh", 'case "$1" in', "  gateway) exit 1 ;;", "esac", "exit 0", ""].join(
      "\n",
    ),
    { mode: 0o755 },
  );
}

const SAMPLE = `(async () => {
  const previewBar = document.querySelector('[data-testid="theme-preview-bar"]');
  const errorBar = document.querySelector('[data-testid="theme-error"]');
  const radius = getComputedStyle(document.documentElement).getPropertyValue("--radius-lg").trim();
  const wingHost =
    document.querySelector('[data-chrome-place="titlebar-left"]') ||
    document.querySelector('[data-chrome-place="floating-left"]');
  const wingText = wingHost
    ? (wingHost.querySelector('[role="radio"]')?.textContent ?? "").trim()
    : null;
  const state = await window.lifequest?.themeGetState?.();
  return {
    hash: location.hash,
    errors: (window.__lqErrors ?? []).slice(-4),
    shell: Boolean(document.querySelector(".shell")),
    preview: Boolean(previewBar),
    previewText: previewBar ? previewBar.textContent : null,
    error: errorBar ? errorBar.textContent : null,
    railWings: Boolean(document.querySelector(".nav-rail__wings-band")),
    wingTitlebar: Boolean(document.querySelector('[data-chrome-place="titlebar-left"]')),
    wingFloating: Boolean(document.querySelector('[data-chrome-place="floating-left"]')),
    wingText,
    domainBottom: Boolean(document.querySelector('[data-chrome-place="bottom-center"]')),
    domainBelow: Boolean(document.querySelector('[data-chrome-place="below-titlebar"]')),
    domainFloating: Boolean(document.querySelector('[data-chrome-place="floating-bottom-right"]')),
    domainPill: Boolean(document.querySelector(".domain-switcher--pill")),
    // The bare-frame probe reads the floating dock the way a user sees it: the
    // wrapper's own frame, the inner lens frame, and each row's paint.
    bareFrame: (() => {
      const dock = document.querySelector('[data-chrome-place="floating-bottom-right"]');
      if (!dock) return null;
      const style = getComputedStyle(dock);
      const box = dock.getBoundingClientRect();
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      // The fixed-position containing block is the document element, not the
      // viewport, so the corner insets come off its client box.
      const root = document.documentElement;
      const tabs = dock.querySelector(".domain-switcher__tabs");
      const tabsStyle = tabs ? getComputedStyle(tabs) : null;
      const rows = [...dock.querySelectorAll('[role="radio"]')].map((el) => {
        const rowStyle = getComputedStyle(el);
        return {
          background: rowStyle.backgroundColor,
          color: rowStyle.color,
          active: el.getAttribute("aria-checked") === "true",
        };
      });
      return {
        attribute: dock.getAttribute("data-chrome-frame"),
        backgroundColor: style.backgroundColor,
        borderTopWidth: style.borderTopWidth,
        boxShadow: style.boxShadow,
        borderRadius: style.borderRadius,
        padding: style.padding,
        rightGap: root.clientWidth - box.right,
        bottomGap: root.clientHeight - box.bottom,
        innerWidth: window.innerWidth,
        rem,
        tabs: tabsStyle
          ? {
              backgroundColor: tabsStyle.backgroundColor,
              borderTopWidth: tabsStyle.borderTopWidth,
              borderRadius: tabsStyle.borderRadius,
              padding: tabsStyle.padding,
            }
          : null,
        rows,
      };
    })(),
    lensInStrip: Boolean(document.querySelector(".window-titlebar__lens")),
    settingsEntry: Boolean(document.querySelector(".window-titlebar__settings")),
    // The strip's trailing cluster is the day/night control and the gear: the
    // window's full-screen door is the dock's own top-row toggle now, so the
    // old titlebar copy (and its "main page" wording) may not come back.
    titlebarFullScreen: Boolean(
      document.querySelector(".window-titlebar__trailing .chat-focus-toggle"),
    ),
    titlebarMainPage: Boolean(
      document.querySelector('[data-testid="titlebar-main-page"]'),
    ),
    areaNames: [...document.querySelectorAll(".domain-switcher__name")].map((n) => n.textContent.trim()),
    kept: state && state.ok ? state.value.keptFile : null,
    density: document.documentElement.dataset.materialDensity ?? null,
    motion: document.documentElement.dataset.materialMotion ?? null,
    shadowAttr: document.documentElement.dataset.materialShadow ?? null,
    backdropAttr: document.documentElement.dataset.materialBackdrop ?? null,
    typeScaleAttr: document.documentElement.dataset.materialTypeScale ?? null,
    fontSize: getComputedStyle(document.documentElement).fontSize,
    durQuick: getComputedStyle(document.documentElement).getPropertyValue("--dur-quick").trim(),
    shadowSm: getComputedStyle(document.documentElement).getPropertyValue("--shadow-sm").trim(),
    backdrop: (() => {
      const main = document.querySelector(".shell__main");
      return main ? getComputedStyle(main).backgroundImage.slice(0, 80) : null;
    })(),
    radiusLg: radius,
    wingCompact: Boolean(document.querySelector(".nav-rail__wings--compact")),
    railWingLabels: [...document.querySelectorAll(".nav-rail__wings [role='radio']")].map((el) =>
      (el.textContent ?? "").trim(),
    ),
    domainLeftRail: Boolean(document.querySelector('[data-chrome-place="left-rail"]')),
    domainIcons: Boolean(document.querySelector(".domain-switcher--icons")),
    domainList: Boolean(document.querySelector(".domain-switcher--list")),
    areaInitials: [...document.querySelectorAll(".domain-switcher__initial")].map((el) =>
      (el.textContent ?? "").trim(),
    ),
    contentPadTop: (() => {
      const el = document.querySelector(".shell__content");
      return el ? Math.round(parseFloat(getComputedStyle(el).paddingTop)) : null;
    })(),
    railLinkPadY: (() => {
      const el = document.querySelector(".nav-rail__link");
      return el ? Math.round(parseFloat(getComputedStyle(el).paddingTop)) : null;
    })(),
    chatPad: (() => {
      const el = document.querySelector(".chat-panel__body");
      return el ? Math.round(parseFloat(getComputedStyle(el).paddingTop)) : null;
    })(),
    dockLeft: Boolean(document.querySelector(".shell--chat-left")),
    navPlaceAttr: document.documentElement.dataset.chromeNavPlace ?? null,
    innerWidth: window.innerWidth,
    railRect: (() => {
      const el = document.querySelector(".nav-rail");
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        left: Math.round(b.left),
        right: Math.round(b.right),
        top: Math.round(b.top),
        width: Math.round(b.width),
      };
    })(),
    titlebarHeight: (() => {
      const el = document.querySelector(".window-titlebar");
      return el ? Math.round(el.getBoundingClientRect().height) : null;
    })(),
    titlebarSizeAttr: document.documentElement.dataset.chromeTitlebarSize ?? null,
    accentVar: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
    bgVar: getComputedStyle(document.documentElement).getPropertyValue("--background").trim(),
    scenePresetAttr: document.documentElement.dataset.sceneBackdrop ?? null,
    sceneCanvasFrameAttr: document.documentElement.dataset.sceneCanvasFrame ?? null,
    sceneCardFrameAttr: document.documentElement.dataset.sceneCardFrame ?? null,
    canvasFrameBorder: (() => {
      const main = document.querySelector(".shell__main");
      if (!main) return null;
      const after = getComputedStyle(main, "::after");
      const width = parseFloat(after.borderTopWidth);
      return Number.isFinite(width) ? Math.round(width * 10) / 10 : null;
    })(),
    cardProbe: (() => {
      const card = document.querySelector(
        ".home-card, .view-card, .domain-card, .personnel-card, .doc-card, .welcome-card, .settings-card",
      );
      if (!card) return null;
      const style = getComputedStyle(card);
      return {
        border: style.borderTopColor,
        shadow: style.boxShadow,
        background: style.backgroundColor,
      };
    })(),
    sceneIntensityAttr: document.documentElement.dataset.sceneIntensity ?? null,
    sceneLayer: Boolean(document.querySelector(".scene-backdrop")),
    sceneNodes: (() => {
      const layer = document.querySelector(".scene-backdrop");
      if (!layer) return 0;
      return layer.querySelectorAll(".scene-backdrop__star, .scene-backdrop__ring, .scene-backdrop__planet, .scene-backdrop__band").length;
    })(),
    sceneDuration: (() => {
      const node = document.querySelector(".scene-backdrop__star, .scene-backdrop__band");
      if (!node) return null;
      const seconds = parseFloat(getComputedStyle(node).animationDuration);
      return Number.isFinite(seconds) ? Math.round(seconds * 100) / 100 : null;
    })(),
    slotPositioned: (() => {
      const main = document.querySelector(".shell__main");
      return main ? getComputedStyle(main).position : null;
    })(),
    stripPainted: Boolean(document.querySelector(".window-titlebar")),
    compositionMasthead: (() => {
      const slot = document.querySelector('[data-composition-region="page.masthead"]');
      if (!slot) return null;
      return {
        widgets: slot.querySelectorAll('[data-testid="composition-widget"]').length,
        labels: [...slot.querySelectorAll(".composition-widget__label")].map((el) => (el.textContent ?? "").trim()),
        values: [...slot.querySelectorAll(".composition-widget__value")].map((el) => (el.textContent ?? "").trim()),
      };
    })(),
    compositionRailFooter: (() => {
      const slot = document.querySelector('[data-composition-region="rail.footer"]');
      if (!slot) return null;
      return slot.querySelectorAll('[data-testid="composition-widget"]').length;
    })(),
    compositionMeterNow: (() => {
      const meter = document.querySelector('[data-widget-type="meter"]');
      return meter ? meter.getAttribute("aria-valuenow") : null;
    })(),
    compositionMeterMax: (() => {
      const meter = document.querySelector('[data-widget-type="meter"]');
      return meter ? meter.getAttribute("aria-valuemax") : null;
    })(),
    compositionSettings: Boolean(document.querySelector('[data-testid="theme-composition"]')),
    compositionYours: Boolean(document.querySelector('[data-testid="composition-yours"]')),
    compositionOrbit: (() => {
      const slot = document.querySelector('[data-composition-region="page.orbit"]');
      if (!slot) return null;
      const box = slot.getBoundingClientRect();
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      return {
        tag: slot.tagName,
        layout: slot.getAttribute("data-composition-layout"),
        ariaLabel: slot.getAttribute("aria-label"),
        links: [...slot.querySelectorAll('[data-testid="composition-quick-action"]')].map((el) => {
          const r = el.getBoundingClientRect();
          const x = r.left + r.width / 2;
          const y = r.top + r.height / 2;
          return {
            route: el.getAttribute("data-widget-route"),
            href: el.getAttribute("href"),
            label: (el.textContent ?? "").trim(),
            x: Math.round(x),
            y: Math.round(y),
            angle: Math.round((Math.atan2(y - cy, x - cx) * 180) / Math.PI),
          };
        }),
      };
    })(),
    compositionGrid: (() => {
      const slot = document.querySelector('[data-composition-region="page.masthead"]');
      if (!slot || !slot.classList.contains("composition-slot--layout-grid")) {
        return null;
      }
      const widgets = [...slot.querySelectorAll('[data-testid="composition-widget"]')];
      if (widgets.length === 0) return null;
      const columns =
        getComputedStyle(slot).gridTemplateColumns.trim().split(/\\s+/).length;
      return {
        layout: slot.getAttribute("data-composition-layout"),
        columns,
        boxes: widgets.map((el) => {
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.left), y: Math.round(r.top) };
        }),
      };
    })(),
    compositionAnimations: (() => {
      const el = document.querySelector(
        '.composition-slot--page-orbit .composition-widget',
      );
      if (!el) return null;
      const style = getComputedStyle(el);
      return {
        animationName: style.animationName,
        animationDuration: style.animationDuration,
        transitionDuration: style.transitionDuration,
      };
    })(),
    compositionVocabulary: (() => {
      const slots = [...document.querySelectorAll("[data-composition-region]")];
      if (slots.length === 0) return null;
      const widgets = slots.flatMap((slot) => [
        ...slot.querySelectorAll(
          '[data-testid="composition-widget"], [data-testid="composition-quick-action"]',
        ),
      ]);
      if (widgets.length === 0) return null;
      const forbiddenTags = ["img", "iframe", "script", "video", "object", "embed", "button", "form", "input"];
      const forbidden = Object.fromEntries(
        forbiddenTags.map((tag) => [
          tag,
          document.querySelectorAll("[data-composition-region] " + tag).length,
        ]),
      );
      const anchors = [...document.querySelectorAll("[data-composition-region] a")].map(
        (anchor) => anchor.getAttribute("href"),
      );
      const avatar = document.querySelector('[data-widget-type="avatar"]');
      const list = document.querySelector('[data-widget-type="list"]');
      const clock = document.querySelector('[data-widget-type="clock"]');
      const calendar = document.querySelector('[data-widget-type="calendar"]');
      const brief = document.querySelector('[data-widget-type="brief"]');
      return {
        types: [...new Set(widgets.map((widget) => widget.getAttribute("data-widget-type")))].sort(),
        nodes: slots.reduce((total, slot) => total + slot.querySelectorAll("*").length, 0),
        forbidden,
        anchors,
        externalAnchors: anchors.filter((href) => !href || !href.startsWith("#/")),
        urlBackedWidgets: widgets.filter((widget) =>
          getComputedStyle(widget).backgroundImage.includes("url("),
        ).length,
        avatar: avatar
          ? {
              initials: (avatar.querySelector(".composition-avatar__disc")?.textContent ?? "").trim(),
              aria: avatar.getAttribute("aria-label"),
            }
          : null,
        list: list
          ? {
              items: [...list.querySelectorAll("li")].map((li) => (li.textContent ?? "").trim()),
              aria: list.querySelector("ul")?.getAttribute("aria-label") ?? null,
            }
          : null,
        clock: clock
          ? {
              text: (clock.textContent ?? "").trim(),
              aria: clock.getAttribute("aria-label"),
              dateTime: clock.getAttribute("dateTime"),
              formatted: (clock.querySelector(".composition-widget__value")?.textContent ?? "").trim(),
            }
          : null,
        calendar: calendar
          ? {
              days: [...calendar.querySelectorAll(".composition-calendar__day")].map((day) =>
                (day.textContent ?? "").trim(),
              ),
              today: calendar.querySelectorAll('[aria-current="date"]').length,
              aria: calendar.getAttribute("aria-label"),
            }
          : null,
        brief: brief
          ? {
              value: (brief.querySelector(".composition-widget__value")?.textContent ?? "").trim(),
              caption:
                (brief.querySelector(".composition-brief__caption")?.textContent ?? "").trim(),
            }
          : null,
      };
    })(),
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    chatFocus: Boolean(document.querySelector(".shell--chat-focus")),
    pageVisible: (() => {
      const page = document.querySelector(".shell__content");
      if (!page) return null;
      const s = getComputedStyle(page);
      return s.display !== "none" && s.visibility !== "hidden" && page.getBoundingClientRect().width > 1;
    })(),
    railBox: (() => {
      const rail = document.querySelector(".nav-rail");
      if (!rail) return null;
      const r = rail.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width) };
    })(),
    dockBox: (() => {
      const dock = document.querySelector(".chat-panel");
      if (!dock) return null;
      const r = dock.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width) };
    })(),
    dividerPainted: Boolean(document.querySelector(".chat-divider")),
    scenePointerEvents: (() => {
      const layer = document.querySelector(".scene-backdrop");
      return layer ? getComputedStyle(layer).pointerEvents : null;
    })(),
    sceneAriaHidden: (() => {
      const layer = document.querySelector(".scene-backdrop");
      return layer ? layer.getAttribute("aria-hidden") : null;
    })(),
    titlebarVar: document.documentElement.style.getPropertyValue("--window-titlebar-height") ?? null,
    mainRect: (() => {
      const el = document.querySelector(".shell__main");
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { left: Math.round(b.left), right: Math.round(b.right) };
    })(),
    chatRect: (() => {
      const el = document.querySelector(".chat-panel");
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { left: Math.round(b.left), right: Math.round(b.right) };
    })(),
    lensCenter: (() => {
      const el = document.querySelector(".window-titlebar__lens");
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return Math.round(b.left + b.width / 2);
    })(),
    navWidthAttr: document.documentElement.dataset.chromeNavWidth ?? null,
    navWidthVar: getComputedStyle(document.documentElement)
      .getPropertyValue("--shell-sidebar-width")
      .trim(),
    railWidth: (() => {
      const rail = document.querySelector(".nav-rail");
      return rail ? Math.round(rail.getBoundingClientRect().width) : null;
    })(),
    customizationsPage: Boolean(document.querySelector('[data-testid="customizations-page"]')),
    customizationsRows: document.querySelectorAll(
      '[data-testid="customizations-page"] li[data-testid^="customization-"]',
    ).length,
    customizationsCountText:
      document.querySelector('[data-testid="customizations-count"]')?.textContent?.trim() ?? null,
    customizationsActive: Boolean(document.querySelector('[data-testid="customization-active"]')),
    // S1 Trust: the editor's version history and the page's import line.
    historyRows: (() => {
      const section = document.querySelector('[data-testid="customization-history"]');
      if (!section) return null;
      return [...section.querySelectorAll('[data-testid="customization-history-row"]')].map((row) => ({
        id: row.getAttribute("data-version-id"),
        label: row.getAttribute("data-label"),
        text: (row.textContent || "").replace(/\\s+/g, " ").trim(),
        restore: Boolean(row.querySelector('[data-testid="customization-history-restore"]')),
      }));
    })(),
    historyEmpty: (() => {
      const section = document.querySelector('[data-testid="customization-history"]');
      if (!section) return false;
      const rows = section.querySelectorAll('[data-testid="customization-history-row"]');
      return rows.length === 0 && (section.textContent || "").includes("No saved versions yet");
    })(),
    editorTabs: ["customization-editor-tab-fields", "customization-editor-tab-json"].filter((id) =>
      Boolean(document.querySelector('[data-testid="' + id + '"]')),
    ),
    importStatus:
      document.querySelector('[data-testid="customizations-status"]')?.textContent?.trim() ?? null,
    // S2 Studio: the tab the editor opened on, and the composition editor's own
    // surface — chips, offers, draft paint and verdict.
    editorTab: (() => {
      const fields = document.querySelector('[data-testid="customization-editor-tab-fields"]');
      const json = document.querySelector('[data-testid="customization-editor-tab-json"]');
      if (!fields || !json) return null;
      if (fields.getAttribute("aria-selected") === "true") return "fields";
      if (json.getAttribute("aria-selected") === "true") return "json";
      return null;
    })(),
    studioWidgetCount: (() => {
      const studio = document.querySelector('[data-testid="customization-studio"]');
      if (!studio) return null;
      return studio.querySelectorAll('[data-testid="studio-widget-chip"]').length;
    })(),
    studioOffers: (() => {
      const studio = document.querySelector('[data-testid="customization-studio"]');
      if (!studio) return null;
      const optionValues = (testId) => {
        const select = studio.querySelector('[data-testid="' + testId + '"]');
        if (!select) return null;
        return [...select.querySelectorAll("option")].map((option) => option.value);
      };
      const addButton = studio.querySelector('[data-testid="studio-add-widget"]');
      const addNote = studio.querySelector('[data-testid="studio-add-note"]');
      const labelInput = studio.querySelector('[data-testid="studio-widget-label"]');
      return {
        regions: optionValues("studio-add-region"),
        types: optionValues("studio-add-type"),
        labelMaxLength: labelInput ? labelInput.maxLength : null,
        addDisabled: Boolean(addButton && addButton.disabled),
        addNote: addNote ? (addNote.textContent || "").trim() : null,
        regionIds: [...studio.querySelectorAll('[data-testid^="studio-region-"]')].map(
          (region) => region.getAttribute("data-testid"),
        ),
        layouts: ["studio-layout-stack", "studio-layout-grid", "studio-layout-polar"].filter(
          (id) => Boolean(studio.querySelector('[data-testid="' + id + '"]')),
        ),
        summary:
          (studio.querySelector('[data-testid="studio-summary"]')?.textContent ?? "").trim() || null,
        chips: [...studio.querySelectorAll('[data-testid="studio-widget-chip"]')].map((chip) => ({
          index: Number(chip.getAttribute("data-index")),
          selected:
            chip.getAttribute("aria-pressed") === "true" ||
            chip.getAttribute("data-selected") === "true",
        })),
      };
    })(),
    draftPainted: (() => {
      const regions = [...document.querySelectorAll("[data-composition-region]")];
      return regions.some((region) =>
        Boolean(region.querySelector('[data-testid="composition-widget"]')),
      );
    })(),
    studioStatus:
      document.querySelector('[data-testid="studio-status"]')?.textContent?.trim() ?? null,
    // S3 Studio: the look sections and the palette editor's live verdict.
    studioSection: (() => {
      const active = [...document.querySelectorAll('[data-testid^="studio-section-tab-"]')].find(
        (tab) => tab.getAttribute("aria-selected") === "true",
      );
      if (!active) return null;
      return (active.getAttribute("data-testid") ?? "").replace("studio-section-tab-", "");
    })(),
    draftWingPlace: (() => {
      if (document.querySelector(".nav-rail__wings-band")) return "rail-top";
      if (document.querySelector('[data-chrome-place="titlebar-left"]')) return "titlebar-left";
      if (document.querySelector('[data-chrome-place="floating-left"]')) return "floating-left";
      return null;
    })(),
    studioMaterialRadius: (() => {
      // The Settings controls are segmented role="radio" groups, so the
      // selected option carries aria-checked, not aria-pressed. Scope to the
      // radius group itself so the axis cannot be confused with the others.
      const group = document.querySelector('[data-testid="studio-material-radius"]');
      if (!group) return null;
      const options = [...group.querySelectorAll('[role="radio"], button')];
      const active = options.find(
        (option) =>
          option.getAttribute("aria-checked") === "true" ||
          option.getAttribute("aria-pressed") === "true",
      );
      return active ? active.getAttribute("data-testid") : null;
    })(),
    studioPaletteVerdict:
      document.querySelector('[data-testid="studio-palette-verdict"]')?.textContent?.trim() ?? null,
    studioPaletteEnabled: (() => {
      const read = (id) => {
        const control = document.querySelector('[data-testid="' + id + '"]');
        if (!control) return null;
        if (control.tagName === "INPUT") return Boolean(control.checked);
        return control.getAttribute("aria-pressed") === "true";
      };
      return {
        light: read("studio-palette-light-enabled"),
        dark: read("studio-palette-dark-enabled"),
      };
    })(),
    paletteTokens: (() => {
      const palette = document.querySelector('[data-testid="studio-palette"]');
      if (!palette) return null;
      const group = (name) => {
        const prefix = "studio-palette-" + name + "-";
        const tokens = {};
        for (const control of palette.querySelectorAll('[data-testid^="' + prefix + '"]')) {
          const id = control.getAttribute("data-testid") ?? "";
          const token = id.slice(prefix.length);
          if (token === "enabled") continue;
          if (control.tagName !== "INPUT" || control.type === "checkbox") continue;
          tokens[token] = control.value;
        }
        return tokens;
      };
      return { light: group("light"), dark: group("dark") };
    })(),
    // S4 Gallery: which cards wear the bundled-example chip, and its one line.
    galleryChips: (() => {
      const page = document.querySelector('[data-testid="customizations-page"]');
      if (!page) return null;
      return [...page.querySelectorAll("li[data-testid^='customization-']")].map((card) => ({
        file: (card.getAttribute("data-testid") ?? "").replace(/^customization-/, "") + ".json",
        chip: Boolean(card.querySelector('[data-testid="customization-gallery-chip"]')),
        chipText:
          (card.querySelector('[data-testid="customization-gallery-chip"]')?.textContent ?? "").trim() ||
          null,
        note:
          (card.querySelector('[data-testid="customization-gallery-note"]')?.textContent ?? "").trim() ||
          null,
      }));
    })(),
    galleryNotes: (() => {
      const page = document.querySelector('[data-testid="customizations-page"]');
      if (!page) return null;
      return [...page.querySelectorAll('[data-testid="customization-gallery-note"]')].map((note) =>
        (note.textContent ?? "").trim(),
      );
    })(),
  };
})()`;

const THEME = {
  name: "solar-system",
  label: "Solar System",
  description: "The wing switcher rides the window strip; the area lens floats at the foot.",
  chrome: {
    wingSwitcher: { place: "titlebar-left", variant: "labels" },
    domainSwitcher: { place: "bottom-center", variant: "pill" },
  },
  material: { radius: "round", density: "compact", motion: "none" },
};

const BAD_THEME = {
  name: "bad-chrome",
  label: "Bad Chrome",
  chrome: { wingSwitcher: { place: "sidebar-top" } },
};

/** A complete palette with one pair at 1:1 — the contrast refusal's subject. */
const LOW_CONTRAST_THEME = {
  name: "low-contrast",
  label: "Low Contrast",
  colors: Object.fromEntries(
    [
      "background",
      "foreground",
      "card",
      "cardForeground",
      "muted",
      "mutedForeground",
      "popover",
      "popoverForeground",
      "primary",
      "primaryForeground",
      "secondary",
      "secondaryForeground",
      "accent",
      "accentForeground",
      "border",
      "input",
      "ring",
      "destructive",
      "destructiveForeground",
    ].map((key) => [key, key === "background" || key === "foreground" ? "#ffffff" : "#000000"]),
  ),
};

/** What the companion's own write_theme call puts on screen. */
const AGENT_THEME = {
  name: "agent-written",
  label: "Agent Written",
  description: "Written by a tool call through the MCP door, not by the rig's pen.",
  chrome: {
    wingSwitcher: { place: "floating-left", variant: "labels" },
    domainSwitcher: { place: "below-titlebar", variant: "segmented" },
    navRail: { width: "wide" },
  },
  material: {
    radius: "round",
    density: "airy",
    motion: "lively",
    shadow: "deep",
    typeScale: "airy",
    backdrop: "grid",
  },
};

/** The Phase 1 gate: a complete theme authored only through the MCP door. */
const OUTSIDE_THEME = {
  name: "outside-theme",
  label: "Outside Theme",
  description: "A whole theme — chrome and all six material axes — written through the companion's write_theme tool.",
  chrome: {
    wingSwitcher: { place: "floating-left", variant: "labels" },
    domainSwitcher: { place: "bottom-center", variant: "pill" },
    navRail: { place: "floating", width: "wide" },
    chatDock: { side: "left" },
    titlebar: { size: "tall" },
  },
  material: {
    radius: "sharp",
    shadow: "flat",
    motion: "none",
    typeScale: "compact",
    density: "compact",
    backdrop: "grid",
  },
};

async function main() {
  if (!world) throw new Error("LQ_THEME_WORLD is required");
  fs.mkdirSync(artifactsDir, { recursive: true });

  const profileDir = path.join(world, "profile");
  const vaultDir = path.join(world, "vault");
  const hermesHome = path.join(world, "hermes-home");
  const binDir = path.join(world, "bin");
  const themesDir = path.join(profileDir, "themes");

  // ── The world ────────────────────────────────────────────────────────────
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(hermesHome, { recursive: true });
  writeHermesStub(binDir);

  let vaultId;
  if (fs.existsSync(path.join(vaultDir, "lifequest.json"))) {
    vaultId = JSON.parse(
      fs.readFileSync(path.join(vaultDir, "lifequest.json"), "utf8"),
    ).id;
  } else {
    fs.mkdirSync(vaultDir, { recursive: true });
    const created = await createVault(vaultDir, "Theme Chrome");
    if (!created.ok) throw new Error(`createVault: ${created.error}`);
    vaultId = created.value.lifequest.id;
    // R4.1 reads two closed count bindings from the snapshot; seed them with
    // numbers a badge can be wrong about (two domains, two weekly files), so
    // the gate is not satisfied by an accidental zero.
    for (const name of ["Home", "Work"]) {
      const domain = await createDomain(vaultDir, { name });
      if (!domain.ok) throw new Error(`createDomain: ${domain.error}`);
    }
    const weeklyDir = vaultPaths(vaultDir).reviewsCadenceDir("weekly");
    fs.mkdirSync(weeklyDir, { recursive: true });
    for (const week of ["2026-W44", "2026-W45"]) {
      fs.writeFileSync(
        path.join(weeklyDir, `${week}.md`),
        `# Weekly review ${week}\n`,
      );
    }
    const seededWeekly = await countWeeklyVaultFiles(vaultDir);
    if (seededWeekly !== 2) {
      throw new Error(`weekly seed: expected 2 files, got ${seededWeekly}`);
    }
  }

  fs.writeFileSync(
    path.join(profileDir, "recent.json"),
    `${JSON.stringify(
      {
        recent: [
          {
            id: vaultId,
            name: "Theme Chrome",
            path: vaultDir,
            lastOpenedAt: new Date().toISOString(),
          },
        ],
        activeDomainByVaultId: {},
        deadlineDismissedOnByVaultId: {},
        deadlineNotifiedOnByVaultId: {},
        companionProfile: "lq-theme-probe",
      },
      null,
      2,
    )}\n`,
  );

  const [mcpLocal, mcpInvite] = await freePorts(2);
  const hostPort = await serveHostGateway();
  fs.writeFileSync(
    path.join(hermesHome, ".env"),
    `API_SERVER_PORT=${hostPort}\nAPI_SERVER_KEY=${"k".repeat(32)}\n`,
  );
  fs.writeFileSync(
    path.join(hermesHome, "config.yaml"),
    "model:\n  default: some-model\n  provider: nous\n",
  );
  process.env.HERMES_HOME = hermesHome;
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH ?? ""}`;
  process.env.VITE_DEV_SERVER_URL = DEV_URL;
  // S1 import seam: the product main process reads LIFEQUEST_E2E at import
  // time, so the queued fixture paths for the three imports below are set
  // before `bootForE2e` is imported. `theme:import` shifts one per call while
  // the seam is active; the fixtures themselves are committed beside this rig.
  const importFixtures = [
    path.join(here, "fixtures", "theme-import-valid.json"),
    path.join(here, "fixtures", "theme-import-invalid.json"),
    path.join(here, "fixtures", "theme-import-collision.json"),
  ];
  for (const fixture of importFixtures) {
    if (!fs.existsSync(fixture)) {
      throw new Error(`missing import fixture: ${fixture}`);
    }
  }
  process.env.LIFEQUEST_E2E = JSON.stringify({
    userData: profileDir,
    showWindow: true,
    mcpPorts: { local: mcpLocal, invite: mcpInvite },
    themeImportSources: importFixtures,
  });
  delete process.env.ELECTRON_RUN_AS_NODE;

  // ── The real app ─────────────────────────────────────────────────────────
  await app.whenReady();
  const { bootForE2e } = await import("../dist-electron/main.js");
  const win = await bootForE2e();

  const consoleLines = [];
  win.webContents.on("console-message", (_event, level, message) => {
    consoleLines.push(`[${level}] ${message}`);
  });
  win.webContents.on("did-fail-load", (_event, code, description, url) => {
    consoleLines.push(`[did-fail-load] ${code} ${description} ${url}`);
  });

  const evaluate = (source) =>
    win.webContents.executeJavaScript(source, true).catch((error) => {
      throw new Error(String(error));
    });

  const deadline = Date.now() + 60_000;
  let up = null;
  while (Date.now() < deadline) {
    try {
      up = await evaluate("Boolean(document.querySelector('.shell'))");
    } catch {
      up = null;
    }
    if (up) break;
    await sleep(100);
  }
  if (!up) {
    const diag = await evaluate(`(() => ({
      href: location.href,
      body: document.body ? document.body.innerText.slice(0, 1500) : null,
      splashHidden: document.getElementById("splash") ? document.getElementById("splash").hasAttribute("hidden") : null,
      rootChildren: document.getElementById("root") ? document.getElementById("root").children.length : null,
      welcome: document.querySelector(".welcome-lead") ? document.querySelector(".welcome-lead").textContent.trim() : null,
    }))()`).catch((error) => ({ error: String(error) }));
    const debug = { diag, consoleLines: consoleLines.slice(-40) };
    fs.writeFileSync(
      path.join(artifactsDir, "themes-v2-debug.json"),
      `${JSON.stringify(debug, null, 2)}\n`,
    );
    const debugShot = await win.webContents.capturePage().catch(() => null);
    if (debugShot) fs.writeFileSync(path.join(artifactsDir, "themes-v2-debug.png"), debugShot.toPNG());
    throw new Error(`the app shell never mounted: ${JSON.stringify(debug)}`);
  }

  // Runtime errors after the shell is up: a render that throws takes the whole
  // React tree with it, and a rig that only sees "no shell" cannot tell that
  // from a slow boot.
  await evaluate(`(() => {
    window.__lqErrors = [];
    window.addEventListener("error", (event) => {
      window.__lqErrors.push(String(event.error && event.error.stack ? event.error.stack : event.message));
    });
    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason;
      window.__lqErrors.push("rejection: " + String(reason && reason.stack ? reason.stack : reason));
    });
    return true;
  })()`);

  // Two areas, so the area lens is a control and not the quiet "Life" label:
  // `unlockedAreas` deliberately excludes the base Life area.
  const domA = await evaluate(
    "Promise.all([window.lifequest.domainCreate({ name: 'Health' }), window.lifequest.domainCreate({ name: 'Work' })]).then((rs) => rs.every((r) => r.ok))",
  );
  check("two-areas-land", domA === true, "domain:create did not answer ok for both areas");
  let baseline = null;
  for (let i = 0; i < 100; i += 1) {
    baseline = await evaluate(SAMPLE);
    if (baseline.areaNames.length >= 2) break;
    await sleep(100);
  }
  check(
    "baseline-chrome-is-the-default",
    baseline &&
      baseline.railWings &&
      baseline.lensInStrip &&
      baseline.domainBottom === false,
    JSON.stringify(baseline),
  );

  // ── 1–2: the companion's gesture, and the preview gate ───────────────────
  fs.mkdirSync(themesDir, { recursive: true });
  fs.writeFileSync(
    path.join(themesDir, "solar-system.json"),
    `${JSON.stringify(THEME, null, 2)}\n`,
  );

  let preview = null;
  for (let i = 0; i < 120; i += 1) {
    preview = await evaluate(SAMPLE);
    if (preview.preview && preview.domainBottom) break;
    await sleep(100);
  }
  check(
    "a-written-theme-file-is-worn-without-a-restart",
    preview &&
      preview.wingTitlebar &&
      preview.domainBottom &&
      preview.railWings === false &&
      preview.lensInStrip === false,
    JSON.stringify(preview),
  );
  check(
    "the-preview-asks-before-it-stays",
    Boolean(preview?.preview) && (preview?.previewText ?? "").includes("solar-system.json"),
    preview?.previewText ?? "no preview bar",
  );
  const shot = await win.webContents.capturePage();
  fs.writeFileSync(PREVIEW_PNG, shot.toPNG());

  // ── 3: the clock hands the window back ───────────────────────────────────
  let reverted = null;
  for (let i = 0; i < 200; i += 1) {
    reverted = await evaluate(SAMPLE);
    if (!reverted.preview && reverted.railWings && reverted.wingTitlebar === false) break;
    await sleep(100);
  }
  check(
    "an-unkept-theme-reverts-by-itself",
    Boolean(reverted) &&
      reverted.preview === false &&
      reverted.railWings === true &&
      reverted.wingTitlebar === false &&
      reverted.domainBottom === false,
    JSON.stringify(reverted),
  );

  // ── 4: Keep survives a reload ────────────────────────────────────────────
  fs.writeFileSync(
    path.join(themesDir, "solar-system.json"),
    `${JSON.stringify({ ...THEME, description: "Kept after review." }, null, 2)}\n`,
  );
  let previewAgain = null;
  for (let i = 0; i < 120; i += 1) {
    previewAgain = await evaluate(SAMPLE);
    if (previewAgain.preview) break;
    await sleep(100);
  }
  const kept = await evaluate(
    "(() => { const b = document.querySelector('[data-testid=\"theme-keep\"]'); if (!b) return false; b.click(); return true; })()",
  );
  check("the-keep-button-is-there", kept === true, "no Keep button in the preview bar");
  await sleep(300);
  const keptState = await evaluate(SAMPLE);
  check(
    "keep-persists-the-file-name",
    keptState.kept === "solar-system.json" && keptState.preview === false,
    JSON.stringify({ kept: keptState.kept, preview: keptState.preview }),
  );

  win.webContents.reload();
  await new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
  let afterReload = null;
  for (let i = 0; i < 150; i += 1) {
    afterReload = await evaluate(SAMPLE);
    if (afterReload.shell && afterReload.wingTitlebar) break;
    await sleep(100);
  }
  check(
    "keep-persists-the-theme-across-a-reload",
    afterReload &&
      afterReload.wingTitlebar &&
      afterReload.domainBottom &&
      afterReload.railWings === false &&
      afterReload.kept === "solar-system.json",
    JSON.stringify(afterReload),
  );
  check(
    "material-lands-on-the-document",
    afterReload &&
      afterReload.density === "compact" &&
      afterReload.motion === "none" &&
      afterReload.radiusLg === "28px",
    JSON.stringify({
      density: afterReload?.density,
      motion: afterReload?.motion,
      radiusLg: afterReload?.radiusLg,
    }),
  );
  // Let the first paint after the reload settle: a capture taken the instant
  // the root mounts photographs the paint before the board's own cards.
  await sleep(900);
  const keptShot = await win.webContents.capturePage();
  fs.writeFileSync(KEPT_PNG, keptShot.toPNG());

  // ── 5: an invalid theme is refused by name ───────────────────────────────
  fs.writeFileSync(
    path.join(themesDir, "bad-chrome.json"),
    `${JSON.stringify(BAD_THEME, null, 2)}\n`,
  );
  let refused = null;
  for (let i = 0; i < 120; i += 1) {
    refused = await evaluate(SAMPLE);
    if (refused.error) break;
    await sleep(100);
  }
  check(
    "an-invalid-theme-is-refused-by-name",
    Boolean(refused?.error) &&
      refused.error.includes("chrome.wingSwitcher.place") &&
      refused.wingTitlebar === true &&
      refused.domainBottom === true,
    JSON.stringify({ error: refused?.error, wing: refused?.wingTitlebar }),
  );

  await evaluate(
    "(() => { const b = document.querySelector('[data-testid=\"theme-dismiss\"]'); if (b) b.click(); return true; })()",
  );

  // ── 6: the rest of the matrix ───────────────────────────────────────────
  const writeThemeFile = (file, theme) =>
    fs.writeFileSync(path.join(themesDir, file), `${JSON.stringify(theme, null, 2)}\n`);
  const waitFor = async (predicate, timeout = 12_000) => {
    const until = Date.now() + timeout;
    let last = null;
    while (Date.now() < until) {
      last = await evaluate(SAMPLE);
      if (predicate(last)) return last;
      await sleep(100);
    }
    return last;
  };

  const click = (testId) =>
    evaluate(`(() => {
      const b = document.querySelector('[data-testid="${testId}"]');
      if (!b) return false;
      b.click();
      return true;
    })()`);

  writeThemeFile("matrix-icons.json", {
    name: "matrix-icons",
    label: "Icons On The Strip",
    chrome: {
      wingSwitcher: { place: "titlebar-left", variant: "icons" },
      domainSwitcher: { place: "below-titlebar", variant: "segmented" },
    },
  });
  const icons = await waitFor((s) => s.wingTitlebar && s.domainBelow && s.preview);
  check(
    "the-second-placement-moves-and-swaps-variant",
    icons &&
      icons.wingTitlebar &&
      icons.wingText === "H" &&
      icons.domainBelow &&
      icons.lensInStrip === false,
    JSON.stringify({ wingText: icons?.wingText, below: icons?.domainBelow, strip: icons?.lensInStrip }),
  );

  // Keyboard and aria where a moved control now lives: both switchers are radio
  // groups, so ArrowRight must move the checked choice and keep focus inside.
  const keyboard = await evaluate(`(async () => {
    const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const probe = async (selector) => {
      const host = document.querySelector(selector);
      if (!host) return null;
      const radios = [...host.querySelectorAll('[role="radio"]')];
      const before = radios.findIndex((el) => el.getAttribute("aria-checked") === "true");
      if (before < 0) return { before: -1 };
      radios[before].focus();
      const focusedBefore = document.activeElement === radios[before];
      radios[before].dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
      );
      await settle(700);
      const hostAfter = document.querySelector(selector);
      if (!hostAfter) return { before, focusedBefore, now: -1, focusedInside: false, count: 0 };
      const afterRadios = [...hostAfter.querySelectorAll('[role="radio"]')];
      return {
        before,
        focusedBefore,
        now: afterRadios.findIndex((el) => el.getAttribute("aria-checked") === "true"),
        focusedInside: hostAfter.contains(document.activeElement),
        count: afterRadios.length,
      };
    };
    // One after the other, never at once: focusing the area lens would otherwise
    // take the focus away from the wing switcher before it is measured.
    const wing = await probe('[data-chrome-place="titlebar-left"]');
    const domain = await probe('[data-chrome-place="below-titlebar"]');
    return { wing, domain };
  })()`);
  check(
    "keyboard-moves-the-moved-wing-switcher",
    keyboard?.wing &&
      keyboard.wing.focusedBefore === true &&
      keyboard.wing.now > -1 &&
      keyboard.wing.now !== keyboard.wing.before &&
      keyboard.wing.focusedInside === true,
    JSON.stringify(keyboard?.wing),
  );
  check(
    "keyboard-moves-the-moved-area-lens",
    keyboard?.domain &&
      keyboard.domain.focusedBefore === true &&
      keyboard.domain.now > -1 &&
      keyboard.domain.now !== keyboard.domain.before &&
      keyboard.domain.focusedInside === true,
    JSON.stringify(keyboard?.domain),
  );

  writeThemeFile("matrix-floating.json", {
    name: "matrix-floating",
    label: "Floating Edges",
    chrome: {
      wingSwitcher: { place: "floating-left", variant: "labels" },
      domainSwitcher: { place: "floating-bottom-right", variant: "pill" },
    },
  });
  const floating = await waitFor(
    (s) => s.wingFloating && s.domainFloating && s.domainPill && s.preview,
  );
  check(
    "the-floating-corners-hold-the-pill",
    floating &&
      floating.wingFloating &&
      floating.wingTitlebar === false &&
      floating.domainFloating &&
      floating.domainPill &&
      floating.areaNames.length >= 2,
    JSON.stringify({ wing: floating?.wingFloating, domain: floating?.domainFloating, pill: floating?.domainPill, areas: floating?.areaNames }),
  );
  const floatingShot = await win.webContents.capturePage();
  fs.writeFileSync(FLOATING_PNG, floatingShot.toPNG());

  // ── 6a2: a bare area lens wears no frame ────────────────────────────────
  writeThemeFile("matrix-bare.json", {
    name: "matrix-bare",
    label: "Bare Lens",
    chrome: {
      domainSwitcher: {
        place: "floating-bottom-right",
        variant: "list",
        frame: "bare",
      },
    },
  });
  const bare = await waitFor(
    (s) => s.domainFloating && s.bareFrame?.attribute === "bare",
  );
  const bareFrame = bare?.bareFrame;
  const isTransparentPaint = (value) =>
    value === "rgba(0, 0, 0, 0)" || value === "transparent";
  check(
    "a-bare-area-lens-wears-no-frame",
    Boolean(bareFrame) &&
      bareFrame.attribute === "bare" &&
      isTransparentPaint(bareFrame.backgroundColor) &&
      bareFrame.borderTopWidth === "0px" &&
      bareFrame.boxShadow === "none" &&
      bareFrame.borderRadius === "0px" &&
      bareFrame.tabs !== null &&
      isTransparentPaint(bareFrame.tabs.backgroundColor) &&
      bareFrame.tabs.borderTopWidth === "0px" &&
      bareFrame.tabs.borderRadius === "0px" &&
      bareFrame.tabs.padding === "0px" &&
      Math.abs(bareFrame.rightGap - bareFrame.rem * 1.25) <= 1 &&
      Math.abs(bareFrame.bottomGap - bareFrame.rem * 1.25) <= 1 &&
      bareFrame.rows.length >= 2,
    JSON.stringify({
      attribute: bareFrame?.attribute,
      background: bareFrame?.backgroundColor,
      border: bareFrame?.borderTopWidth,
      shadow: bareFrame?.boxShadow,
      radius: bareFrame?.borderRadius,
      rightGap: bareFrame?.rightGap,
      bottomGap: bareFrame?.bottomGap,
      rem: bareFrame?.rem,
      innerWidth: bareFrame?.innerWidth,
      tabs: bareFrame?.tabs,
      rows: bareFrame?.rows.length,
    }),
  );
  // `background: transparent` computes to rgba(0, 0, 0, 0); every other row
  // paint must be fully opaque, because the dock is no longer behind it.
  const opaqueRowBackground = (value) => {
    if (!value || value === "transparent") return false;
    const match = value.match(/^rgba?\((.+)\)$/);
    if (!match) return true;
    const parts = match[1].split(",").map((part) => part.trim());
    return parts.length < 4 || parseFloat(parts[3]) === 1;
  };
  check(
    "bare-frame-rows-keep-their-own-surface",
    Boolean(bareFrame) &&
      bareFrame.rows.length >= 2 &&
      bareFrame.rows.every((row) => opaqueRowBackground(row.background)),
    JSON.stringify(
      (bareFrame?.rows ?? []).map((row) => ({
        background: row.background,
        color: row.color,
        active: row.active,
      })),
    ),
  );
  const bareShot = await win.webContents.capturePage();
  fs.writeFileSync(BARE_FRAME_PNG, bareShot.toPNG());

  // The refusal has to be judged with no preview asking consent: the preview
  // bar outranks the error bar (ThemePreviewBar returns the preview first), so
  // a refused write made mid-preview shows the preview's words and the error is
  // only reachable after the ten seconds are up. Revert the bare preview first,
  // exactly as the operator would, and the kept theme is back underneath.
  await evaluate(
    "(() => { const b = document.querySelector('[data-testid=\"theme-revert\"]'); if (b) b.click(); return true; })()",
  );
  const bareReverted = await waitFor(
    (s) => !s.preview && s.wingTitlebar === true && s.domainBottom === true,
  );
  writeThemeFile("matrix-bad-frame.json", {
    name: "matrix-bad-frame",
    label: "Bad Frame",
    chrome: {
      domainSwitcher: {
        place: "floating-bottom-right",
        variant: "pill",
        frame: "bare-metal",
      },
    },
  });
  const badFrame = await waitFor((s) => Boolean(s.error), 12_000);
  check(
    "an-invalid-frame-is-refused-by-name",
    bareReverted?.kept === "solar-system.json" &&
      Boolean(badFrame?.error) &&
      badFrame.error.includes("chrome.domainSwitcher.frame") &&
      // A refused file must not move the chrome: the kept theme is still worn.
      badFrame.wingTitlebar === true &&
      badFrame.domainBottom === true,
    JSON.stringify({
      revertedTo: bareReverted?.kept,
      error: badFrame?.error,
      wing: badFrame?.wingTitlebar,
      domain: badFrame?.domainBottom,
    }),
  );
  await evaluate(
    "(() => { const b = document.querySelector('[data-testid=\"theme-dismiss\"]'); if (b) b.click(); return true; })()",
  );

  writeThemeFile("matrix-hidden.json", {
    name: "matrix-hidden",
    label: "Hidden Chrome",
    chrome: {
      wingSwitcher: { place: "hidden", variant: "labels" },
      domainSwitcher: { place: "hidden", variant: "segmented" },
    },
  });
  const hidden = await waitFor(
    (s) =>
      !s.railWings &&
      !s.wingTitlebar &&
      !s.wingFloating &&
      !s.lensInStrip &&
      !s.domainBelow &&
      !s.domainBottom &&
      !s.domainFloating &&
      s.preview,
  );
  check(
    "hidden-chrome-still-leaves-the-way-out",
    hidden &&
      hidden.railWings === false &&
      hidden.wingTitlebar === false &&
      hidden.wingFloating === false &&
      hidden.lensInStrip === false &&
      hidden.domainBelow === false &&
      hidden.domainBottom === false &&
      hidden.domainFloating === false &&
      hidden.settingsEntry === true,
    JSON.stringify({ settings: hidden?.settingsEntry, shell: hidden?.shell, preview: hidden?.preview }),
  );
  // The preview bar is the escape hatch while the chrome is hidden: Revert.
  const revertedAgain = await evaluate(
    `(() => { const b = document.querySelector('[data-testid="theme-revert"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const backToKept = await waitFor((s) => !s.preview && s.wingTitlebar && s.domainBottom);
  check(
    "the-escape-hatch-returns-the-kept-theme",
    revertedAgain === true && backToKept?.kept === "solar-system.json" && backToKept.wingTitlebar && backToKept.domainBottom,
    JSON.stringify({ revertedAgain, kept: backToKept?.kept, wing: backToKept?.wingTitlebar, domain: backToKept?.domainBottom }),
  );

  // ── 6b: the remaining variants — compact wings, the rail's lens, icons, lists
  writeThemeFile("variant-lab.json", {
    name: "variant-lab",
    label: "Variant Lab",
    chrome: {
      wingSwitcher: { place: "rail-top", variant: "compact" },
      domainSwitcher: { place: "left-rail", variant: "icons" },
    },
  });
  const variants = await waitFor(
    (s) => s.railWings && s.wingCompact && s.domainLeftRail && s.domainIcons && s.preview,
  );
  check(
    "compact-wings-and-the-rail-lens",
    variants &&
      variants.railWings === true &&
      variants.wingCompact === true &&
      variants.railWingLabels.join(",") === "Home,Def,Plan,Exec,Rev" &&
      variants.domainLeftRail === true &&
      variants.domainIcons === true &&
      variants.lensInStrip === false &&
      variants.areaInitials.length >= 2 &&
      variants.areaInitials[0] === "L",
    JSON.stringify({
      compact: variants?.wingCompact,
      labels: variants?.railWingLabels,
      railLens: variants?.domainLeftRail,
      icons: variants?.areaInitials,
      strip: variants?.lensInStrip,
    }),
  );
  const variantsShot = await win.webContents.capturePage();
  fs.writeFileSync(VARIANTS_PNG, variantsShot.toPNG());

  writeThemeFile("variant-list.json", {
    name: "variant-list",
    label: "Variant List",
    chrome: {
      wingSwitcher: { place: "rail-top", variant: "labels" },
      domainSwitcher: { place: "left-rail", variant: "list" },
    },
  });
  const listed = await waitFor(
    (s) => s.railWings && s.domainLeftRail && s.domainList && s.preview,
  );
  check(
    "list-lens-stacks-in-the-rail",
    listed &&
      listed.domainList === true &&
      listed.domainLeftRail === true &&
      listed.areaNames.length >= 3,
    JSON.stringify({
      list: listed?.domainList,
      railLens: listed?.domainLeftRail,
      areas: listed?.areaNames,
    }),
  );

  // The escape hatch still returns the kept theme from a variant preview.
  await evaluate(
    `(() => { const b = document.querySelector('[data-testid="theme-revert"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const backFromVariants = await waitFor(
    (s) => !s.preview && s.wingTitlebar && s.domainBottom && !s.domainLeftRail,
  );
  check(
    "variants-revert-to-the-kept-theme",
    backFromVariants?.kept === "solar-system.json" &&
      backFromVariants.wingTitlebar === true &&
      backFromVariants.domainBottom === true &&
      backFromVariants.domainLeftRail === false,
    JSON.stringify({
      kept: backFromVariants?.kept,
      wing: backFromVariants?.wingTitlebar,
      domain: backFromVariants?.domainBottom,
    }),
  );

  // ── 6c: the sidebar on the trailing edge ────────────────────────────────
  writeThemeFile("nav-right.json", {
    name: "nav-right",
    label: "Sidebar Right",
    chrome: {
      wingSwitcher: { place: "rail-top", variant: "labels" },
      domainSwitcher: { place: "titlebar-center", variant: "segmented" },
      navRail: { place: "right", width: "wide" },
    },
  });
  const rightRail = await waitFor(
    (s) =>
      s.navPlaceAttr === "right" &&
      s.preview &&
      s.railRect &&
      s.mainRect &&
      s.railRect.left > s.mainRect.right,
  );
  check(
    "sidebar-can-sit-on-the-right",
    rightRail?.navPlaceAttr === "right" &&
      rightRail.railRect.left > rightRail.mainRect.right &&
      rightRail.railRect.right >= rightRail.innerWidth - 20 &&
      rightRail.mainRect.left <= 2 &&
      rightRail.lensCenter !== null &&
      rightRail.lensCenter > 0 &&
      rightRail.lensCenter < rightRail.railRect.left,
    JSON.stringify({
      place: rightRail?.navPlaceAttr,
      rail: rightRail?.railRect,
      main: rightRail?.mainRect,
      lens: rightRail?.lensCenter,
      width: rightRail?.innerWidth,
    }),
  );

  const rightShot = await win.webContents.capturePage();
  fs.writeFileSync(SIDEBAR_RIGHT_PNG, rightShot.toPNG());

  await evaluate(
    `(() => { const b = document.querySelector('[data-testid="theme-revert"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const backFromRight = await waitFor(
    (s) => !s.preview && s.wingTitlebar && s.domainBottom && s.navPlaceAttr === "left",
  );
  check(
    "right-rail-reverts-to-the-kept-theme",
    backFromRight?.kept === "solar-system.json" &&
      backFromRight.navPlaceAttr === "left" &&
      backFromRight.wingTitlebar === true,
    JSON.stringify({
      kept: backFromRight?.kept,
      place: backFromRight?.navPlaceAttr,
      wing: backFromRight?.wingTitlebar,
    }),
  );

  // ── 6d: the dock on the page's leading edge ──────────────────────────────
  writeThemeFile("dock-left.json", {
    name: "dock-left",
    label: "Dock Left",
    chrome: {
      wingSwitcher: { place: "rail-top", variant: "labels" },
      domainSwitcher: { place: "titlebar-center", variant: "segmented" },
      chatDock: { side: "left" },
    },
  });
  const dockLeft = await waitFor(
    (s) => s.dockLeft && s.chatRect && s.mainRect && s.chatRect.left < s.mainRect.left && s.preview,
  );
  check(
    "chat-dock-can-sit-on-the-left",
    dockLeft?.dockLeft === true &&
      dockLeft.chatRect.left < dockLeft.mainRect.left &&
      dockLeft.mainRect.right > dockLeft.chatRect.right,
    JSON.stringify({
      dockLeft: dockLeft?.dockLeft,
      chat: dockLeft?.chatRect,
      main: dockLeft?.mainRect,
    }),
  );

  const dockShot = await win.webContents.capturePage();
  fs.writeFileSync(DOCK_LEFT_PNG, dockShot.toPNG());

  await evaluate(
    `(() => { const b = document.querySelector('[data-testid="theme-revert"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const backFromDock = await waitFor(
    (s) => !s.preview && !s.dockLeft && s.wingTitlebar && s.domainBottom,
  );
  check(
    "dock-side-reverts-to-the-kept-theme",
    backFromDock?.kept === "solar-system.json" &&
      backFromDock.dockLeft === false &&
      backFromDock.domainBottom === true,
    JSON.stringify({
      kept: backFromDock?.kept,
      dockLeft: backFromDock?.dockLeft,
      wing: backFromDock?.wingTitlebar,
    }),
  );

  // ── 6e: the sidebar afloat, and the strip's own height ──────────────────
  writeThemeFile("float-lab.json", {
    name: "float-lab",
    label: "Floating Rail",
    chrome: {
      wingSwitcher: { place: "rail-top", variant: "icons" },
      domainSwitcher: { place: "titlebar-center", variant: "segmented" },
      navRail: { place: "floating", width: "default" },
      titlebar: { size: "tall" },
    },
  });
  const floatRail = await waitFor(
    (s) =>
      s.navPlaceAttr === "floating" &&
      s.preview &&
      s.railRect &&
      s.mainRect &&
      s.railRect.left <= 20 &&
      s.mainRect.left <= 2 &&
      s.titlebarHeight === 40 &&
      s.titlebarSizeAttr === "tall",
  );
  check(
    "sidebar-can-float-above-the-page",
    floatRail?.navPlaceAttr === "floating" &&
      floatRail.railRect.left <= 20 &&
      floatRail.railRect.width >= 200 &&
      floatRail.railRect.width <= 320 &&
      floatRail.railRect.top >= 35 &&
      floatRail.mainRect.left <= 2,
    JSON.stringify({
      place: floatRail?.navPlaceAttr,
      rail: floatRail?.railRect,
      main: floatRail?.mainRect,
      preview: floatRail?.preview,
      error: floatRail?.error,
      previewText: (floatRail?.previewText ?? "").slice(0, 80),
      titlebarVar: floatRail?.titlebarVar,
    }),
  );
  check(
    "titlebar-can-wear-a-taller-strip",
    floatRail?.titlebarHeight === 40 && floatRail.titlebarSizeAttr === "tall",
    JSON.stringify({
      height: floatRail?.titlebarHeight,
      size: floatRail?.titlebarSizeAttr,
    }),
  );
  const floatRailShot = await win.webContents.capturePage();
  fs.writeFileSync(FLOATING_RAIL_PNG, floatRailShot.toPNG());

  await evaluate(
    `(() => { const b = document.querySelector('[data-testid="theme-revert"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const backFromFloat = await waitFor(
    (s) =>
      !s.preview &&
      s.wingTitlebar &&
      s.navPlaceAttr === "left" &&
      s.titlebarHeight === 32,
  );
  check(
    "float-and-strip-size-revert-to-the-kept-theme",
    backFromFloat?.kept === "solar-system.json" &&
      backFromFloat.navPlaceAttr === "left" &&
      backFromFloat.titlebarHeight === 32,
    JSON.stringify({
      kept: backFromFloat?.kept,
      place: backFromFloat?.navPlaceAttr,
      height: backFromFloat?.titlebarHeight,
    }),
  );

  // ── 6e2: full-screen chat while the rail floats ─────────────────────────
  // The two features arrived from different branches: the floating rail lays
  // the shell out as `0 1fr dock`, while full-screen chat expects the rail's
  // column to lead the dock. This section is the seam between them: the mode
  // must still take the workspace, leave the floating rail painted as the
  // window's card, hide the page, drop the divider, and come back exactly.
  // The door clicked here is the dock's own top-row toggle: the strip's second
  // copy is gone, so `chat-fullscreen` is the window's one way into the mode.
  writeThemeFile("float-focus.json", {
    name: "float-focus",
    label: "Float Focus",
    chrome: {
      navRail: { place: "floating", width: "wide" },
      chatDock: { side: "right" },
    },
  });
  const floatFocusPreview = await waitFor(
    (s) => s.preview && s.navPlaceAttr === "floating" && s.navWidthAttr === "wide",
    20_000,
  );
  const floatBaseline = await waitFor(
    (s) => floatFocusPreview !== null && s.railBox !== null && s.dockBox !== null && !s.chatFocus,
    20_000,
  );
  check(
    "the strip carries no second full-screen chat door",
    floatBaseline.settingsEntry === true &&
      floatBaseline.titlebarFullScreen === false &&
      floatBaseline.titlebarMainPage === false,
    JSON.stringify({
      settings: floatBaseline?.settingsEntry,
      fullScreen: floatBaseline?.titlebarFullScreen,
      mainPage: floatBaseline?.titlebarMainPage,
    }),
  );
  const enteredFocus = await evaluate(
    `(() => { const b = document.querySelector('[data-testid="chat-fullscreen"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const floatFocused = await waitFor(
    (s) =>
      s.chatFocus &&
      s.pageVisible === false &&
      s.railBox !== null &&
      s.dockBox !== null,
    20_000,
  );
  check(
    "full-screen-chat-takes-the-workspace-with-a-floating-rail",
    enteredFocus === true &&
      floatFocused?.chatFocus === true &&
      floatFocused.pageVisible === false &&
      floatFocused.dividerPainted === false &&
      floatFocused.settingsEntry === true &&
      floatFocused.stripPainted === true &&
      // The dock reaches the window's trailing edge and bottom, and starts at
      // the floating card's trailing edge — not back in its 23rem column.
      floatFocused.dockBox.right >= 1280 - 4 &&
      floatFocused.dockBox.bottom >= 800 - 12 &&
      floatFocused.dockBox.left >= floatFocused.railBox.right + 6 &&
      floatFocused.dockBox.width >= 700 &&
      // The floating rail is still the window's card on the leading edge.
      floatFocused.railBox.left <= 24 &&
      floatFocused.railBox.width >= 240,
    JSON.stringify({
      entered: enteredFocus,
      focus: floatFocused?.chatFocus,
      page: floatFocused?.pageVisible,
      divider: floatFocused?.dividerPainted,
      dock: floatFocused?.dockBox,
      rail: floatFocused?.railBox,
      settings: floatFocused?.settingsEntry,
    }),
  );

  const focusFloatingShot = await win.webContents.capturePage();
  fs.writeFileSync(FOCUS_FLOATING_PNG, focusFloatingShot.toPNG());

  const leftFocus = await evaluate(
    `(() => { const b = document.querySelector('[data-testid="chat-fullscreen"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const floatRestored = await waitFor(
    (s) =>
      leftFocus === true &&
      !s.chatFocus &&
      s.pageVisible === true &&
      s.railBox !== null &&
      s.dockBox !== null &&
      Math.abs(s.railBox.left - floatBaseline.railBox.left) <= 2 &&
      Math.abs(s.railBox.width - floatBaseline.railBox.width) <= 2 &&
      Math.abs(s.dockBox.left - floatBaseline.dockBox.left) <= 2 &&
      Math.abs(s.dockBox.width - floatBaseline.dockBox.width) <= 2,
    20_000,
  );
  check(
    "leaving-full-screen-chat-puts-the-floating-rail-back",
    leftFocus === true &&
      floatRestored?.chatFocus === false &&
      floatRestored.pageVisible === true &&
      Math.abs(floatRestored.railBox.left - floatBaseline.railBox.left) <= 2 &&
      Math.abs(floatRestored.railBox.width - floatBaseline.railBox.width) <= 2 &&
      Math.abs(floatRestored.dockBox.left - floatBaseline.dockBox.left) <= 2,
    JSON.stringify({
      focus: floatRestored?.chatFocus,
      rail: floatRestored?.railBox,
      baselineRail: floatBaseline?.railBox,
      dock: floatRestored?.dockBox,
      baselineDock: floatBaseline?.dockBox,
    }),
  );

  // The same seam with the rail on the trailing edge: a docked column, not a
  // card, so the dock takes the leading track and meets the rail's edge.
  writeThemeFile("right-focus.json", {
    name: "right-focus",
    label: "Right Focus",
    chrome: { navRail: { place: "right", width: "default" } },
  });
  const rightFocusPreview = await waitFor(
    (s) => s.preview && s.navPlaceAttr === "right" && s.railBox !== null,
    20_000,
  );
  const enteredRightFocus = await evaluate(
    `(() => { const b = document.querySelector('[data-testid="chat-fullscreen"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const rightFocused = await waitFor(
    (s) =>
      s.chatFocus &&
      s.pageVisible === false &&
      s.railBox !== null &&
      s.dockBox !== null &&
      rightFocusPreview !== null,
    20_000,
  );
  check(
    "full-screen-chat-takes-the-workspace-with-a-right-rail",
    enteredRightFocus === true &&
      rightFocused?.chatFocus === true &&
      rightFocused.pageVisible === false &&
      rightFocused.dividerPainted === false &&
      rightFocused.settingsEntry === true &&
      // The rail keeps the window's trailing edge.
      rightFocused.railBox.right >= 1280 - 12 &&
      rightFocused.railBox.width >= 240 &&
      // The dock takes the leading track and meets the rail.
      rightFocused.dockBox.left <= 4 &&
      rightFocused.dockBox.right <= rightFocused.railBox.left + 8 &&
      rightFocused.dockBox.width >= 700 &&
      rightFocused.dockBox.bottom >= 800 - 12,
    JSON.stringify({
      entered: enteredRightFocus,
      focus: rightFocused?.chatFocus,
      page: rightFocused?.pageVisible,
      dock: rightFocused?.dockBox,
      rail: rightFocused?.railBox,
      divider: rightFocused?.dividerPainted,
    }),
  );
  await evaluate(
    `(() => { const b = document.querySelector('[data-testid="chat-fullscreen"]'); if (!b) return false; b.click(); return true; })()`,
  );
  await waitFor((s) => !s.chatFocus && s.pageVisible === true);

  await evaluate(
    `(() => { const b = document.querySelector('[data-testid="theme-revert"]'); if (!b) return false; b.click(); return true; })()`,
  );
  await waitFor((s) => !s.preview && s.kept === "solar-system.json");

  // ── 6f: the scene behind the page ───────────────────────────────────────
  writeThemeFile("scene-lab.json", {
    name: "scene-lab",
    label: "Scene Lab",
    chrome: {
      wingSwitcher: { place: "titlebar-left", variant: "labels" },
      domainSwitcher: { place: "titlebar-center", variant: "segmented" },
    },
    scene: { background: { preset: "starfield", intensity: "lively" } },
  });
  const sceneStarfield = await waitFor(
    (s) =>
      s.preview &&
      s.scenePresetAttr === "starfield" &&
      s.sceneIntensityAttr === "lively" &&
      s.sceneLayer &&
      s.sceneNodes >= 60 &&
      s.slotPositioned === "relative" &&
      typeof s.sceneDuration === "number" &&
      s.sceneDuration > 0 &&
      s.sceneDuration < 4,
    20_000,
  );
  check(
    "a-theme-can-name-a-starfield",
    sceneStarfield?.scenePresetAttr === "starfield" &&
      sceneStarfield.sceneIntensityAttr === "lively" &&
      sceneStarfield.sceneLayer === true &&
      sceneStarfield.sceneNodes >= 60 &&
      sceneStarfield.slotPositioned === "relative" &&
      sceneStarfield.sceneDuration > 0 &&
      sceneStarfield.sceneDuration < 4,
    JSON.stringify({
      preset: sceneStarfield?.scenePresetAttr,
      intensity: sceneStarfield?.sceneIntensityAttr,
      layer: sceneStarfield?.sceneLayer,
      nodes: sceneStarfield?.sceneNodes,
      duration: sceneStarfield?.sceneDuration,
      positioned: sceneStarfield?.slotPositioned,
    }),
  );
  const sceneShot = await win.webContents.capturePage();
  fs.writeFileSync(SCENE_PNG, sceneShot.toPNG());

  writeThemeFile("aurora-lab.json", {
    name: "aurora-lab",
    label: "Aurora Lab",
    scene: { background: { preset: "aurora", intensity: "calm" } },
  });
  const sceneAurora = await waitFor(
    (s) =>
      s.preview &&
      s.scenePresetAttr === "aurora" &&
      s.sceneIntensityAttr === "calm" &&
      s.sceneLayer &&
      s.sceneNodes >= 3,
    20_000,
  );
  check(
    "an-aurora-replaces-the-stars",
    sceneAurora?.scenePresetAttr === "aurora" &&
      sceneAurora.sceneIntensityAttr === "calm" &&
      sceneAurora.sceneLayer === true &&
      sceneAurora.sceneNodes >= 3,
    JSON.stringify({
      preset: sceneAurora?.scenePresetAttr,
      intensity: sceneAurora?.sceneIntensityAttr,
      nodes: sceneAurora?.sceneNodes,
    }),
  );

  await evaluate(
    `(() => { const b = document.querySelector('[data-testid="theme-revert"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const backFromScene = await waitFor(
    (s) =>
      !s.preview &&
      s.kept === "solar-system.json" &&
      s.scenePresetAttr === "plain" &&
      !s.sceneLayer,
  );
  check(
    "a-scene-reverts-with-its-theme",
    backFromScene?.kept === "solar-system.json" &&
      backFromScene.scenePresetAttr === "plain" &&
      backFromScene.sceneLayer === false,
    JSON.stringify({
      kept: backFromScene?.kept,
      preset: backFromScene?.scenePresetAttr,
      layer: backFromScene?.sceneLayer,
    }),
  );

  // ── 6g: the frame layer — a decorated edge and a named card treatment ───
  // The cards live on the board, and the rig has been on the dream page; walk
  // to /home for the card half of the contract, then put the route back so the
  // sections after this one see the app as they left it.
  const originHash = (await evaluate(SAMPLE)).hash;
  await evaluate(
    `(() => { location.hash = "#/home"; return location.hash; })()`,
  );
  const framesPage = await waitFor(
    (s) => s.hash === "#/home" && s.cardProbe !== null,
    20_000,
  );
  writeThemeFile("frame-lab.json", {
    name: "frame-lab",
    label: "Frame Lab",
    scene: {
      background: { preset: "orbit", intensity: "calm" },
      frames: { canvas: "double", cards: "outline" },
    },
  });
  const framesLab = await waitFor(
    (s) =>
      framesPage?.cardProbe !== null &&
      s.preview &&
      s.sceneCanvasFrameAttr === "double" &&
      s.sceneCardFrameAttr === "outline" &&
      (s.canvasFrameBorder ?? 0) >= 1 &&
      s.cardProbe !== null &&
      (s.cardProbe.shadow === "none" || s.cardProbe.shadow === ""),
    20_000,
  );
  check(
    "a-theme-can-frame-the-page-and-its-cards",
    framesLab?.sceneCanvasFrameAttr === "double" &&
      framesLab.sceneCardFrameAttr === "outline" &&
      (framesLab.canvasFrameBorder ?? 0) >= 1 &&
      framesLab.cardProbe !== null &&
      (framesLab.cardProbe.shadow === "none" || framesLab.cardProbe.shadow === ""),
    JSON.stringify({
      canvas: framesLab?.sceneCanvasFrameAttr,
      cards: framesLab?.sceneCardFrameAttr,
      edge: framesLab?.canvasFrameBorder,
      hash: framesLab?.hash,
      card: framesLab?.cardProbe
        ? { shadow: String(framesLab.cardProbe.shadow).slice(0, 40) }
        : null,
    }),
  );
  const framesShot = await win.webContents.capturePage();
  fs.writeFileSync(FRAMES_PNG, framesShot.toPNG());

  await evaluate(
    `(() => { const b = document.querySelector('[data-testid="theme-revert"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const backFromFrames = await waitFor(
    (s) =>
      !s.preview &&
      s.kept === "solar-system.json" &&
      s.sceneCanvasFrameAttr === "none" &&
      s.sceneCardFrameAttr === "theme" &&
      s.cardProbe !== null &&
      s.cardProbe.shadow !== "none",
  );
  // Back to the page the rig was on before this section.
  await evaluate(
    `(() => { location.hash = ${JSON.stringify(originHash)}; return location.hash; })()`,
  );
  check(
    "frames-revert-with-their-theme",
    backFromFrames?.kept === "solar-system.json" &&
      backFromFrames.sceneCanvasFrameAttr === "none" &&
      backFromFrames.sceneCardFrameAttr === "theme" &&
      backFromFrames.cardProbe !== null &&
      backFromFrames.cardProbe.shadow !== "none",
    JSON.stringify({
      kept: backFromFrames?.kept,
      canvas: backFromFrames?.sceneCanvasFrameAttr,
      cards: backFromFrames?.sceneCardFrameAttr,
      cardShadow: String(backFromFrames?.cardProbe?.shadow ?? "").slice(0, 40),
      hash: backFromFrames?.hash,
    }),
  );

  // ── 7: the companion's own tools, through the real MCP door ─────────────
  const { e2eCompanionDoor } = await import("../dist-electron/main.js");
  const door = await e2eCompanionDoor();
  check(
    "the-companion-door-answers",
    Boolean(door?.url && door?.token),
    JSON.stringify({ url: door?.url ?? null, token: Boolean(door?.token) }),
  );
  let client = null;
  try {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StreamableHTTPClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/streamableHttp.js"
    );
    client = new Client({ name: "theme-rig", version: "0.1.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(door.url), {
        requestInit: { headers: { Authorization: `Bearer ${door.token}` } },
      }),
    );
    const listed = await client.listTools();
    const names = (listed.tools ?? []).map((tool) => tool.name);
    check(
      "the-theme-tools-are-on-the-companion-door",
      ["get_theme", "validate_theme", "write_theme"].every((name) => names.includes(name)),
      names.slice(-10).join(","),
    );

    const callJson = async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      const text =
        result.content?.find((part) => part.type === "text")?.text ?? "{}";
      try {
        return { json: JSON.parse(text), isError: result.isError === true };
      } catch {
        return { json: null, isError: true };
      }
    };

    const getTheme = await callJson("get_theme", {});
    check(
      "get-theme-names-what-is-kept",
      getTheme.json?.keptFile === "solar-system.json",
      JSON.stringify(getTheme.json?.keptFile ?? null),
    );

    const contrast = await callJson("validate_theme", { theme: LOW_CONTRAST_THEME });
    const contrastMessage = contrast.json?.error?.message ?? "";
    check(
      "validate-theme-refuses-a-palette-it-cannot-read",
      contrastMessage.includes("WCAG AA contrast"),
      contrastMessage.slice(0, 220),
    );

    const badScene = await callJson("validate_theme", {
      theme: {
        name: "bad-scene",
        label: "Bad Scene",
        scene: { background: { preset: "nebula" } },
      },
    });
    const badSceneMessage = badScene.json?.error?.message ?? "";
    check(
      "validate-theme-refuses-a-scene-it-cannot-draw",
      badSceneMessage.includes("scene.background.preset must be one of"),
      badSceneMessage.slice(0, 220),
    );

    const badFrame = await callJson("validate_theme", {
      theme: {
        name: "bad-frame",
        label: "Bad Frame",
        scene: { frames: { canvas: "neon" } },
      },
    });
    const badFrameMessage = badFrame.json?.error?.message ?? "";
    check(
      "validate-theme-refuses-a-frame-it-cannot-draw",
      badFrameMessage.includes("scene.frames.canvas must be one of"),
      badFrameMessage.slice(0, 220),
    );

    const written = await callJson("write_theme", { theme: AGENT_THEME });
    check(
      "write-theme-names-the-file-it-wrote",
      written.json?.written === "agent-written.json",
      JSON.stringify(written.json),
    );

    const agentPreview = await waitFor(
      (s) =>
        s.preview &&
        s.wingFloating &&
        s.domainBelow &&
        (s.previewText ?? "").includes("agent-written.json"),
    );
    check(
      "the-agents-write-previews-in-the-real-window",
      Boolean(agentPreview?.preview) &&
        agentPreview.wingFloating &&
        agentPreview.domainBelow,
      JSON.stringify({
        preview: agentPreview?.previewText,
        wing: agentPreview?.wingFloating,
        domain: agentPreview?.domainBelow,
      }),
    );

    const pressedKeep = await evaluate(
      `(() => { const b = document.querySelector('[data-testid="theme-keep"]'); if (!b) return false; b.click(); return true; })()`,
    );
    const agentKept = await waitFor(
      (s) => s.kept === "agent-written.json" && !s.preview,
    );
    check(
      "the-agents-write-is-kept-through-the-preview-bar",
      pressedKeep === true && agentKept?.kept === "agent-written.json",
      JSON.stringify({ pressedKeep, kept: agentKept?.kept }),
    );
  } finally {
    if (client) await client.close().catch(() => {});
  }

  // ── 7b: the R1 material tokens, on the real document ───────────────────
  const materialTheme = await waitFor(
    (s) =>
      s.shadowAttr === "deep" &&
      s.backdropAttr === "grid" &&
      s.typeScaleAttr === "airy" &&
      s.fontSize === "17px",
  );
  check(
    "material-tokens-land-on-the-document",
    materialTheme &&
      materialTheme.shadowAttr === "deep" &&
      materialTheme.backdropAttr === "grid" &&
      materialTheme.typeScaleAttr === "airy" &&
      materialTheme.fontSize === "17px" &&
      materialTheme.durQuick === "90ms" &&
      materialTheme.shadowSm !== "none" &&
      (materialTheme.backdrop ?? "").includes("linear-gradient") &&
      (materialTheme.contentPadTop ?? 0) >= 25 &&
      (materialTheme.railLinkPadY ?? 0) >= 8,
    JSON.stringify({
      shadow: materialTheme?.shadowAttr,
      backdrop: materialTheme?.backdropAttr,
      typeScale: materialTheme?.typeScaleAttr,
      fontSize: materialTheme?.fontSize,
      durQuick: materialTheme?.durQuick,
      shadowSm: (materialTheme?.shadowSm ?? "").slice(0, 40),
      bg: (materialTheme?.backdrop ?? "").slice(0, 40),
      pagePad: materialTheme?.contentPadTop,
      railPad: materialTheme?.railLinkPadY,
    }),
  );

  const wideRail = await waitFor(
    (s) => s.navWidthAttr === "wide" && s.navWidthVar === "19rem" && (s.railWidth ?? 0) >= 300,
  );
  check(
    "nav-rail-width-is-the-themes",
    wideRail?.navWidthAttr === "wide" &&
      wideRail.navWidthVar === "19rem" &&
      (wideRail.railWidth ?? 0) >= 300,
    JSON.stringify({
      navWidthAttr: wideRail?.navWidthAttr,
      navWidthVar: wideRail?.navWidthVar,
      railWidth: wideRail?.railWidth,
    }),
  );

  // ── 8: the operator's side of the gate, in Settings → Appearance ─────────
  const openedSettings = await evaluate(`(() => {
    const trigger = document.querySelector(".settings-menu__trigger");
    if (!trigger) return false;
    trigger.click();
    return true;
  })()`);
  let filesPanel = null;
  for (let i = 0; i < 100; i += 1) {
    filesPanel = await evaluate(`(() => {
      const panel = document.querySelector('[data-testid="theme-files"]');
      if (!panel) return null;
      return {
        rows: [...panel.querySelectorAll('[data-testid^="theme-file-row-"]')].map((row) => row.getAttribute("data-testid")),
        agentRow: Boolean(document.querySelector('[data-testid="theme-file-row-agent-written"]')),
        agentKept: Boolean(document.querySelector('[data-testid="theme-file-row-agent-written"] [data-testid="theme-file-kept"]')),
        solarRow: Boolean(document.querySelector('[data-testid="theme-file-row-solar-system"]')),
        text: panel.textContent.slice(0, 300),
      };
    })()`);
    if (filesPanel?.agentRow) break;
    await evaluate(`(() => { const b = [...document.querySelectorAll(".settings-nav-item")].find((el) => el.textContent.includes("Appearance")); if (b) b.click(); return true; })()`);
    await sleep(150);
  }
  check(
    "settings-lists-the-theme-files",
    openedSettings === true &&
      filesPanel?.agentRow === true &&
      filesPanel.agentKept === true &&
      filesPanel.solarRow === true,
    JSON.stringify(filesPanel ? { rows: filesPanel.rows, agentKept: filesPanel.agentKept } : null),
  );
  const settingsShot = await win.webContents.capturePage();
  fs.writeFileSync(SETTINGS_PNG, settingsShot.toPNG());

  // Try a file from the list: it must enter the same ten-second preview gate,
  // not jump straight to kept.
  const triedFromSettings = await evaluate(`(() => {
    const b = document.querySelector('[data-testid="theme-file-row-solar-system"] [data-testid="theme-file-try"]');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  const tried = await waitFor(
    (s) => s.preview && (s.previewText ?? "").includes("solar-system.json") && s.wingTitlebar,
  );
  check(
    "try-from-settings-enters-the-preview-gate",
    triedFromSettings === true && Boolean(tried?.preview) && tried.wingTitlebar && tried.kept === "agent-written.json",
    JSON.stringify({ tried: tried?.previewText, kept: tried?.kept }),
  );
  const revertedFromSettings = await evaluate(
    `(() => { const b = document.querySelector('[data-testid="theme-revert"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const backToAgent = await waitFor((s) => !s.preview && s.wingFloating && s.kept === "agent-written.json");
  check(
    "reverting-from-settings-returns-the-kept-theme",
    revertedFromSettings === true && Boolean(backToAgent?.wingFloating) && backToAgent.kept === "agent-written.json",
    JSON.stringify({ wing: backToAgent?.wingFloating, kept: backToAgent?.kept }),
  );

  // ── 9: the operator's own material overrides, above the theme's ─────────
  const pressedSharp = await evaluate(`(() => {
    const b = document.querySelector('[data-testid="material-option-radius-sharp"]');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  const pressedCompact = await click("material-option-density-compact");
  const overridden = await waitFor(
    (s) => s.radiusLg === "8px" && (s.contentPadTop ?? 99) <= 20 && (s.railLinkPadY ?? 99) <= 7,
  );
  check(
    "operator-material-overrides-the-theme",
    pressedSharp === true &&
      pressedCompact === true &&
      overridden?.radiusLg === "8px" &&
      (overridden.contentPadTop ?? 99) <= 20 &&
      overridden.kept === "agent-written.json",
    JSON.stringify({
      pressedSharp,
      pressedCompact,
      radiusLg: overridden?.radiusLg,
      pagePad: overridden?.contentPadTop,
      railPad: overridden?.railLinkPadY,
      kept: overridden?.kept,
    }),
  );
  const materialShot = await win.webContents.capturePage();
  fs.writeFileSync(MATERIAL_PNG, materialShot.toPNG());

  win.webContents.reload();
  await new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
  const afterMaterialReload = await waitFor(
    (s) => s.shell && s.kept === "agent-written.json" && s.radiusLg === "8px",
    20_000,
  );
  check(
    "operator-material-survives-a-reload",
    afterMaterialReload?.radiusLg === "8px" && afterMaterialReload.kept === "agent-written.json",
    JSON.stringify({ radiusLg: afterMaterialReload?.radiusLg, kept: afterMaterialReload?.kept }),
  );

  // Reopen Settings to reset and remove.
  await evaluate(`(() => { const t = document.querySelector(".settings-menu__trigger"); if (t) t.click(); return true; })()`);
  for (let i = 0; i < 100; i += 1) {
    const ready = await evaluate(`Boolean(document.querySelector('[data-testid="material-reset"]'))`);
    if (ready) break;
    await evaluate(`(() => { const b = [...document.querySelectorAll(".settings-nav-item")].find((el) => el.textContent.includes("Appearance")); if (b) b.click(); return true; })()`);
    await sleep(150);
  }
  const pressedReset = await evaluate(`(() => {
    const b = document.querySelector('[data-testid="material-reset"]');
    if (!b || b.disabled) return false;
    b.click();
    return true;
  })()`);
  const reset = await waitFor((s) => s.radiusLg === "28px");
  check(
    "reset-returns-the-themes-material",
    pressedReset === true &&
      reset?.radiusLg === "28px" &&
      (reset.contentPadTop ?? 0) >= 25 &&
      reset.kept === "agent-written.json",
    JSON.stringify({
      pressedReset,
      radiusLg: reset?.radiusLg,
      pagePad: reset?.contentPadTop,
      kept: reset?.kept,
    }),
  );

  // ── 10: the operator's own chrome overrides, above the theme's ──────────
  const pressedWing = await click("chrome-wing-place-titlebar-left");
  const pressedWingVariant = await click("chrome-wing-variant-icons");
  const pressedDomain = await click("chrome-domain-place-bottom-center");
  const pressedDomainVariant = await click("settings-domain-picker-chips-pill");
  const pressedRight = await click("chrome-nav-place-right");
  const pressedDockLeft = await click("chrome-chat-side-left");
  const pressedTitlebarTall = await click("chrome-titlebar-size-tall");
  const pressedNarrow = await click("chrome-nav-width-narrow");
  const overriddenChrome = await waitFor(
    (s) =>
      s.wingTitlebar &&
      !s.wingFloating &&
      s.domainBottom &&
      !s.domainBelow &&
      s.navWidthAttr === "narrow" &&
      s.navPlaceAttr === "right" &&
      s.dockLeft &&
      s.titlebarHeight === 40 &&
      s.railRect &&
      s.mainRect &&
      s.railRect.left >= s.mainRect.right - 16 &&
      s.wingText === "H" &&
      s.domainPill,
  );
  check(
    "operator-chrome-overrides-the-theme",
    pressedWing === true &&
      pressedWingVariant === true &&
      pressedDomain === true &&
      pressedDomainVariant === true &&
      pressedRight === true &&
      pressedDockLeft === true &&
      pressedTitlebarTall === true &&
      pressedNarrow === true &&
      overriddenChrome?.wingTitlebar === true &&
      overriddenChrome.wingFloating === false &&
      overriddenChrome.wingText === "H" &&
      overriddenChrome.domainBottom === true &&
      overriddenChrome.domainBelow === false &&
      overriddenChrome.domainPill === true &&
      overriddenChrome.navWidthAttr === "narrow" &&
      overriddenChrome.navPlaceAttr === "right" &&
      overriddenChrome.dockLeft === true &&
      overriddenChrome.titlebarHeight === 40 &&
      overriddenChrome.railRect.left >= overriddenChrome.mainRect.right - 16,
    JSON.stringify({
      pressed:
        pressedWing &&
        pressedWingVariant &&
        pressedDomain &&
        pressedDomainVariant &&
        pressedRight &&
        pressedDockLeft &&
        pressedTitlebarTall &&
        pressedNarrow,
      wingTitlebar: overriddenChrome?.wingTitlebar,
      wingText: overriddenChrome?.wingText,
      pill: overriddenChrome?.domainPill,
      navPlace: overriddenChrome?.navPlaceAttr,
      dockLeft: overriddenChrome?.dockLeft,
      titlebarHeight: overriddenChrome?.titlebarHeight,
      titlebarVar: overriddenChrome?.titlebarVar,
      titlebarAttr: overriddenChrome?.titlebarSizeAttr,
      railLeft: overriddenChrome?.railRect?.left,
      mainRight: overriddenChrome?.mainRect?.right,
      wingFloating: overriddenChrome?.wingFloating,
      domainBottom: overriddenChrome?.domainBottom,
      domainBelow: overriddenChrome?.domainBelow,
      nav: overriddenChrome?.navWidthAttr,
    }),
  );

  const layoutShot = await win.webContents.capturePage();
  fs.writeFileSync(LAYOUT_PNG, layoutShot.toPNG());

  win.webContents.reload();
  await new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
  const afterChromeReload = await waitFor(
    (s) =>
      s.shell &&
      s.kept === "agent-written.json" &&
      s.wingTitlebar &&
      s.domainBottom &&
      s.navWidthAttr === "narrow" &&
      s.navPlaceAttr === "right" &&
      s.dockLeft &&
      s.titlebarHeight === 40,
    20_000,
  );
  check(
    "operator-chrome-survives-a-reload",
    afterChromeReload?.wingTitlebar === true &&
      afterChromeReload.domainBottom === true &&
      afterChromeReload.navWidthAttr === "narrow" &&
      afterChromeReload.navPlaceAttr === "right" &&
      afterChromeReload.dockLeft === true &&
      afterChromeReload.titlebarHeight === 40,
    JSON.stringify({
      wingTitlebar: afterChromeReload?.wingTitlebar,
      domainBottom: afterChromeReload?.domainBottom,
      nav: afterChromeReload?.navWidthAttr,
      navPlace: afterChromeReload?.navPlaceAttr,
      dockLeft: afterChromeReload?.dockLeft,
      titlebarHeight: afterChromeReload?.titlebarHeight,
    }),
  );

  // Reopen Settings and hand layout back to the theme.
  await evaluate(`(() => { const t = document.querySelector(".settings-menu__trigger"); if (t) t.click(); return true; })()`);
  for (let i = 0; i < 100; i += 1) {
    const ready = await evaluate(`Boolean(document.querySelector('[data-testid="chrome-reset"]'))`);
    if (ready) break;
    await evaluate(`(() => { const b = [...document.querySelectorAll(".settings-nav-item")].find((el) => el.textContent.includes("Appearance")); if (b) b.click(); return true; })()`);
    await sleep(150);
  }
  const pressedChromeReset = await click("chrome-reset");
  const resetChrome = await waitFor(
    (s) =>
      s.wingFloating &&
      !s.wingTitlebar &&
      s.domainBelow &&
      s.navWidthAttr === "wide" &&
      s.navPlaceAttr === "left" &&
      !s.dockLeft &&
      s.titlebarHeight === 32,
  );
  check(
    "reset-returns-the-themes-chrome",
    pressedChromeReset === true &&
      resetChrome?.wingFloating === true &&
      resetChrome.wingTitlebar === false &&
      resetChrome.domainBelow === true &&
      resetChrome.navWidthAttr === "wide" &&
      resetChrome.navPlaceAttr === "left" &&
      resetChrome.dockLeft === false &&
      resetChrome.titlebarHeight === 32,
    JSON.stringify({
      pressed: pressedChromeReset,
      wingFloating: resetChrome?.wingFloating,
      domainBelow: resetChrome?.domainBelow,
      nav: resetChrome?.navWidthAttr,
      navPlace: resetChrome?.navPlaceAttr,
      dockLeft: resetChrome?.dockLeft,
      titlebarHeight: resetChrome?.titlebarHeight,
    }),
  );

  // The operator's own scene pick, above the theme's: the kept agent theme has
  // no scene, so this is the operator's sky and Reset must take it away again.
  const pressedSceneOrbit = await click("scene-option-preset-orbit");
  const pressedSceneCalm = await click("scene-option-intensity-calm");
  const pressedSceneHalo = await click("scene-option-canvas-halo");
  const pressedSceneRaised = await click("scene-option-cards-raised");
  const overriddenScene = await waitFor(
    (s) =>
      s.scenePresetAttr === "orbit" &&
      s.sceneIntensityAttr === "calm" &&
      s.sceneLayer &&
      s.sceneNodes >= 5 &&
      s.sceneCanvasFrameAttr === "halo" &&
      s.sceneCardFrameAttr === "raised" &&
      (s.canvasFrameBorder ?? 0) >= 1 &&
      s.cardProbe !== null &&
      s.cardProbe.shadow !== "none",
  );
  check(
    "operator-scene-overrides-the-theme",
    pressedSceneOrbit === true &&
      pressedSceneCalm === true &&
      pressedSceneHalo === true &&
      pressedSceneRaised === true &&
      overriddenScene?.scenePresetAttr === "orbit" &&
      overriddenScene.sceneIntensityAttr === "calm" &&
      overriddenScene.sceneLayer === true &&
      overriddenScene.sceneNodes >= 5 &&
      overriddenScene.sceneCanvasFrameAttr === "halo" &&
      overriddenScene.sceneCardFrameAttr === "raised" &&
      (overriddenScene.canvasFrameBorder ?? 0) >= 1 &&
      overriddenScene.cardProbe !== null &&
      overriddenScene.cardProbe.shadow !== "none",
    JSON.stringify({
      pressed:
        pressedSceneOrbit && pressedSceneCalm && pressedSceneHalo && pressedSceneRaised,
      preset: overriddenScene?.scenePresetAttr,
      intensity: overriddenScene?.sceneIntensityAttr,
      nodes: overriddenScene?.sceneNodes,
      canvas: overriddenScene?.sceneCanvasFrameAttr,
      cards: overriddenScene?.sceneCardFrameAttr,
      card: overriddenScene?.cardProbe === null ? "none" : "found",
      hash: overriddenScene?.hash,
    }),
  );

  const pressedSceneReset = await click("scene-reset");
  const resetScene = await waitFor(
    (s) =>
      s.scenePresetAttr === "plain" &&
      !s.sceneLayer &&
      s.sceneCanvasFrameAttr === "none" &&
      s.sceneCardFrameAttr === "theme",
  );
  check(
    "reset-returns-the-themes-scene",
    pressedSceneReset === true &&
      resetScene?.scenePresetAttr === "plain" &&
      resetScene.sceneLayer === false &&
      resetScene.sceneCanvasFrameAttr === "none" &&
      resetScene.sceneCardFrameAttr === "theme",
    JSON.stringify({
      pressed: pressedSceneReset,
      preset: resetScene?.scenePresetAttr,
      layer: resetScene?.sceneLayer,
      canvas: resetScene?.sceneCanvasFrameAttr,
      cards: resetScene?.sceneCardFrameAttr,
    }),
  );

  // Remove the agent's file where the operator would: two presses, then gone.
  const firstRemove = await evaluate(`(() => {
    const b = document.querySelector('[data-testid="theme-file-row-agent-written"] [data-testid="theme-file-remove"]');
    if (!b) return false;
    b.click();
    return b.textContent.trim();
  })()`);
  const confirming = await evaluate(`(() => {
    const b = document.querySelector('[data-testid="theme-file-row-agent-written"] [data-testid="theme-file-remove"]');
    return b ? b.textContent.trim() : null;
  })()`);
  await evaluate(`(() => {
    const b = document.querySelector('[data-testid="theme-file-row-agent-written"] [data-testid="theme-file-remove"]');
    if (b) b.click();
    return true;
  })()`);
  const removed = await waitFor(
    (s) => !s.wingFloating && !s.wingTitlebar && s.railWings && s.kept === null,
    15_000,
  );
  check(
    "settings-removes-a-theme-and-restores-the-default",
    firstRemove !== false &&
      confirming !== null &&
      confirming !== "Remove" &&
      fs.existsSync(path.join(themesDir, "agent-written.json")) === false &&
      removed?.railWings === true &&
      removed.wingFloating === false &&
      removed.kept === null,
    JSON.stringify({
      confirm: confirming,
      fileGone: !fs.existsSync(path.join(themesDir, "agent-written.json")),
      wing: removed?.wingFloating,
      kept: removed?.kept,
    }),
  );

  // ── 11b: the bundled showcase — seeded once, worn, kept ─────────────────
  // R3 asked for one "solar system" theme that shows the whole ladder without
  // an agent: it ships in the app and is copied into a fresh profile's themes
  // directory on first run. Here the operator finds it in the list and wears
  // it — the app must not wear it for them.
  const showcaseFile = path.join(themesDir, "showcase-solar-system.json");
  const showcaseOnDisk = fs.existsSync(showcaseFile)
    ? JSON.parse(fs.readFileSync(showcaseFile, "utf8"))
    : null;
  check(
    "first-run-seeds-the-showcase-theme",
    showcaseOnDisk?.name === "showcase-solar-system" &&
      showcaseOnDisk?.scene?.background?.preset === "orbit" &&
      showcaseOnDisk?.scene?.frames?.canvas === "halo" &&
      showcaseOnDisk?.chrome?.navRail?.place === "floating" &&
      typeof showcaseOnDisk?.colors?.accent === "string",
    JSON.stringify({
      file: fs.existsSync(showcaseFile),
      name: showcaseOnDisk?.name,
      preset: showcaseOnDisk?.scene?.background?.preset,
      canvas: showcaseOnDisk?.scene?.frames?.canvas,
      nav: showcaseOnDisk?.chrome?.navRail?.place,
    }),
  );

  const showcaseRow = await evaluate(`(() => {
    const row = document.querySelector('[data-testid="theme-file-row-showcase-solar-system"]');
    return row ? Boolean(row.querySelector('[data-testid="theme-file-try"]')) : false;
  })()`);
  const showcaseClicked = await evaluate(`(() => {
    const b = document.querySelector('[data-testid="theme-file-row-showcase-solar-system"] [data-testid="theme-file-try"]');
    if (!b) return "missing";
    b.click();
    return b.getAttribute("data-testid");
  })()`);
  await sleep(500);
  const showcaseProbe = await evaluate(`(() => ({
    preview: Boolean(document.querySelector('[data-testid="theme-preview-bar"]')),
    previewText: document.querySelector('[data-testid="theme-preview-bar"]')?.textContent ?? null,
    fileError: document.querySelector('[data-testid="theme-file-error"]')?.textContent ?? null,
    fileStatus: document.querySelector('[data-testid="theme-file-status"]')?.textContent ?? null,
    rowText: document.querySelector('[data-testid="theme-file-row-showcase-solar-system"]')?.textContent?.slice(0, 160) ?? null,
    preset: document.documentElement.dataset.sceneBackdrop ?? null,
  }))()`);
  await sleep(900);
  const showcaseProbe2 = await evaluate(`(() => {
    const root = document.documentElement;
    const bar = document.querySelector(".window-titlebar");
    return {
      preview: Boolean(document.querySelector('[data-testid="theme-preview-bar"]')),
      preset: root.dataset.sceneBackdrop ?? null,
      canvas: root.dataset.sceneCanvasFrame ?? null,
      cards: root.dataset.sceneCardFrame ?? null,
      navPlace: root.dataset.chromeNavPlace ?? null,
      navWidth: root.dataset.chromeNavWidth ?? null,
      dockLeft: document.querySelector(".shell")?.classList.contains("shell--dock-left") ?? null,
      titlebar: bar ? Math.round(bar.getBoundingClientRect().height) : null,
      accent: getComputedStyle(root).getPropertyValue("--accent").trim(),
      navWidthVar: getComputedStyle(root).getPropertyValue("--shell-sidebar-width").trim(),
    };
  })()`);
  const showcase = await waitFor(
    (s) =>
      s.preview &&
      (s.previewText ?? "").includes("showcase-solar-system.json") &&
      s.scenePresetAttr === "orbit" &&
      s.sceneCanvasFrameAttr === "halo" &&
      s.sceneCardFrameAttr === "raised" &&
      s.navPlaceAttr === "floating" &&
      s.navWidthAttr === "wide" &&
      s.titlebarHeight === 40 &&
      ["#0a0e1f", "#070b17"].includes((s.bgVar ?? "").toLowerCase()),
    25_000,
  );
  check(
    "the-showcase-wears-its-whole-ladder",
    showcaseRow === true &&
      showcase?.kept === null &&
      showcase.scenePresetAttr === "orbit" &&
      showcase.sceneCanvasFrameAttr === "halo" &&
      showcase.sceneCardFrameAttr === "raised" &&
      showcase.navPlaceAttr === "floating" &&
      showcase.navWidthAttr === "wide" &&
      showcase.titlebarHeight === 40 &&
      ["#0a0e1f", "#070b17"].includes((showcase.bgVar ?? "").toLowerCase()),
    JSON.stringify({
      row: showcaseRow,
      clicked: showcaseClicked,
      probe: showcaseProbe,
      probe2: showcaseProbe2,
      kept: showcase?.kept,
      preset: showcase?.scenePresetAttr,
      canvas: showcase?.sceneCanvasFrameAttr,
      nav: showcase?.navPlaceAttr,
      strip: showcase?.titlebarHeight,
      bg: showcase?.bgVar,
    }),
  );
  const showcaseShot = await win.webContents.capturePage();
  fs.writeFileSync(SHOWCASE_PNG, showcaseShot.toPNG());

  const keptShowcase = await evaluate(
    `(() => { const b = document.querySelector('[data-testid="theme-keep"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const showcaseKept = await waitFor(
    (s) => keptShowcase === true && !s.preview && s.kept === "showcase-solar-system.json",
    15_000,
  );
  win.webContents.reload();
  await new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
  const afterShowcaseReload = await waitFor(
    (s) =>
      s.shell &&
      s.kept === "showcase-solar-system.json" &&
      s.scenePresetAttr === "orbit" &&
      s.sceneCanvasFrameAttr === "halo" &&
      s.navPlaceAttr === "floating" &&
      ["#0a0e1f", "#070b17"].includes((s.bgVar ?? "").toLowerCase()),
    25_000,
  );
  check(
    "the-showcase-keeps-and-survives-a-reload",
    keptShowcase === true &&
      showcaseKept?.kept === "showcase-solar-system.json" &&
      afterShowcaseReload?.kept === "showcase-solar-system.json" &&
      afterShowcaseReload.scenePresetAttr === "orbit" &&
      afterShowcaseReload.sceneCanvasFrameAttr === "halo" &&
      afterShowcaseReload.navPlaceAttr === "floating" &&
      ["#0a0e1f", "#070b17"].includes((afterShowcaseReload.bgVar ?? "").toLowerCase()),
    JSON.stringify({
      kept: afterShowcaseReload?.kept,
      preset: afterShowcaseReload?.scenePresetAttr,
      canvas: afterShowcaseReload?.sceneCanvasFrameAttr,
      nav: afterShowcaseReload?.navPlaceAttr,
      bg: afterShowcaseReload?.bgVar,
    }),
  );

  // ── 11c: the R3 gate — a companion-authored scene, quieted by the operator
  // A fresh door client (the companion's real shape is a call, not a session):
  // it writes a theme whose whole scene vocabulary is non-default — aurora at
  // lively, a hairline page edge, raised cards — and the window must wear it
  // with its way out still painted. Then the operator quietens it from
  // Settings, Reset hands the theme's sky back, and Keep + reload prove it is
  // still the theme's.
  const sceneGateDoor = await e2eCompanionDoor();
  const { Client: SceneGateClient } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport: SceneGateTransport } = await import(
    "@modelcontextprotocol/sdk/client/streamableHttp.js"
  );
  const sceneGateClient = new SceneGateClient({
    name: "theme-rig-r3-gate",
    version: "0.1.0",
  });
  await sceneGateClient.connect(
    new SceneGateTransport(new URL(sceneGateDoor.url), {
      requestInit: { headers: { Authorization: `Bearer ${sceneGateDoor.token}` } },
    }),
  );
  const sceneGateCall = async (name, args) => {
    const result = await sceneGateClient.callTool({ name, arguments: args });
    const text = result.content?.find((part) => part.type === "text")?.text ?? "{}";
    try {
      return { json: JSON.parse(text), isError: result.isError === true };
    } catch {
      return { json: null, isError: true };
    }
  };
  // The showcase is bundled data; authorship is the companion's job. Have the
  // door write that same object itself under its own file name: the app must
  // accept it and wear it, proving the shipped content is companion-authorable
  // data rather than a file only the app's installer could produce.
  const authoredShowcase = await sceneGateCall("write_theme", {
    theme: showcaseOnDisk,
    file: "showcase-authored.json",
  });
  const authoredPreview = await waitFor(
    (s) =>
      s.preview &&
      (s.previewText ?? "").includes("showcase-authored.json") &&
      s.scenePresetAttr === "orbit" &&
      s.sceneCanvasFrameAttr === "halo",
    25_000,
  );
  check(
    "the-companion-can-author-the-bundled-showcase",
    authoredShowcase.json?.written === "showcase-authored.json" &&
      authoredPreview?.scenePresetAttr === "orbit" &&
      authoredPreview.sceneCanvasFrameAttr === "halo" &&
      authoredPreview.sceneCardFrameAttr === "raised",
    JSON.stringify({
      written: authoredShowcase.json?.written,
      preset: authoredPreview?.scenePresetAttr,
      canvas: authoredPreview?.sceneCanvasFrameAttr,
      cards: authoredPreview?.sceneCardFrameAttr,
    }),
  );
  await evaluate(
    `(() => { const b = document.querySelector('[data-testid="theme-revert"]'); if (!b) return false; b.click(); return true; })()`,
  );
  await waitFor((s) => !s.preview && s.kept === "showcase-solar-system.json");

  const SCENE_GATE_THEME = {
    name: "r3-gate",
    label: "R3 Gate",
    description: "Aurora at lively, a hairline page edge, raised cards.",
    chrome: { wingSwitcher: { place: "titlebar-left", variant: "labels" } },
    material: { radius: "round" },
    scene: {
      background: { preset: "aurora", intensity: "lively" },
      frames: { canvas: "hairline", cards: "raised" },
    },
  };
  const sceneGateWritten = await sceneGateCall("write_theme", {
    theme: SCENE_GATE_THEME,
  });
  const sceneGate = await waitFor(
    (s) =>
      s.preview &&
      (s.previewText ?? "").includes("r3-gate.json") &&
      s.scenePresetAttr === "aurora" &&
      s.sceneIntensityAttr === "lively" &&
      s.sceneCanvasFrameAttr === "hairline" &&
      s.sceneCardFrameAttr === "raised" &&
      s.sceneLayer &&
      s.sceneNodes >= 3 &&
      typeof s.sceneDuration === "number" &&
      s.sceneDuration > 8 &&
      s.scenePointerEvents === "none" &&
      s.sceneAriaHidden === "true",
    25_000,
  );
  check(
    "a-scene-authored-outside-can-be-worn",
    sceneGateWritten.json?.written === "r3-gate.json" &&
      sceneGate?.scenePresetAttr === "aurora" &&
      sceneGate.sceneIntensityAttr === "lively" &&
      sceneGate.sceneCanvasFrameAttr === "hairline" &&
      sceneGate.sceneCardFrameAttr === "raised" &&
      sceneGate.sceneLayer === true &&
      sceneGate.sceneNodes >= 3 &&
      sceneGate.sceneDuration > 8 &&
      sceneGate.scenePointerEvents === "none" &&
      sceneGate.sceneAriaHidden === "true",
    JSON.stringify({
      written: sceneGateWritten.json?.written,
      preset: sceneGate?.scenePresetAttr,
      intensity: sceneGate?.sceneIntensityAttr,
      canvas: sceneGate?.sceneCanvasFrameAttr,
      cards: sceneGate?.sceneCardFrameAttr,
      nodes: sceneGate?.sceneNodes,
      duration: sceneGate?.sceneDuration,
      pointer: sceneGate?.scenePointerEvents,
      aria: sceneGate?.sceneAriaHidden,
    }),
  );

  // R3's escape-hatch contract: decoration never removes or covers the way out.
  check(
    "a-scene-theme-keeps-the-way-out-painted",
    sceneGate?.preview === true &&
      sceneGate.stripPainted === true &&
      sceneGate.settingsEntry === true &&
      sceneGate.scenePointerEvents === "none",
    JSON.stringify({
      preview: sceneGate?.preview,
      strip: sceneGate?.stripPainted,
      settings: sceneGate?.settingsEntry,
      pointer: sceneGate?.scenePointerEvents,
    }),
  );
  const r3GateShot = await win.webContents.capturePage();
  fs.writeFileSync(R3_GATE_PNG, r3GateShot.toPNG());

  const keptSceneGate = await evaluate(
    `(() => { const b = document.querySelector('[data-testid="theme-keep"]'); if (!b) return false; b.click(); return true; })()`,
  );
  win.webContents.reload();
  await new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
  const sceneGateReload = await waitFor(
    (s) =>
      s.shell &&
      keptSceneGate === true &&
      s.kept === "r3-gate.json" &&
      s.scenePresetAttr === "aurora" &&
      s.sceneCanvasFrameAttr === "hairline" &&
      s.settingsEntry &&
      s.stripPainted,
    25_000,
  );
  check(
    "a-scene-theme-keeps-across-a-reload",
    keptSceneGate === true &&
      sceneGateReload?.kept === "r3-gate.json" &&
      sceneGateReload.scenePresetAttr === "aurora" &&
      sceneGateReload.sceneCanvasFrameAttr === "hairline" &&
      sceneGateReload.settingsEntry === true &&
      sceneGateReload.stripPainted === true,
    JSON.stringify({
      kept: sceneGateReload?.kept,
      preset: sceneGateReload?.scenePresetAttr,
      canvas: sceneGateReload?.sceneCanvasFrameAttr,
    }),
  );

  // The operator's own pick, above the companion's theme.
  await evaluate(`(() => {
    const trigger = document.querySelector(".settings-menu__trigger");
    if (trigger) trigger.click();
    return true;
  })()`);
  for (let i = 0; i < 60; i += 1) {
    const onAppearance = await evaluate(`(() => {
      if (document.querySelector('[data-testid="theme-scene"]')) return true;
      const item = [...document.querySelectorAll(".settings-nav-item")].find((el) => el.textContent.includes("Appearance"));
      if (item) item.click();
      return false;
    })()`);
    if (onAppearance) break;
    await sleep(150);
  }
  const pressedGateStarfield = await click("scene-option-preset-starfield");
  const pressedGateCalm = await click("scene-option-intensity-calm");
  const pressedGateDouble = await click("scene-option-canvas-double");
  const quietedScene = await waitFor(
    (s) =>
      s.scenePresetAttr === "starfield" &&
      s.sceneIntensityAttr === "calm" &&
      s.sceneCanvasFrameAttr === "double" &&
      s.sceneCardFrameAttr === "raised" &&
      s.sceneNodes >= 60 &&
      s.kept === "r3-gate.json",
  );
  check(
    "the-operator-can-quieten-a-companion-scene",
    pressedGateStarfield === true &&
      pressedGateCalm === true &&
      pressedGateDouble === true &&
      quietedScene?.scenePresetAttr === "starfield" &&
      quietedScene.sceneIntensityAttr === "calm" &&
      quietedScene.sceneCanvasFrameAttr === "double" &&
      quietedScene.sceneCardFrameAttr === "raised" &&
      quietedScene.sceneNodes >= 60,
    JSON.stringify({
      pressed:
        pressedGateStarfield && pressedGateCalm && pressedGateDouble,
      preset: quietedScene?.scenePresetAttr,
      intensity: quietedScene?.sceneIntensityAttr,
      canvas: quietedScene?.sceneCanvasFrameAttr,
      cards: quietedScene?.sceneCardFrameAttr,
      nodes: quietedScene?.sceneNodes,
    }),
  );

  // Reset hands the whole scene back to the theme, not to the default.
  const pressedGateReset = await click("scene-reset");
  const sceneGateReset = await waitFor(
    (s) =>
      s.scenePresetAttr === "aurora" &&
      s.sceneIntensityAttr === "lively" &&
      s.sceneCanvasFrameAttr === "hairline" &&
      s.sceneCardFrameAttr === "raised" &&
      s.kept === "r3-gate.json",
  );
  check(
    "reset-hands-the-companion-scene-back",
    pressedGateReset === true &&
      sceneGateReset?.scenePresetAttr === "aurora" &&
      sceneGateReset.sceneIntensityAttr === "lively" &&
      sceneGateReset.sceneCanvasFrameAttr === "hairline" &&
      sceneGateReset.sceneCardFrameAttr === "raised",
    JSON.stringify({
      pressed: pressedGateReset,
      preset: sceneGateReset?.scenePresetAttr,
      intensity: sceneGateReset?.sceneIntensityAttr,
      canvas: sceneGateReset?.sceneCanvasFrameAttr,
      cards: sceneGateReset?.sceneCardFrameAttr,
    }),
  );

  // And a scene the app cannot draw is refused by name, not painted half-way.
  const badGateScene = await sceneGateCall("validate_theme", {
    theme: {
      name: "bad-gate",
      label: "Bad Gate",
      scene: {
        background: { preset: "comet" },
        frames: { cards: "glass" },
      },
    },
  });
  check(
    "a-scene-the-app-cannot-draw-is-refused-by-name",
    badGateScene.json?.error?.message?.includes(
      "scene.background.preset must be one of",
    ) === true,
    String(badGateScene.json?.error?.message ?? badGateScene.json).slice(0, 220),
  );

  // ── 12: the Phase 1 gate — a whole theme from outside, worn and kept ────
  // The first door client closed with its own section; the gate opens a fresh
  // one, which is also the companion's real shape: a call, not a session.
  const gateDoor = await e2eCompanionDoor();
  const { Client: GateClient } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport: GateTransport } = await import(
    "@modelcontextprotocol/sdk/client/streamableHttp.js"
  );
  const gateClient = new GateClient({ name: "theme-rig-gate", version: "0.1.0" });
  await gateClient.connect(
    new GateTransport(new URL(gateDoor.url), {
      requestInit: { headers: { Authorization: `Bearer ${gateDoor.token}` } },
    }),
  );
  const gateCall = async (name, args) => {
    const result = await gateClient.callTool({ name, arguments: args });
    const text = result.content?.find((part) => part.type === "text")?.text ?? "{}";
    try {
      return { json: JSON.parse(text), isError: result.isError === true };
    } catch {
      return { json: null, isError: true };
    }
  };
  const showcaseValidation = await gateCall("validate_theme", {
    theme: showcaseOnDisk,
  });
  check(
    "the-bundled-showcase-passes-the-companions-validator",
    showcaseValidation.json?.ok === true &&
      showcaseValidation.json?.theme?.scene?.background?.preset === "orbit",
    JSON.stringify({
      ok: showcaseValidation.json?.ok,
      preset: showcaseValidation.json?.theme?.scene?.background?.preset,
      error: showcaseValidation.json?.error?.message,
    }),
  );

  // ── 12b: R4.0 — the composition contract is the whole gate ─────────────
  // No renderer yet: this slice exists so a companion can author a composition
  // and be told exactly which field is wrong, before anything is drawn. The
  // closed sets are asserted from the validator's side, so the vocabulary the
  // companion sees and the parser cannot drift apart.
  const R4_WIDGETS = [
    {
      type: "badge",
      region: "page.masthead",
      data: "goals.count",
      label: "Goals",
      tone: "accent",
    },
    {
      type: "meter",
      region: "rail.footer",
      data: "weekly.files",
      label: "This week",
      max: 7,
    },
  ];
  const R4_THEME = {
    name: "r4-contract",
    label: "R4 contract",
    composition: { layout: "stack", widgets: R4_WIDGETS },
  };
  const r4Valid = await gateCall("validate_theme", { theme: R4_THEME });
  const r4Invalid = async (composition) =>
    gateCall("validate_theme", {
      theme: { ...R4_THEME, composition },
    });
  const r4BadType = await r4Invalid({
    layout: "stack",
    widgets: [{ ...R4_WIDGETS[0], type: "gauge" }],
  });
  const r4BadRegion = await r4Invalid({
    layout: "stack",
    widgets: [{ ...R4_WIDGETS[0], region: "sidebar.middle" }],
  });
  const r4BadData = await r4Invalid({
    layout: "stack",
    widgets: [{ ...R4_WIDGETS[0], data: "vault.secrets" }],
  });
  const r4BadLayout = await r4Invalid({
    layout: "radial",
    widgets: R4_WIDGETS,
  });
  const r4MeterNoMax = await r4Invalid({
    layout: "stack",
    widgets: [{ ...R4_WIDGETS[1], max: undefined }],
  });
  const r4TooMany = await r4Invalid({
    layout: "stack",
    widgets: Array.from({ length: 9 }, () => ({ ...R4_WIDGETS[0] })),
  });
  const r4BadColumnsOnStack = await r4Invalid({
    layout: "stack",
    columns: 2,
    widgets: R4_WIDGETS,
  });
  const r4BadColumns = await r4Invalid({
    layout: "grid",
    columns: 4,
    widgets: R4_WIDGETS,
  });
  const r4BadRadiusOnGrid = await r4Invalid({
    layout: "grid",
    radius: "wide",
    widgets: R4_WIDGETS,
  });
  const r4BadRoute = await r4Invalid({
    layout: "polar",
    widgets: [
      {
        type: "quickAction",
        region: "page.orbit",
        route: "/etc/passwd",
        label: "Pwn",
      },
    ],
  });
  const r4OrbitWithoutPolar = await r4Invalid({
    layout: "stack",
    widgets: [
      {
        type: "quickAction",
        region: "page.orbit",
        route: "home",
        label: "Home",
      },
    ],
  });
  const r4QuickActionValid = await gateCall("validate_theme", {
    theme: {
      ...R4_THEME,
      composition: {
        layout: "polar",
        radius: "default",
        widgets: [
          {
            type: "quickAction",
            region: "page.orbit",
            route: "home",
            label: "Home",
            tone: "accent",
          },
        ],
      },
    },
  });
  const R4_VOCABULARY = [
    { type: "avatar", region: "page.masthead", data: "vault.name", label: "Operator" },
    { type: "list", region: "page.masthead", data: "domains.names", label: "Areas", limit: 3 },
    { type: "clock", region: "page.masthead", label: "Clock", format: "24h" },
    { type: "calendar", region: "page.footer", label: "Week" },
    { type: "brief", region: "page.footer", data: "weekly.files", label: "Reviews", caption: "Files in the vault" },
    { type: "badge", region: "page.footer", data: "goals.count", label: "Goals" },
  ];
  const r4VocabularyValid = await gateCall("validate_theme", {
    theme: {
      ...R4_THEME,
      composition: { layout: "stack", widgets: R4_VOCABULARY },
    },
  });
  const r4AvatarBadData = await r4Invalid({
    layout: "stack",
    widgets: [
      { type: "avatar", region: "page.masthead", data: "goals.count", label: "Me" },
    ],
  });
  const r4ListBadData = await r4Invalid({
    layout: "stack",
    widgets: [
      { type: "list", region: "page.masthead", data: "vault.name", label: "Areas" },
    ],
  });
  const r4ListLimit = await r4Invalid({
    layout: "stack",
    widgets: [
      { type: "list", region: "page.masthead", data: "domains.names", label: "Areas", limit: 9 },
    ],
  });
  const r4ClockFormat = await r4Invalid({
    layout: "stack",
    widgets: [{ type: "clock", region: "page.masthead", label: "Clock", format: "moon" }],
  });
  const r4BriefCaption = await r4Invalid({
    layout: "stack",
    widgets: [
      {
        type: "brief",
        region: "page.masthead",
        data: "goals.count",
        label: "Goals",
        caption: "x".repeat(49),
      },
    ],
  });
  const r4Error = (result) =>
    String(result.json?.error?.message ?? result.json?.error ?? "");

  check(
    "r4-valid-composition-parses-back-field-for-field",
    r4Valid.json?.ok === true &&
      r4Valid.json?.theme?.composition?.layout === "stack" &&
      r4Valid.json?.theme?.composition?.widgets?.length === 2 &&
      r4Valid.json.theme.composition.widgets[0].type === "badge" &&
      r4Valid.json.theme.composition.widgets[0].region === "page.masthead" &&
      r4Valid.json.theme.composition.widgets[0].data === "goals.count" &&
      r4Valid.json.theme.composition.widgets[0].label === "Goals" &&
      r4Valid.json.theme.composition.widgets[0].tone === "accent" &&
      r4Valid.json.theme.composition.widgets[1].type === "meter" &&
      r4Valid.json.theme.composition.widgets[1].region === "rail.footer" &&
      r4Valid.json.theme.composition.widgets[1].max === 7,
    JSON.stringify(r4Valid.json),
  );
  check(
    "r4-unknown-widget-type-is-refused-with-its-field",
    r4Error(r4BadType).includes("composition.widgets[0].type must be one of"),
    r4Error(r4BadType),
  );
  check(
    "r4-unknown-region-is-refused-with-its-field",
    r4Error(r4BadRegion).includes("composition.widgets[0].region must be one of"),
    r4Error(r4BadRegion),
  );
  check(
    "r4-unknown-data-source-is-refused-with-its-field",
    r4Error(r4BadData).includes("composition.widgets[0].data must be one of"),
    r4Error(r4BadData),
  );
  check(
    "r4-undrawable-layout-is-refused",
    r4Error(r4BadLayout).includes("composition.layout must be one of stack"),
    r4Error(r4BadLayout),
  );
  check(
    "r4-meter-without-a-denominator-is-refused",
    r4Error(r4MeterNoMax).includes(
      "composition.widgets[0].max must be an integer from 1 to 1000",
    ),
    r4Error(r4MeterNoMax),
  );
  check(
    "r4-a-wall-of-widgets-is-refused",
    r4Error(r4TooMany).includes("composition.widgets must hold 1–8 widgets"),
    r4Error(r4TooMany),
  );
  check(
    "r4-a-quick-action-parses-with-its-route",
    r4QuickActionValid.json?.ok === true &&
      r4QuickActionValid.json.theme.composition.layout === "polar" &&
      r4QuickActionValid.json.theme.composition.radius === "default" &&
      r4QuickActionValid.json.theme.composition.widgets[0].type ===
        "quickAction" &&
      r4QuickActionValid.json.theme.composition.widgets[0].route === "home",
    JSON.stringify(r4QuickActionValid.json),
  );
  check(
    "r4-columns-are-only-for-the-grid-layout",
    r4Error(r4BadColumnsOnStack).includes(
      "composition.columns is only for the grid layout",
    ),
    r4Error(r4BadColumnsOnStack),
  );
  check(
    "r4-grid-columns-are-closed",
    r4Error(r4BadColumns).includes("composition.columns must be 2 or 3"),
    r4Error(r4BadColumns),
  );
  check(
    "r4-radius-is-only-for-the-polar-layout",
    r4Error(r4BadRadiusOnGrid).includes(
      "composition.radius is only for the polar layout",
    ),
    r4Error(r4BadRadiusOnGrid),
  );
  check(
    "r4-a-quick-action-route-is-closed",
    r4Error(r4BadRoute).includes(
      "composition.widgets[0].route must be one of",
    ),
    r4Error(r4BadRoute),
  );
  check(
    "r4-the-orbit-region-requires-the-polar-layout",
    r4Error(r4OrbitWithoutPolar).includes(
      "composition.widgets[0].region page.orbit requires the polar layout",
    ),
    r4Error(r4OrbitWithoutPolar),
  );
  check(
    "r4-the-bound-widget-vocabulary-parses-field-for-field",
    r4VocabularyValid.json?.ok === true &&
      r4VocabularyValid.json.theme.composition.widgets.length ===
        R4_VOCABULARY.length &&
      r4VocabularyValid.json.theme.composition.widgets.every(
        (widget, index) => widget.type === R4_VOCABULARY[index].type,
      ) &&
      r4VocabularyValid.json.theme.composition.widgets[1].limit === 3 &&
      r4VocabularyValid.json.theme.composition.widgets[2].format === "24h" &&
      r4VocabularyValid.json.theme.composition.widgets[4].caption ===
        "Files in the vault",
    JSON.stringify(r4VocabularyValid.json),
  );
  check(
    "r4-avatar-binds-only-the-vault-name",
    r4Error(r4AvatarBadData).includes(
      "composition.widgets[0].data must be one of vault.name",
    ),
    r4Error(r4AvatarBadData),
  );
  check(
    "r4-list-binds-only-names",
    r4Error(r4ListBadData).includes(
      "composition.widgets[0].data must be one of domains.names, goals.titles",
    ),
    r4Error(r4ListBadData),
  );
  check(
    "r4-list-limit-is-bounded",
    r4Error(r4ListLimit).includes(
      "composition.widgets[0].limit must be an integer from 1 to 5",
    ),
    r4Error(r4ListLimit),
  );
  check(
    "r4-clock-format-is-closed",
    r4Error(r4ClockFormat).includes(
      "composition.widgets[0].format must be one of 24h, 12h",
    ),
    r4Error(r4ClockFormat),
  );
  check(
    "r4-brief-caption-is-bounded",
    r4Error(r4BriefCaption).includes(
      "composition.widgets[0].caption must be a string of at most 48 chars",
    ),
    r4Error(r4BriefCaption),
  );
  fs.writeFileSync(
    R4_VALIDATION_JSON,
    `${JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        valid: r4Valid.json,
        refused: {
          unknownType: r4Error(r4BadType),
          unknownRegion: r4Error(r4BadRegion),
          unknownData: r4Error(r4BadData),
          unknownLayout: r4Error(r4BadLayout),
          meterWithoutMax: r4Error(r4MeterNoMax),
          sevenWidgets: r4Error(r4TooMany),
        },
      },
      null,
      2,
    )}\n`,
  );

  const outsideWritten = await gateCall("write_theme", { theme: OUTSIDE_THEME });
  const outside = await waitFor(
    (s) =>
      s.preview &&
      (s.previewText ?? "").includes("outside-theme.json") &&
      s.wingFloating &&
      s.domainBottom &&
      s.domainPill &&
      s.navPlaceAttr === "floating" &&
      s.navWidthAttr === "wide" &&
      s.dockLeft &&
      s.titlebarHeight === 40 &&
      s.radiusLg === "8px" &&
      s.shadowAttr === "flat" &&
      s.motion === "none" &&
      s.typeScaleAttr === "compact" &&
      s.density === "compact" &&
      s.backdropAttr === "grid",
    25_000,
  );
  check(
    "a-theme-authored-outside-can-be-worn",
    outsideWritten.json?.written === "outside-theme.json" &&
      outside?.wingFloating === true &&
      outside.domainBottom === true &&
      outside.domainPill === true &&
      outside.navPlaceAttr === "floating" &&
      outside.navWidthAttr === "wide" &&
      outside.dockLeft === true &&
      outside.titlebarHeight === 40 &&
      outside.radiusLg === "8px" &&
      outside.shadowAttr === "flat" &&
      outside.motion === "none" &&
      outside.typeScaleAttr === "compact" &&
      outside.density === "compact" &&
      outside.backdropAttr === "grid",
    JSON.stringify({
      written: outsideWritten.json?.written,
      preview: outside?.preview,
      wing: outside?.wingFloating,
      domain: outside?.domainBottom,
      pill: outside?.domainPill,
      nav: outside?.navPlaceAttr,
      width: outside?.navWidthAttr,
      dockLeft: outside?.dockLeft,
      strip: outside?.titlebarHeight,
      radius: outside?.radiusLg,
      shadow: outside?.shadowAttr,
      motion: outside?.motion,
      type: outside?.typeScaleAttr,
      density: outside?.density,
      backdrop: outside?.backdropAttr,
    }),
  );

  const keptOutside = await evaluate(
    `(() => { const b = document.querySelector('[data-testid="theme-keep"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const outsideKept = await waitFor(
    (s) => keptOutside === true && !s.preview && s.kept === "outside-theme.json",
    15_000,
  );
  check(
    "outside-theme-keeps-across-a-reload",
    keptOutside === true && outsideKept?.kept === "outside-theme.json",
    JSON.stringify({ kept: outsideKept?.kept }),
  );

  // The gate's second half: the app restarts wearing it, with the operator's
  // way out still painted — window controls, Settings entry, preview bar.
  win.webContents.reload();
  await new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
  const afterOutsideRestart = await waitFor(
    (s) =>
      s.shell &&
      s.kept === "outside-theme.json" &&
      s.wingFloating &&
      s.domainBottom &&
      s.navPlaceAttr === "floating" &&
      s.dockLeft &&
      s.titlebarHeight === 40 &&
      s.radiusLg === "8px" &&
      s.motion === "none" &&
      s.density === "compact" &&
      s.backdropAttr === "grid" &&
      s.settingsEntry &&
      s.stripPainted,
    25_000,
  );
  check(
    "outside-theme-survives-a-restart-with-its-way-out",
    afterOutsideRestart?.kept === "outside-theme.json" &&
      afterOutsideRestart.wingFloating === true &&
      afterOutsideRestart.navPlaceAttr === "floating" &&
      afterOutsideRestart.dockLeft === true &&
      afterOutsideRestart.titlebarHeight === 40 &&
      afterOutsideRestart.radiusLg === "8px" &&
      afterOutsideRestart.motion === "none" &&
      afterOutsideRestart.density === "compact" &&
      afterOutsideRestart.backdropAttr === "grid" &&
      afterOutsideRestart.settingsEntry === true &&
      afterOutsideRestart.stripPainted === true,
    JSON.stringify({
      kept: afterOutsideRestart?.kept,
      wing: afterOutsideRestart?.wingFloating,
      dockLeft: afterOutsideRestart?.dockLeft,
      strip: afterOutsideRestart?.titlebarHeight,
      radius: afterOutsideRestart?.radiusLg,
      motion: afterOutsideRestart?.motion,
      density: afterOutsideRestart?.density,
      settings: afterOutsideRestart?.settingsEntry,
      strip: afterOutsideRestart?.stripPainted,
    }),
  );

  const outsideShot = await win.webContents.capturePage();
  fs.writeFileSync(OUTSIDE_PNG, outsideShot.toPNG());

  // ── 12c: R4.1 — the walking skeleton, worn and taken back ───────────────
  // R4.0 proved the validator; this slice proves the drawing. A composition
  // rides the theme file, so it enters the same ten-second preview as any other
  // theme: the page masthead and the rail foot wear the widgets, the operator
  // hides and restores them from Settings, Keep makes them durable, a newer
  // preview replaces them and Revert hands them back.
  const COMPOSITION_THEME = {
    name: "composition-lab",
    label: "Composition Lab",
    description:
      "R4.1 walking skeleton — a badge and a meter in the page masthead, a count on the rail's foot.",
    composition: {
      layout: "stack",
      widgets: [
        {
          type: "badge",
          region: "page.masthead",
          data: "weekly.files",
          label: "Weekly",
          tone: "accent",
        },
        {
          type: "meter",
          region: "page.masthead",
          data: "weekly.files",
          label: "This week",
          max: 5,
          tone: "success",
        },
        {
          type: "badge",
          region: "rail.footer",
          data: "decisions.count",
          label: "Decisions",
          tone: "muted",
        },
      ],
    },
  };
  fs.writeFileSync(
    path.join(themesDir, "composition-lab.json"),
    `${JSON.stringify(COMPOSITION_THEME, null, 2)}\n`,
  );
  const compositionWorn = await waitFor(
    (s) =>
      s.preview &&
      (s.previewText ?? "").includes("composition-lab.json") &&
      s.compositionMasthead?.widgets === 2 &&
      s.compositionRailFooter === 1 &&
      s.settingsEntry &&
      s.stripPainted,
    25_000,
  );
  check(
    "a-theme-composition-paints-its-widgets",
    compositionWorn?.preview === true &&
      (compositionWorn.previewText ?? "").includes("composition-lab.json") &&
      compositionWorn.compositionMasthead?.widgets === 2 &&
      compositionWorn.compositionMasthead.labels[0] === "Weekly" &&
      compositionWorn.compositionMasthead.labels[1] === "This week" &&
      compositionWorn.compositionMasthead.values[0] === "2" &&
      compositionWorn.compositionMasthead.values[1] === "2/5" &&
      compositionWorn.compositionMeterNow === "2" &&
      compositionWorn.compositionMeterMax === "5" &&
      compositionWorn.compositionRailFooter === 1 &&
      compositionWorn.settingsEntry === true &&
      compositionWorn.stripPainted === true,
    JSON.stringify({
      preview: compositionWorn?.preview,
      previewText: (compositionWorn?.previewText ?? "").slice(0, 120),
      masthead: compositionWorn?.compositionMasthead,
      rail: compositionWorn?.compositionRailFooter,
      meter: [compositionWorn?.compositionMeterNow, compositionWorn?.compositionMeterMax],
      settings: compositionWorn?.settingsEntry,
      strip: compositionWorn?.stripPainted,
    }),
  );

  await evaluate(
    `(() => { location.hash = "#/home"; return location.hash; })()`,
  );
  await waitFor((s) => s.compositionMasthead?.widgets === 2, 15_000);
  await sleep(300);
  const compositionShot = await win.webContents.capturePage();
  fs.writeFileSync(COMPOSITION_PNG, compositionShot.toPNG());

  // Keep makes the widgets durable before the longer operator walk below, so
  // the ten-second countdown cannot decide the rest of the section.
    const keptComposition = await evaluate(
    `(() => { const b = document.querySelector('[data-testid="theme-keep"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const compositionKept = await waitFor(
    (s) =>
      keptComposition === true &&
      !s.preview &&
      s.kept === "composition-lab.json" &&
      s.compositionMasthead?.widgets === 2,
    15_000,
  );

  // The operator's one axis: hide the widgets, then hand them back with Reset.
  const openedCompositionSettings = await evaluate(`(() => {
    const trigger = document.querySelector(".settings-menu__trigger");
    if (!trigger) return false;
    trigger.click();
    return true;
  })()`);
  let compositionPanel = null;
  for (let i = 0; i < 100; i += 1) {
    compositionPanel = await evaluate(`(() => {
      const panel = document.querySelector('[data-testid="theme-composition"]');
      if (!panel) return null;
      return { text: panel.textContent.slice(0, 220) };
    })()`);
    if (compositionPanel) break;
    await evaluate(`(() => { const b = [...document.querySelectorAll(".settings-nav-item")].find((el) => el.textContent.includes("Appearance")); if (b) b.click(); return true; })()`);
    await sleep(150);
  }
  const compositionSettingsShot = await win.webContents.capturePage();
  fs.writeFileSync(COMPOSITION_SETTINGS_PNG, compositionSettingsShot.toPNG());

  const hidComposition = await evaluate(`(() => {
    const b = document.querySelector('[data-testid="composition-toggle"]');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  const compositionHidden = await waitFor(
    (s) =>
      hidComposition === true &&
      s.compositionMasthead === null &&
      s.compositionRailFooter === null &&
      s.compositionYours === true,
    15_000,
  );
  const resetComposition = await evaluate(`(() => {
    const b = document.querySelector('[data-testid="composition-reset"]');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  const compositionRestored = await waitFor(
    (s) =>
      resetComposition === true &&
      s.compositionMasthead?.widgets === 2 &&
      s.compositionRailFooter === 1 &&
      s.compositionYours === false,
    15_000,
  );
  check(
    "operator-hides-and-resets-a-theme-composition",
    openedCompositionSettings === true &&
      compositionPanel !== null &&
      compositionHidden?.compositionMasthead === null &&
      compositionHidden.compositionYours === true &&
      compositionRestored?.compositionMasthead?.widgets === 2 &&
      compositionRestored.compositionYours === false,
    JSON.stringify({
      panel: compositionPanel !== null,
      hidden: compositionHidden?.compositionMasthead,
      yours: compositionHidden?.compositionYours,
      restored: compositionRestored?.compositionMasthead,
    }),
  );
  // Leave Settings the way the operator does: pick a page in the rail. The
  // sheet is a route, so the trigger only ever takes you *into* it.
  await evaluate(
    `(() => { location.hash = "#/home"; return location.hash; })()`,
  );
  await waitFor((s) => s.compositionMasthead?.widgets === 2, 10_000);
  await sleep(200);

  fs.writeFileSync(
    path.join(themesDir, "composition-quiet.json"),
    `${JSON.stringify(
      {
        name: "composition-quiet",
        label: "Composition Quiet",
        composition: {
          layout: "stack",
          widgets: [
            {
              type: "badge",
              region: "rail.footer",
              data: "agents.count",
              label: "Agents",
              tone: "muted",
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
  );
  const quietPreview = await waitFor(
    (s) =>
      s.preview &&
      (s.previewText ?? "").includes("composition-quiet.json") &&
      s.compositionMasthead === null &&
      s.compositionRailFooter === 1,
    20_000,
  );
  await evaluate(
    `(() => { const b = document.querySelector('[data-testid="theme-revert"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const compositionBack = await waitFor(
    (s) =>
      !s.preview &&
      s.kept === "composition-lab.json" &&
      s.compositionMasthead?.widgets === 2 &&
      s.compositionRailFooter === 1,
    15_000,
  );
  check(
    "a-kept-composition-survives-preview-and-revert",
    compositionKept?.kept === "composition-lab.json" &&
      compositionKept.compositionMasthead?.widgets === 2 &&
      quietPreview?.compositionMasthead === null &&
      quietPreview.compositionRailFooter === 1 &&
      compositionBack?.kept === "composition-lab.json" &&
      compositionBack.compositionMasthead?.widgets === 2,
    JSON.stringify({
      kept: compositionKept?.kept,
      quiet: quietPreview?.compositionMasthead,
      back: compositionBack?.compositionMasthead,
    }),
  );

  // ── 12d: R4.2 — grid and polar, drawn and reached by keyboard ────────────
  // The layout is theme data; everything that makes it usable is ours. Polar
  // places its widgets on a deterministic ring (top first, clockwise) and each
  // is a plain link in DOM order, so the keyboard reaches the whole ring with
  // Tab and a screen reader hears the nav by name. Reduced motion leaves the
  // ring still because nothing here animates. Grid is a real CSS grid whose
  // column count the theme names.
  const ORBIT_THEME = {
    name: "composition-orbit",
    label: "Composition Orbit",
    composition: {
      layout: "polar",
      radius: "default",
      widgets: [
        {
          type: "quickAction",
          region: "page.orbit",
          route: "home",
          label: "Home",
          tone: "accent",
        },
        {
          type: "quickAction",
          region: "page.orbit",
          route: "goals",
          label: "Goals",
          tone: "accent",
        },
        {
          type: "quickAction",
          region: "page.orbit",
          route: "projects",
          label: "Projects",
          tone: "muted",
        },
        {
          type: "quickAction",
          region: "page.orbit",
          route: "notes",
          label: "Notes",
          tone: "muted",
        },
      ],
    },
  };
  fs.writeFileSync(
    path.join(themesDir, "composition-orbit.json"),
    `${JSON.stringify(ORBIT_THEME, null, 2)}\n`,
  );
  const orbitWorn = await waitFor(
    (s) =>
      s.preview &&
      (s.previewText ?? "").includes("composition-orbit.json") &&
      s.compositionOrbit?.links?.length === 4 &&
      s.compositionOrbit.layout === "polar",
    25_000,
  );
  const ringExpectedAngles = [-90, 0, 90, 180];
  const ringAnglesOk = (orbitWorn?.compositionOrbit?.links ?? []).every(
    (link, index) =>
      Math.abs(link.angle - ringExpectedAngles[index]) <= 40 ||
      Math.abs(link.angle - ringExpectedAngles[index]) >= 320,
  );
  check(
    "a-polar-composition-draws-a-deterministic-keyboard-ring",
    orbitWorn?.compositionOrbit?.tag === "NAV" &&
      orbitWorn.compositionOrbit.ariaLabel === "Quick actions" &&
      orbitWorn.compositionOrbit.links.length === 4 &&
      orbitWorn.compositionOrbit.links.map((l) => l.route).join(",") ===
        "home,goals,projects,notes" &&
      orbitWorn.compositionOrbit.links.map((l) => l.href).join(",") ===
        "#/home,#/goals,#/projects,#/notes" &&
      orbitWorn.compositionOrbit.links.every(
        (l) => l.x > 0 && l.x < 1280 && l.y > 0 && l.y < 800,
      ) &&
      new Set(orbitWorn.compositionOrbit.links.map((l) => l.x)).size >= 2 &&
      new Set(orbitWorn.compositionOrbit.links.map((l) => l.y)).size >= 2 &&
      ringAnglesOk,
    JSON.stringify(orbitWorn?.compositionOrbit),
  );

  // Keyboard: focus the first action, then Tab three times. If the ring is
  // reachable, the active element stays inside it and visits every route in
  // the order the ring draws them.
  await evaluate(
    `(() => { location.hash = "#/home"; return location.hash; })()`,
  );
  await waitFor(
    (s) => s.compositionOrbit?.links?.length === 4 && s.preview === true,
    10_000,
  );
  await sleep(250);
  win.webContents.focus();
  const focusFirstAction = await evaluate(`(() => {
    const link = document.querySelector('[data-testid="composition-quick-action"]');
    if (!link) return { found: false };
    link.focus({ preventScroll: true });
    return {
      found: true,
      same: document.activeElement === link,
      activeTag: document.activeElement ? document.activeElement.tagName : null,
      activeRoute: document.activeElement
        ? document.activeElement.getAttribute("data-widget-route")
        : null,
      hasFocus: document.hasFocus(),
      tabIndex: link.tabIndex,
    };
  })()`);
  const tabbedRoutes = [];
  for (let step = 0; step < 3; step += 1) {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
    await sleep(150);
    const route = await evaluate(
      `(() => { const el = document.activeElement; return el ? el.getAttribute("data-widget-route") : null; })()`,
    );
    tabbedRoutes.push(route);
  }
  check(
    "the-orbital-ring-is-keyboard-complete",
    focusFirstAction?.same === true &&
      tabbedRoutes.join(",") === "goals,projects,notes",
    JSON.stringify({ focusFirstAction, tabbedRoutes }),
  );

  // Reduced motion: the ring has no animation to stop, and the app honours the
  // preference the moment the OS/frame says it is on.
  let reducedAttached = false;
  try {
    win.webContents.debugger.attach("1.3");
    reducedAttached = true;
    await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
  } catch (error) {
    console.error(`reduced-motion emulation failed: ${error.message}`);
  }
  const reducedSample = await waitFor((s) => s.reducedMotion === true, 8_000);
  const stillAnimations = reducedSample?.compositionAnimations ?? null;
  if (reducedAttached) {
    try {
      await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
        features: [],
      });
      win.webContents.debugger.detach();
    } catch (error) {
      console.error(`reduced-motion detach failed: ${error.message}`);
    }
  }
  check(
    "the-ring-is-still-under-reduced-motion",
    reducedSample?.reducedMotion === true &&
      stillAnimations?.animationName === "none" &&
      stillAnimations?.animationDuration === "0s",
    JSON.stringify({ reducedMotion: reducedSample?.reducedMotion, stillAnimations }),
  );

  await evaluate(
    `(() => { if (document.activeElement) document.activeElement.blur(); location.hash = "#/home"; return true; })()`,
  );
  await waitFor(
    (s) => s.compositionOrbit?.links?.length === 4 && s.preview === true,
    10_000,
  );
  await sleep(250);
  const orbitShot = await win.webContents.capturePage();
  fs.writeFileSync(COMPOSITION_ORBIT_PNG, orbitShot.toPNG());

  // Grid: the theme names the column count; the shell draws a real grid.
  const GRID_THEME = {
    name: "composition-grid",
    label: "Composition Grid",
    composition: {
      layout: "grid",
      columns: 2,
      widgets: [
        { type: "badge", region: "page.masthead", data: "goals.count", label: "Goals", tone: "accent" },
        { type: "badge", region: "page.masthead", data: "decisions.count", label: "Decisions", tone: "muted" },
        { type: "badge", region: "page.masthead", data: "weekly.files", label: "Weekly", tone: "success" },
        { type: "badge", region: "page.masthead", data: "agents.count", label: "Agents", tone: "warning" },
      ],
    },
  };
  fs.writeFileSync(
    path.join(themesDir, "composition-grid.json"),
    `${JSON.stringify(GRID_THEME, null, 2)}\n`,
  );
  const gridWorn = await waitFor(
    (s) =>
      s.preview &&
      (s.previewText ?? "").includes("composition-grid.json") &&
      s.compositionGrid?.boxes?.length === 4,
    20_000,
  );
  const gridBoxes = gridWorn?.compositionGrid?.boxes ?? [];
  check(
    "a-grid-composition-draws-the-columns-the-theme-names",
    gridWorn?.compositionGrid?.layout === "grid" &&
      gridWorn?.compositionGrid?.columns === 2 &&
      gridBoxes.length === 4 &&
      new Set(gridBoxes.map((b) => b.x)).size === 2 &&
      new Set(gridBoxes.map((b) => b.y)).size === 2,
    JSON.stringify(gridWorn?.compositionGrid ?? null),
  );
  const gridShot = await win.webContents.capturePage();
  fs.writeFileSync(COMPOSITION_GRID_PNG, gridShot.toPNG());

  // Revert hands the kept composition back — the layouts add no new state.
  await evaluate(
    `(() => { const b = document.querySelector('[data-testid="theme-revert"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const layoutsReverted = await waitFor(
    (s) =>
      !s.preview &&
      s.kept === "composition-lab.json" &&
      s.compositionMasthead?.widgets === 2 &&
      s.compositionOrbit === null,
    15_000,
  );
  check(
    "grid-and-polar-revert-to-the-kept-composition",
    layoutsReverted?.kept === "composition-lab.json" &&
      layoutsReverted.compositionMasthead?.widgets === 2 &&
      layoutsReverted.compositionOrbit === null,
    JSON.stringify({
      kept: layoutsReverted?.kept,
      masthead: layoutsReverted?.compositionMasthead,
      orbit: layoutsReverted?.compositionOrbit,
    }),
  );

  // ── 12e: R4.3 — the rest of the vocabulary, all of it bound and bounded ──
  // Five more widgets join badge/meter/quickAction. Each reads a closed source
  // the shell already holds; none can be an image, a URL, a form control or a
  // script, and the whole eight-widget surface has a node budget so a theme
  // cannot turn the page into a painting.
  const VOCABULARY_THEME = {
    name: "composition-vocabulary",
    label: "Composition Vocabulary",
    composition: {
      layout: "stack",
      widgets: [
        { type: "avatar", region: "page.masthead", data: "vault.name", label: "Operator", tone: "accent" },
        { type: "list", region: "page.masthead", data: "domains.names", label: "Areas", limit: 3, tone: "muted" },
        { type: "clock", region: "page.masthead", label: "Clock", format: "24h", tone: "muted" },
        { type: "calendar", region: "page.footer", label: "Week", tone: "accent" },
        { type: "brief", region: "page.footer", data: "weekly.files", label: "Reviews", caption: "Files in the vault", tone: "success" },
        { type: "meter", region: "page.footer", data: "weekly.files", label: "This week", max: 5, tone: "success" },
        { type: "badge", region: "page.footer", data: "goals.count", label: "Goals", tone: "warning" },
        { type: "quickAction", region: "page.masthead", route: "home", label: "Home", tone: "accent" },
      ],
    },
  };
  fs.writeFileSync(
    path.join(themesDir, "composition-vocabulary.json"),
    `${JSON.stringify(VOCABULARY_THEME, null, 2)}\n`,
  );
  const vocabularyWorn = await waitFor(
    (s) =>
      (s.previewText ?? "").includes("composition-vocabulary.json") &&
      s.compositionVocabulary?.types?.length === 8,
    20_000,
  );
  const vocabulary = vocabularyWorn?.compositionVocabulary ?? null;
  check(
    "the-bound-vocabulary-draws-all-eight-widgets",
    vocabulary !== null &&
      vocabulary.types.join(",") ===
        "avatar,badge,brief,calendar,clock,list,meter,quickAction" &&
      vocabulary.avatar?.initials === "TC" &&
      (vocabulary.avatar?.aria ?? "").includes("Theme Chrome") &&
      vocabulary.list?.items.length === 3 &&
      vocabulary.list.items.includes("Life") &&
      vocabulary.list.aria === "Areas" &&
      /^\d{1,2}:\d{2}$/.test(vocabulary.clock?.formatted ?? "") &&
      (vocabulary.clock?.aria ?? "").startsWith("Clock: ") &&
      Boolean(vocabulary.clock?.dateTime) &&
      vocabulary.calendar?.days.length === 7 &&
      vocabulary.calendar.today === 1 &&
      (vocabulary.calendar.aria ?? "").startsWith("Week,") &&
      vocabulary.brief?.value === "2" &&
      vocabulary.brief.caption === "Files in the vault",
    JSON.stringify(vocabulary),
  );
  check(
    "the-vocabulary-is-a-spoof-proof-surface-with-a-node-budget",
    vocabulary !== null &&
      Object.values(vocabulary.forbidden).every((count) => count === 0) &&
      vocabulary.anchors.length === 1 &&
      vocabulary.anchors[0] === "#/home" &&
      vocabulary.externalAnchors.length === 0 &&
      vocabulary.urlBackedWidgets === 0 &&
      vocabulary.nodes > 0 &&
      vocabulary.nodes <= 120,
    JSON.stringify({
      forbidden: vocabulary?.forbidden,
      anchors: vocabulary?.anchors,
      external: vocabulary?.externalAnchors,
      urlBacked: vocabulary?.urlBackedWidgets,
      nodes: vocabulary?.nodes,
      budget: 120,
    }),
  );
  await evaluate(
    `(() => { location.hash = "#/home"; return location.hash; })()`,
  );
  await waitFor((s) => s.compositionVocabulary?.types?.length === 8, 10_000);
  await sleep(300);
  const vocabularyShot = await win.webContents.capturePage();
  fs.writeFileSync(COMPOSITION_VOCABULARY_PNG, vocabularyShot.toPNG());

  await evaluate(
    `(() => { const b = document.querySelector('[data-testid="theme-revert"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const vocabularyReverted = await waitFor(
    (s) =>
      !s.preview &&
      s.kept === "composition-lab.json" &&
      s.compositionMasthead?.widgets === 2 &&
      !(s.compositionVocabulary?.types ?? []).includes("avatar"),
    15_000,
  );
  check(
    "the-vocabulary-reverts-to-the-kept-composition",
    vocabularyReverted?.kept === "composition-lab.json" &&
      vocabularyReverted.compositionMasthead?.widgets === 2 &&
      !(vocabularyReverted.compositionVocabulary?.types ?? []).includes("avatar"),
    JSON.stringify({
      kept: vocabularyReverted?.kept,
      masthead: vocabularyReverted?.compositionMasthead,
      vocabulary: vocabularyReverted?.compositionVocabulary?.types,
    }),
  );

  // ── 12f: R4.4 — Helios: the showcase, the authored file and the gate ─────
  // The bundled showcase now includes Helios: a warm solar-orbit HUD whose
  // composition is a polar ring of quick actions. The gate then authors its own
  // Helios through the companion door, wears it, hides and restores the ring
  // from Settings, keeps it, restarts the window and finds it still worn — and
  // proves an undrawable widget is refused at the door, not drawn then blocked.
  let bundledHelios = null;
  try {
    const raw = fs.readFileSync(
      path.join(themesDir, "showcase-helios.json"),
      "utf8",
    );
    const theme = JSON.parse(raw);
    bundledHelios = {
      label: theme.label,
      layout: theme.composition?.layout ?? null,
      widgets: theme.composition?.widgets?.length ?? 0,
      preset: theme.scene?.background?.preset ?? null,
      canvas: theme.scene?.frames?.canvas ?? null,
    };
  } catch (error) {
    bundledHelios = { error: String(error) };
  }
  check(
    "the-helios-showcase-ships-in-a-fresh-profile",
    bundledHelios?.label === "Helios" &&
      bundledHelios.layout === "polar" &&
      bundledHelios.widgets === 6 &&
      bundledHelios.preset === "orbit" &&
      bundledHelios.canvas === "halo",
    JSON.stringify(bundledHelios),
  );

  const heliosSource = JSON.parse(
    fs.readFileSync(path.join(themesDir, "showcase-helios.json"), "utf8"),
  );
  const HELIOS_AUTHORED = {
    ...heliosSource,
    name: "helios-authored",
    label: "Helios Authored",
    description:
      "Written through the companion door: the solar HUD, ring and all, without a line of code.",
  };
  const heliosWritten = await gateCall("write_theme", {
    theme: HELIOS_AUTHORED,
  });
  const heliosWorn = await waitFor(
    (s) =>
      s.preview &&
      (s.previewText ?? "").includes("helios-authored.json") &&
      s.compositionOrbit?.links?.length === 4 &&
      s.compositionOrbit.layout === "polar",
    25_000,
  );
  check(
    "a-companion-authored-helios-wears-its-ring",
    heliosWritten.json?.written === "helios-authored.json" &&
      heliosWorn?.previewText?.includes("helios-authored.json") === true &&
      heliosWorn.compositionOrbit.links.map((link) => link.route).join(",") ===
        "home,goals,projects,notes" &&
      heliosWorn.compositionOrbit.ariaLabel === "Quick actions",
    JSON.stringify({
      written: heliosWritten.json?.written,
      isError: heliosWritten.isError,
      orbit: heliosWorn?.compositionOrbit,
    }),
  );

  // The operator's escape hatch works on Helios exactly as on any composition:
  // one axis, hide then Reset, and the ring comes back.
  await evaluate(
    `(() => { const t = document.querySelector(".settings-menu__trigger"); if (t) t.click(); return true; })()`,
  );
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const panel = await evaluate(
      `(() => Boolean(document.querySelector('[data-testid="theme-composition"]')))()`,
    );
    if (panel) break;
    await evaluate(
      `(() => { const b = [...document.querySelectorAll(".settings-nav-item")].find((el) => el.textContent.includes("Appearance")); if (b) b.click(); return true; })()`,
    );
    await sleep(150);
  }
  const heliosHiddenByClick = await evaluate(`(() => {
    const b = document.querySelector('[data-testid="composition-toggle"]');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  const heliosHidden = await waitFor(
    (s) =>
      heliosHiddenByClick === true &&
      s.compositionOrbit === null &&
      s.compositionYours === true,
    15_000,
  );
  const heliosResetByClick = await evaluate(`(() => {
    const b = document.querySelector('[data-testid="composition-reset"]');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  const heliosRestored = await waitFor(
    (s) =>
      heliosResetByClick === true &&
      s.compositionOrbit?.links?.length === 4 &&
      s.compositionYours === false,
    15_000,
  );
  check(
    "the-operator-can-hide-and-restore-helios",
    heliosHidden?.compositionOrbit === null &&
      heliosHidden.compositionYours === true &&
      heliosRestored?.compositionOrbit?.links?.length === 4,
    JSON.stringify({
      hidden: heliosHidden?.compositionOrbit,
      restored: heliosRestored?.compositionOrbit?.links?.length,
    }),
  );
  await evaluate(
    `(() => { location.hash = "#/home"; return location.hash; })()`,
  );
  await waitFor((s) => s.compositionOrbit?.links?.length === 4, 10_000);

  // Keep it, restart the window, and the ring is still there: the kept name
  // lives in main, so a reload cannot lose it.
  const heliosKeptByClick = await evaluate(
    `(() => { const b = document.querySelector('[data-testid="theme-keep"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const heliosKept = await waitFor(
    (s) =>
      heliosKeptByClick === true &&
      !s.preview &&
      s.kept === "helios-authored.json" &&
      s.compositionOrbit?.links?.length === 4,
    15_000,
  );
  win.webContents.reload();
  await new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
  const heliosAfterReload = await waitFor(
    (s) =>
      s.shell === true &&
      s.kept === "helios-authored.json" &&
      s.compositionOrbit?.links?.length === 4,
    25_000,
  );
  check(
    "a-kept-helios-survives-a-window-restart",
    heliosKept?.kept === "helios-authored.json" &&
      heliosKept.compositionOrbit?.links?.length === 4 &&
      heliosAfterReload?.kept === "helios-authored.json" &&
      heliosAfterReload.compositionOrbit?.links?.length === 4,
    JSON.stringify({
      kept: heliosKept?.kept,
      beforeReload: heliosKept?.compositionOrbit?.links?.length,
      afterReload: heliosAfterReload?.compositionOrbit?.links?.length,
    }),
  );
  await sleep(400);
  const heliosShot = await win.webContents.capturePage();
  fs.writeFileSync(HELIOS_PNG, heliosShot.toPNG());

  // The door refuses what it cannot draw. A spoofed Helios is not drawn and
  // then blocked; it never becomes a theme at all.
  const heliosSpoof = await gateCall("write_theme", {
    theme: {
      ...heliosSource,
      name: "helios-spoof",
      label: "Helios Spoof",
      composition: {
        layout: "grid",
        widgets: [
          {
            type: "image",
            region: "page.masthead",
            data: "vault.secrets",
            label: "Pwn",
          },
        ],
      },
    },
  });
  const heliosSpoofError = String(
    heliosSpoof.json?.error?.message ??
      heliosSpoof.json?.error ??
      "no error returned",
  );
  // The tool answers refusals as a structured error object (not an MCP
  // isError), so the contract under test is: it names the field, and no file
  // appeared on disk.
  check(
    "helios-refuses-an-undrawable-widget-at-the-door",
    heliosSpoofError.includes("composition.widgets[0].type must be one of") &&
      !fs.existsSync(path.join(themesDir, "helios-spoof.json")),
    JSON.stringify({ isError: heliosSpoof.isError, error: heliosSpoofError }),
  );

  // ── 12g: Customizations — the workshop, on the real page ─────────────────────
  // The rail gains the row; the page must list the profile's files, create a new
  // one inside the app (not by the rig's pen on the folder), edit it, refuse
  // invalid JSON before anything reaches disk, switch it on and off, and remove
  // it. The screenshot is taken while the created file is active.
  const untilTrue = async (expression, timeout = 10_000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if ((await evaluate(expression)) === true) return true;
      await sleep(120);
    }
    return false;
  };
  /**
   * S2: a parseable file now opens the editor on the Fields tab, so the raw
   * JSON ids (`customization-editor-raw` / `-status` / `-save`) only exist once the
   * JSON tab is chosen. Every surviving check that drove the textarea takes
   * this step first; the History section stays visible on both tabs.
   */
  const openJsonTab = async () => {
    const clicked = await evaluate(`(() => {
      const tab = document.querySelector('[data-testid="customization-editor-tab-json"]');
      if (!tab) return false;
      tab.click();
      return true;
    })()`);
    if (!clicked) return false;
    return untilTrue(
      `Boolean(document.querySelector('[data-testid="customization-editor-raw"]'))`,
      10_000,
    );
  };
  await evaluate(`(() => {
    const link = [...document.querySelectorAll(".nav-rail__link")].find((el) =>
      (el.textContent ?? "").includes("Customizations"),
    );
    if (link) link.click();
    else location.hash = "#/customizations";
    return true;
  })()`);
  const customizationsReady = await waitFor(
    (s) => s.customizationsPage === true && (s.customizationsRows ?? 0) >= 6,
    15_000,
  );
  check(
    "the-customizations-page-lists-the-profile-customizations",
    customizationsReady?.customizationsPage === true &&
      (customizationsReady.customizationsRows ?? 0) >= 6 &&
      (customizationsReady.customizationsCountText ?? "").includes("customization"),
    JSON.stringify({
      rows: customizationsReady?.customizationsRows,
      count: customizationsReady?.customizationsCountText,
      hash: customizationsReady?.hash,
    }),
  );

  await evaluate(
    `(() => { const b = document.querySelector('[data-testid="customizations-create"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const panelOpen = await untilTrue(
    `Boolean(document.querySelector('[data-testid="customization-create-panel"]'))`,
  );
  const typedLabel = await evaluate(`(() => {
    const input = document.querySelector('[data-testid="customization-create-label"]');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(input, "Rig Workshop");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await sleep(120);
  await evaluate(
    `(() => { const b = document.querySelector('[data-testid="customization-create-submit"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const createdPreview = await waitFor(
    (s) =>
      (s.previewText ?? "").includes("rig-workshop.json") &&
      (s.customizationsRows ?? 0) >= 7,
    20_000,
  );
  const createdFile = path.join(themesDir, "rig-workshop.json");
  let createdOnDisk = null;
  try {
    createdOnDisk = JSON.parse(fs.readFileSync(createdFile, "utf8"));
  } catch {
    createdOnDisk = null;
  }
  const createdRow = await evaluate(
    `Boolean(document.querySelector('[data-testid="customization-rig-workshop"]'))`,
  );

  // Edit: open the file as text, prove the live verdict refuses bad JSON, then
  // save a real change and find it on disk. The invalid state must disable Save.
  await evaluate(
    `(() => { const b = document.querySelector('[data-testid="customization-rig-workshop"] [data-testid="customization-edit"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const editorOpen = await untilTrue(
    `Boolean(document.querySelector('[data-testid="customization-editor"]'))`,
  );
  // S2: the editor opens on Fields when the file parses; the textarea lives on
  // the JSON tab, so the existing text seam takes that tab first.
  const editorJsonTab = await openJsonTab();
  const validBefore = await untilTrue(
    `(document.querySelector('[data-testid="customization-editor-status"]')?.textContent ?? "").includes("Valid customization")`,
  );
  const setEditorSource = async (text) =>
    evaluate(`(() => {
      const area = document.querySelector('[data-testid="customization-editor-raw"]');
      if (!area) return false;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      ).set;
      setter.call(area, ${JSON.stringify(text)});
      area.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
  await setEditorSource("{ not json");
  const refusedInvalid = await untilTrue(
    `(document.querySelector('[data-testid="customization-editor-status"]')?.textContent ?? "").includes("Not JSON")`,
  );
  const saveDisabled = await evaluate(
    `(() => { const b = document.querySelector('[data-testid="customization-editor-save"]'); return Boolean(b && b.disabled); })()`,
  );
  await setEditorSource(
    createdOnDisk === null
      ? "{}"
      : JSON.stringify({ ...createdOnDisk, label: "Rig Workshop Edited" }, null, 2),
  );
  await untilTrue(
    `(document.querySelector('[data-testid="customization-editor-status"]')?.textContent ?? "").includes("Valid customization — Rig Workshop Edited")`,
  );
  await evaluate(
    `(() => { const b = document.querySelector('[data-testid="customization-editor-save"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const editorClosed = await untilTrue(
    `!document.querySelector('[data-testid="customization-editor"]')`,
  );
  let editedOnDisk = null;
  try {
    editedOnDisk = JSON.parse(fs.readFileSync(createdFile, "utf8"));
  } catch {
    editedOnDisk = null;
  }
  check(
    "a-customization-can-be-created-and-edited-in-the-app",
    panelOpen === true &&
      typedLabel === true &&
      createdRow === true &&
      createdOnDisk?.label === "Rig Workshop" &&
      (createdPreview?.previewText ?? "").includes("rig-workshop.json") &&
      editorOpen === true &&
      editorJsonTab === true &&
      validBefore === true &&
      refusedInvalid === true &&
      saveDisabled === true &&
      editorClosed === true &&
      editedOnDisk?.label === "Rig Workshop Edited",
    JSON.stringify({
      panelOpen,
      createdRow,
      createdLabel: createdOnDisk?.label,
      previewed: (createdPreview?.previewText ?? "").slice(0, 80),
      editorOpen,
      editorJsonTab,
      validBefore,
      refusedInvalid,
      saveDisabled,
      editedLabel: editedOnDisk?.label,
    }),
  );

  // Switch it on: the created file becomes the active customization, the preview
  // bar goes away because the choice is now kept. Then switch it off: the shell
  // returns to its default look.
  await evaluate(
    `(() => { const b = document.querySelector('[data-testid="customization-rig-workshop"] [data-testid="customization-toggle"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const switchedOn = await waitFor(
    (s) =>
      s.kept === "rig-workshop.json" &&
      !s.preview &&
      s.customizationsActive === true,
    20_000,
  );
  const customizationsShot = await win.webContents.capturePage();
  fs.writeFileSync(CUSTOMIZATIONS_PNG, customizationsShot.toPNG());
  await evaluate(
    `(() => { const b = document.querySelector('[data-testid="customization-rig-workshop"] [data-testid="customization-toggle"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const switchedOff = await waitFor(
    (s) => s.kept === null && s.customizationsActive === false,
    20_000,
  );

  // ── 12h: switching a customization off hands the palette back ───────────────
  // The switch is over *the window's look*, and the look includes the colours:
  // a customization may carry a complete palette (the seeded Solar System does),
  // and the document's colour tokens must land back on the default look the
  // moment it goes off — not stay on the departing theme's colours until the
  // operator picks another skin in the titlebar. Read the tokens on the default
  // look (the state the switch above just produced), wear Solar System, and
  // read them again after switching it off.
  const readPalette = `(() => {
    const root = document.documentElement;
    const read = (name) => getComputedStyle(root).getPropertyValue(name).trim();
    return {
      background: read("--background"),
      canvasBase: read("--canvas-base"),
      card: read("--card"),
      accent: read("--accent"),
      foreground: read("--foreground"),
    };
  })()`;
  const paletteOff = await evaluate(readPalette);
  const solarToggle = `(() => {
    const b = document.querySelector('[data-testid="customization-showcase-solar-system"] [data-testid="customization-toggle"]');
    if (!b) return false;
    b.click();
    return true;
  })()`;
  await evaluate(solarToggle);
  const solarWorn = await waitFor(
    (s) =>
      s.kept === "showcase-solar-system.json" &&
      s.customizationsActive === true &&
      ["#0a0e1f", "#070b17"].includes((s.bgVar ?? "").toLowerCase()),
    20_000,
  );
  await sleep(600);
  const solarShot = await win.webContents.capturePage();
  fs.writeFileSync(CUSTOMIZATIONS_ON_PNG, solarShot.toPNG());
  await evaluate(solarToggle);
  const solarOff = await waitFor(
    (s) =>
      s.kept === null &&
      s.customizationsActive === false &&
      (s.bgVar ?? "").toLowerCase() === (paletteOff?.background ?? "").toLowerCase(),
    20_000,
  );
  await sleep(600);
  const paletteBack = await evaluate(readPalette);
  const customizationsOffShot = await win.webContents.capturePage();
  fs.writeFileSync(CUSTOMIZATIONS_OFF_PNG, customizationsOffShot.toPNG());
  const samePalette =
    paletteOff !== null &&
    paletteBack !== null &&
    paletteOff.background === paletteBack.background &&
    paletteOff.canvasBase === paletteBack.canvasBase &&
    paletteOff.card === paletteBack.card &&
    paletteOff.accent === paletteBack.accent &&
    paletteOff.foreground === paletteBack.foreground;
  check(
    "switching-a-customization-off-hands-the-palette-back",
    solarWorn?.kept === "showcase-solar-system.json" &&
      solarWorn?.bgVar?.toLowerCase() !== paletteOff?.background?.toLowerCase() &&
      solarOff?.kept === null &&
      solarOff.customizationsActive === false &&
      samePalette,
    JSON.stringify({
      offBefore: paletteOff,
      worn: { bg: solarWorn?.bgVar, kept: solarWorn?.kept },
      offAfter: paletteBack,
      solarOff: solarOff?.kept,
      samePalette,
    }),
  );

  // Remove: two presses, and the file leaves the profile.
  await evaluate(
    `(() => { const b = document.querySelector('[data-testid="customization-rig-workshop"] [data-testid="customization-remove"]'); if (!b) return false; b.click(); return true; })()`,
  );
  await sleep(200);
  await evaluate(
    `(() => { const b = document.querySelector('[data-testid="customization-rig-workshop"] [data-testid="customization-remove"]'); if (!b) return false; b.click(); return true; })()`,
  );
  const removedRow = await untilTrue(
    `!document.querySelector('[data-testid="customization-rig-workshop"]')`,
    15_000,
  );
  check(
    "a-customization-can-be-switched-on-off-and-removed",
    switchedOn?.kept === "rig-workshop.json" &&
      switchedOn.customizationsActive === true &&
      switchedOff?.kept === null &&
      switchedOff.customizationsActive === false &&
      removedRow === true &&
      !fs.existsSync(createdFile),
    JSON.stringify({
      on: switchedOn?.kept,
      onActive: switchedOn?.customizationsActive,
      off: switchedOff?.kept,
      offActive: switchedOff?.customizationsActive,
      removedRow,
      fileGone: !fs.existsSync(createdFile),
    }),
  );

  // ── 12i: Trust — history kept/restored/capped; import validated and copied ─
  // A save now snapshots the bytes it replaces, outside `themes/`, and any save
  // can be put back; a file can also arrive through the import door, validated
  // and copied under its own slug, never overwriting and never auto-kept. The
  // import fixtures are queued into the E2E seam before boot (see
  // `themeImportSources` in the world setup); the saves go through the shipped
  // editor, so the page's own seam is what is judged, not a second harness.
  const trustFile = "rig-trust.json";
  const trustPath = path.join(themesDir, trustFile);
  const trustTheme = (label) => ({
    name: "rig-trust",
    label,
    description:
      "History probe: the editor saves this file with distinct labels and restores a version.",
    chrome: { wingSwitcher: { place: "titlebar-left", variant: "labels" } },
  });
  const readLabel = (full) => {
    try {
      const parsed = JSON.parse(fs.readFileSync(full, "utf8"));
      return typeof parsed.label === "string" ? parsed.label : null;
    } catch {
      return null;
    }
  };
  const untilLabel = async (full, label, timeout = 10_000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      if (readLabel(full) === label) return true;
      await sleep(100);
    }
    return readLabel(full) === label;
  };
  const openTrustEditor = async () => {
    const clicked = await evaluate(`(() => {
      const b = document.querySelector('[data-testid="customization-rig-trust"] [data-testid="customization-edit"]');
      if (!b) return false;
      b.click();
      return true;
    })()`);
    if (!clicked) return false;
    const open = await untilTrue(
      `Boolean(document.querySelector('[data-testid="customization-editor"]'))`,
      10_000,
    );
    if (!open) return false;
    // S2: the editor opens on Fields; the saves below drive the raw textarea,
    // which lives on the JSON tab. History stays visible on both tabs.
    return openJsonTab();
  };
  const setTrustRaw = async (text) =>
    evaluate(`(() => {
      const area = document.querySelector('[data-testid="customization-editor-raw"]');
      if (!area) return false;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      ).set;
      setter.call(area, ${JSON.stringify(text)});
      area.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
  const saveTrustEditor = async (label) => {
    const ready = await untilTrue(
      `(() => {
        const status = document.querySelector('[data-testid="customization-editor-status"]')?.textContent ?? "";
        const save = document.querySelector('[data-testid="customization-editor-save"]');
        return status.includes(${JSON.stringify(label)}) && Boolean(save && !save.disabled);
      })()`,
      10_000,
    );
    if (!ready) return false;
    await evaluate(`(() => {
      const b = document.querySelector('[data-testid="customization-editor-save"]');
      if (!b || b.disabled) return false;
      b.click();
      return true;
    })()`);
    return untilTrue(
      `!document.querySelector('[data-testid="customization-editor"]')`,
      10_000,
    );
  };

  fs.writeFileSync(
    trustPath,
    `${JSON.stringify(trustTheme("Trust Zero"), null, 2)}\n`,
  );
  const trustRow = await untilTrue(
    `Boolean(document.querySelector('[data-testid="customization-rig-trust"]'))`,
    15_000,
  );
  const openedFirst = await openTrustEditor();
  const firstEmpty = openedFirst
    ? await waitFor((s) => s.historyEmpty === true, 10_000)
    : null;
  let savesOk = openedFirst;
  for (const label of ["Trust One", "Trust Two", "Trust Three"]) {
    if (!savesOk) break;
    await setTrustRaw(`${JSON.stringify(trustTheme(label), null, 2)}\n`);
    if (!(await saveTrustEditor(label))) {
      savesOk = false;
      break;
    }
    // Every save closes the editor; the next pass reopens it, and the third
    // save stays closed so the final open is the one that reads history.
    if (label !== "Trust Three" && !(await openTrustEditor())) {
      savesOk = false;
      break;
    }
  }
  const reopenedForHistory = savesOk ? await openTrustEditor() : false;
  const diskAfterThree = await untilLabel(trustPath, "Trust Three");
  const historyBefore = reopenedForHistory
    ? await waitFor(
        (s) => Array.isArray(s.historyRows) && s.historyRows.length >= 3,
        15_000,
      )
    : null;
  const rowsBefore = historyBefore?.historyRows ?? [];
  const rowText = (row) => row?.text ?? "";
  const historyLabelsMatch =
    rowsBefore.length === 3 &&
    rowsBefore[0].label === "Trust Two" &&
    rowsBefore[1].label === "Trust One" &&
    rowsBefore[2].label === "Trust Zero" &&
    rowText(rowsBefore[0]).includes("Trust Two") &&
    rowText(rowsBefore[1]).includes("Trust One") &&
    rowText(rowsBefore[2]).includes("Trust Zero");
  const historyRowShape =
    rowsBefore.length === 3 &&
    rowsBefore.every(
      (row) =>
        typeof row.id === "string" &&
        row.id.length > 0 &&
        row.restore === true &&
        /\d+\s*B/.test(rowText(row)) &&
        /(just now|ago|\d{4})/.test(rowText(row)),
    );

  // Put the OLDEST version back. It becomes the previewed look, so the bar has
  // to name this file, and the bytes it replaced become a new version.
  const restoreClicked = reopenedForHistory
    ? await evaluate(`(() => {
        const rows = [...document.querySelectorAll('[data-testid="customization-history-row"]')];
        if (rows.length === 0) return false;
        const last = rows[rows.length - 1];
        const b = last.querySelector('[data-testid="customization-history-restore"]');
        if (!b) return false;
        b.click();
        return true;
      })()`)
    : false;
  const diskAfterRestore = restoreClicked
    ? await untilLabel(trustPath, "Trust Zero")
    : false;
  const restoredUi = restoreClicked
    ? await waitFor(
        (s) =>
          (s.previewText ?? "").includes(trustFile) &&
          Array.isArray(s.historyRows) &&
          s.historyRows.length >= 4,
        15_000,
      )
    : null;
  const restoredRows = restoredUi?.historyRows ?? [];
  const rawAfterRestore = restoreClicked
    ? await untilTrue(
        `(document.querySelector('[data-testid="customization-editor-raw"]')?.value ?? "").includes("Trust Zero")`,
        10_000,
      )
    : false;
  const themeList = await evaluate("window.lifequest.themesList()");
  const listedNames = themeList?.ok
    ? themeList.value.map((entry) => entry.file)
    : [];
  // The artifact claims "the editor with the History list open after a
  // restore", so put that section in the middle of the 1280x800 frame.
  await evaluate(`(() => {
    const section = document.querySelector('[data-testid="customization-history"]');
    if (section) section.scrollIntoView({ block: "center" });
    return true;
  })()`);
  await sleep(500);
  const trustShot = await win.webContents.capturePage();
  fs.writeFileSync(TRUST_PNG, trustShot.toPNG());
  check(
    "history-is-kept-and-a-version-can-be-restored",
    trustRow === true &&
      firstEmpty?.historyEmpty === true &&
      savesOk === true &&
      diskAfterThree === true &&
      historyLabelsMatch &&
      historyRowShape &&
      restoreClicked === true &&
      diskAfterRestore === true &&
      restoredUi !== null &&
      (restoredUi?.previewText ?? "").includes(trustFile) &&
      restoredRows.length >= 4 &&
      rowText(restoredRows[0]).includes("Trust Three") &&
      rawAfterRestore === true &&
      listedNames.length > 0 &&
      listedNames.every((name) => name.endsWith(".json")),
    JSON.stringify({
      row: trustRow,
      emptyFirst: firstEmpty?.historyEmpty,
      savesOk,
      disk: { afterThree: diskAfterThree, afterRestore: diskAfterRestore },
      rowsBefore: rowsBefore.map(rowText),
      restoreClicked,
      preview: (restoredUi?.previewText ?? "").slice(0, 80),
      rowsAfter: restoredRows.map(rowText),
      rawAfterRestore,
    }),
  );

  // ── 12i.2: eleven more writes prune to the newest ten ────────────────────
  // The cap is a main-side fact, so it is judged through the IPC the page uses;
  // the editor is closed first so a re-render cannot race the answer.
  await click("customization-editor-cancel");
  await untilTrue(
    `!document.querySelector('[data-testid="customization-editor"]')`,
    8_000,
  );
  const retentionWrites = [];
  for (let i = 0; i < 11; i += 1) {
    const raw = `${JSON.stringify(trustTheme(`Retention ${i}`), null, 2)}\n`;
    retentionWrites.push(
      await evaluate(
        `window.lifequest.themeWrite(${JSON.stringify(trustFile)}, ${JSON.stringify(raw)})`,
      ),
    );
    await sleep(5);
  }
  const cappedAnswer = await evaluate(
    `window.lifequest.themeHistory(${JSON.stringify(trustFile)})`,
  );
  const cappedVersions = cappedAnswer?.ok ? cappedAnswer.value.versions : null;
  const cappedShape =
    Array.isArray(cappedVersions) &&
    cappedVersions.every(
      (version) =>
        version &&
        typeof version.id === "string" &&
        typeof version.savedAt === "string" &&
        typeof version.label === "string" &&
        typeof version.bytes === "number",
    );
  const cappedTimes =
    Array.isArray(cappedVersions) &&
    cappedVersions.every(
      (version, index) =>
        index === 0 ||
        new Date(cappedVersions[index - 1].savedAt).getTime() >=
          new Date(version.savedAt).getTime(),
    );
  const cappedLabels =
    Array.isArray(cappedVersions) &&
    cappedVersions.filter((version) => /^Retention \d+$/.test(version.label))
      .length >= 8;
  check(
    "history-retention-caps-at-ten",
    retentionWrites.every((result) => result?.ok === true) &&
      Array.isArray(cappedVersions) &&
      cappedVersions.length === 10 &&
      cappedShape &&
      cappedTimes &&
      cappedLabels,
    JSON.stringify({
      writes: retentionWrites.length,
      writesOk: retentionWrites.filter((result) => result?.ok).length,
      versions: cappedVersions?.length,
      labels: (cappedVersions ?? []).map((version) => version.label),
    }),
  );

  // ── 12i.3: three imports through the seam queue ──────────────────────────
  // The queue was filled before boot: valid, invalid, colliding. The first and
  // the invalid one go through the shipped button (so the page's status and
  // refusal are judged too); the colliding copy is asked over the bridge so the
  // destination name it answers with is checked exactly.
  const keptBeforeAnswer = await evaluate("window.lifequest.themeGetState()");
  const keptBefore = keptBeforeAnswer?.ok
    ? keptBeforeAnswer.value.keptFile
    : null;
  const showcaseNames = ["showcase-solar-system.json", "showcase-helios.json"];
  const showcaseBefore = new Map();
  for (const name of showcaseNames) {
    const full = path.join(themesDir, name);
    if (fs.existsSync(full)) showcaseBefore.set(name, fs.readFileSync(full));
  }
  const listBefore = await evaluate("window.lifequest.themesList()");
  const namesBefore = listBefore?.ok
    ? listBefore.value.map((entry) => entry.file)
    : [];
  const importClicked = await click("customizations-import");
  const importOne = importClicked
    ? await waitFor(
        (s) =>
          (s.importStatus ?? "").includes("import-probe.json") &&
          (s.previewText ?? "").includes("import-probe.json"),
        20_000,
      )
    : null;
  const validImportedPath = path.join(themesDir, "import-probe.json");
  let validImported = null;
  try {
    validImported = JSON.parse(fs.readFileSync(validImportedPath, "utf8"));
  } catch {
    validImported = null;
  }
  const listAfterOne = await evaluate("window.lifequest.themesList()");
  const namesAfterOne = listAfterOne?.ok
    ? listAfterOne.value.map((entry) => entry.file)
    : [];
  const invalidClicked = await click("customizations-import");
  let invalidUi = "";
  if (invalidClicked) {
    const invalidDeadline = Date.now() + 15_000;
    while (Date.now() < invalidDeadline) {
      invalidUi = await evaluate(`(() => {
        const themeError = document.querySelector('[data-testid="theme-error"]')?.textContent ?? "";
        const pageError = document.querySelector('[data-testid="customizations-error"]')?.textContent ?? "";
        return themeError + " " + pageError;
      })()`);
      if (invalidUi.includes("chrome.wingSwitcher.place")) break;
      await sleep(120);
    }
  }
  const listAfterTwo = await evaluate("window.lifequest.themesList()");
  const namesAfterTwo = listAfterTwo?.ok
    ? listAfterTwo.value.map((entry) => entry.file)
    : [];
  const noBadFileAdded =
    !fs.existsSync(path.join(themesDir, "import-probe-bad.json")) &&
    !fs.existsSync(path.join(themesDir, "import-probe-imported.json"));
  const collisionAnswer = await evaluate("window.lifequest.themeImport()");
  const collisionPath = path.join(themesDir, "import-probe-imported.json");
  let collisionImported = null;
  for (let i = 0; i < 100; i += 1) {
    try {
      collisionImported = JSON.parse(fs.readFileSync(collisionPath, "utf8"));
    } catch {
      collisionImported = null;
    }
    if (collisionImported?.label === "Import Probe Again") break;
    await sleep(100);
  }
  const collisionPreview = await waitFor(
    (s) => (s.previewText ?? "").includes("import-probe-imported.json"),
    15_000,
  );
  const listAfterThree = await evaluate("window.lifequest.themesList()");
  const namesAfterThree = listAfterThree?.ok
    ? listAfterThree.value.map((entry) => entry.file)
    : [];
  const keptAfterAnswer = await evaluate("window.lifequest.themeGetState()");
  const keptAfter = keptAfterAnswer?.ok
    ? keptAfterAnswer.value.keptFile
    : "unreadable";
  const importedHistory = await evaluate(
    'window.lifequest.themeHistory("import-probe.json")',
  );
  const showcaseUntouched =
    showcaseBefore.size === showcaseNames.length &&
    showcaseNames.every((name) => {
      const before = showcaseBefore.get(name);
      const full = path.join(themesDir, name);
      return Boolean(
        before && fs.existsSync(full) && fs.readFileSync(full).equals(before),
      );
    });
  check(
    "an-imported-theme-is-validated-and-copied",
    trustRow === true &&
      importClicked === true &&
      (importOne?.importStatus ?? "").includes("import-probe.json") &&
      validImported?.name === "import-probe" &&
      validImported?.label === "Import Probe" &&
      namesAfterOne.includes("import-probe.json") &&
      invalidClicked === true &&
      invalidUi.includes("chrome.wingSwitcher.place") &&
      namesAfterTwo.length === namesAfterOne.length &&
      namesAfterTwo.every((name) => namesAfterOne.includes(name)) &&
      noBadFileAdded &&
      collisionAnswer?.ok === true &&
      collisionAnswer.value?.file === "import-probe-imported.json" &&
      collisionAnswer.value?.label === "Import Probe Again" &&
      collisionImported?.label === "Import Probe Again" &&
      (collisionPreview?.previewText ?? "").includes(
        "import-probe-imported.json",
      ) &&
      namesAfterThree.includes("import-probe-imported.json") &&
      showcaseUntouched &&
      keptAfter === keptBefore &&
      importedHistory?.ok === true &&
      importedHistory.value?.versions?.length === 0,
    JSON.stringify({
      importClicked,
      status: importOne?.importStatus,
      valid: { name: validImported?.name, label: validImported?.label },
      invalidClicked,
      invalidUi: invalidUi.slice(0, 160),
      namesBefore: namesBefore.length,
      namesAfterOne: namesAfterOne.length,
      namesAfterTwo: namesAfterTwo.length,
      addedNothing: namesAfterTwo.length === namesAfterOne.length,
      noBadFileAdded,
      collision: collisionAnswer?.ok
        ? collisionAnswer.value
        : collisionAnswer?.error,
      collisionLabel: collisionImported?.label,
      collisionPreviewed: (collisionPreview?.previewText ?? "").slice(0, 80),
      showcaseUntouched,
      keptBefore,
      keptAfter,
      importedHistory: importedHistory?.ok
        ? importedHistory.value.versions.length
        : importedHistory?.error,
    }),
  );

  // ── 12i.4: history never pollutes the theme list ─────────────────────────
  // History lives outside `themes/`; the list, the watcher and the folder hold
  // only theme files, and the retention cap is visible on disk as ten snapshots.
  const finalListAnswer = await evaluate("window.lifequest.themesList()");
  const finalNames = finalListAnswer?.ok
    ? finalListAnswer.value.map((entry) => entry.file)
    : [];
  const themesEntries = fs.readdirSync(themesDir, { withFileTypes: true });
  const themeFileCount = themesEntries.filter((entry) => entry.isFile()).length;
  const nestedEntries = themesEntries
    .filter((entry) => !entry.isFile())
    .map((entry) => entry.name);
  const historyRoot = path.join(profileDir, "theme-history");
  const historyForTrust = path.join(historyRoot, "rig-trust");
  const historySnapshots = fs.existsSync(historyForTrust)
    ? fs.readdirSync(historyForTrust).filter((name) => name.endsWith(".json"))
    : [];
  const historyOutsideThemes =
    fs.existsSync(historyRoot) &&
    path.resolve(historyRoot) !== path.resolve(themesDir) &&
    !path.resolve(historyRoot).startsWith(`${path.resolve(themesDir)}${path.sep}`);
  check(
    "history-never-appears-in-the-theme-list",
    finalNames.length > 0 &&
      finalNames.every(
        (name) =>
          name.endsWith(".json") &&
          !name.includes("theme-history") &&
          !name.includes("/") &&
          !name.includes("\\") &&
          !name.includes("--"),
      ) &&
      finalNames.length === themeFileCount &&
      nestedEntries.length === 0 &&
      historyOutsideThemes &&
      historySnapshots.length === 10,
    JSON.stringify({
      listed: finalNames.length,
      themeFileCount,
      nestedEntries,
      historyOutsideThemes,
      snapshots: historySnapshots.length,
    }),
  );

  // ── 12j: Studio — the composition is authored visually, as a draft ───────
  // Fields must paint a draft without writing, keeping or previewing; Save must
  // write exactly the draft and preview it like any write; Cancel must be a true
  // undo; and the controls may only offer the closed vocabulary, so the saved
  // file carries no key the theme schema does not own. The target is a profile
  // file the rig writes for this section (not the operator's, not a showcase).
  const studioFile = "rig-studio.json";
  const studioPath = path.join(themesDir, studioFile);
  fs.writeFileSync(
    studioPath,
    `${JSON.stringify(
      { name: "rig-studio", label: "Rig Studio", material: { radius: "soft" } },
      null,
      2,
    )}\n`,
  );
  const studioSeededBytes = fs.readFileSync(studioPath);
  const studioRow = await untilTrue(
    `Boolean(document.querySelector('[data-testid="customization-rig-studio"]'))`,
    15_000,
  );
  const openStudioEditor = async () => {
    const clicked = await evaluate(`(() => {
      const b = document.querySelector('[data-testid="customization-rig-studio"] [data-testid="customization-edit"]');
      if (!b) return false;
      b.click();
      return true;
    })()`);
    if (!clicked) return false;
    const open = await untilTrue(
      `Boolean(document.querySelector('[data-testid="customization-editor"]'))`,
      10_000,
    );
    if (!open) return false;
    // A parseable file opens on Fields; make sure, then wait for the studio.
    // Entering Fields also cancels the watcher's preview of the seed write.
    await evaluate(`(() => {
      const tab = document.querySelector('[data-testid="customization-editor-tab-fields"]');
      if (tab && tab.getAttribute("aria-selected") !== "true") tab.click();
      return true;
    })()`);
    return untilTrue(
      `Boolean(document.querySelector('[data-testid="customization-studio"]'))`,
      10_000,
    );
  };
  const setStudioSelect = async (testId, value) =>
    evaluate(`(() => {
      const select = document.querySelector('[data-testid="${testId}"]');
      if (!select) return false;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        "value",
      ).set;
      setter.call(select, ${JSON.stringify(value)});
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
  const setStudioValue = async (testId, value) =>
    evaluate(`(() => {
      const control = document.querySelector('[data-testid="${testId}"]');
      if (!control) return false;
      const proto =
        control.tagName === "TEXTAREA"
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(control, ${JSON.stringify(value)});
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
  const addStudioWidget = async (type, region, expectedCount) => {
    const typeSet = await setStudioSelect("studio-add-type", type);
    const regionSet = await setStudioSelect("studio-add-region", region);
    const added = await click("studio-add-widget");
    if (!(typeSet === true && regionSet === true && added === true)) {
      return false;
    }
    const state = await waitFor(
      (s) => s.studioWidgetCount === expectedCount,
      10_000,
    );
    return state?.studioWidgetCount === expectedCount;
  };
  const clickStudioChip = async (index) =>
    evaluate(`(() => {
      const chip = document.querySelector('[data-testid="studio-widget-chip"][data-index="${index}"]');
      if (!chip) return false;
      chip.click();
      return true;
    })()`);
  const stableKeys = (value) => {
    if (Array.isArray(value)) return value.map(stableKeys);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, stableKeys(value[key])]),
      );
    }
    return value;
  };

  // ── 12j.1: a draft paints the shell without a write ─────────────────────
  const studioOpened = await openStudioEditor();
  const studioTab = studioOpened
    ? await waitFor(
        (s) => s.editorTab === "fields" && s.preview === false,
        15_000,
      )
    : null;
  const shellWidgetsBefore = await evaluate(
    `document.querySelectorAll('[data-testid="composition-widget"]').length`,
  );
  const diskBeforeDraft = fs.readFileSync(studioPath);
  const badgeAdded = studioOpened
    ? await addStudioWidget("badge", "page.masthead", 1)
    : false;
  const draftState = badgeAdded
    ? await waitFor(
        (s) => s.draftPainted === true && s.studioWidgetCount === 1,
        10_000,
      )
    : null;
  const draftNoPreview = await evaluate(
    `!document.querySelector('[data-testid="theme-preview-bar"]')`,
  );
  const diskAfterDraft = fs.readFileSync(studioPath);
  const draftKeptDisk =
    studioSeededBytes.equals(diskAfterDraft) && diskBeforeDraft.equals(diskAfterDraft);
  check(
    "the-studio-paints-a-draft-before-any-write",
    studioRow === true &&
      studioOpened === true &&
      studioTab?.editorTab === "fields" &&
      shellWidgetsBefore === 0 &&
      badgeAdded === true &&
      draftState?.draftPainted === true &&
      draftState?.studioWidgetCount === 1 &&
      draftNoPreview === true &&
      draftKeptDisk === true,
    JSON.stringify({
      studioRow,
      studioOpened,
      tab: studioTab?.editorTab,
      shellWidgetsBefore,
      badgeAdded,
      draft: {
        painted: draftState?.draftPainted,
        widgets: draftState?.studioWidgetCount,
        summary: draftState?.studioOffers?.summary,
      },
      noPreview: draftNoPreview,
      diskUnchanged: draftKeptDisk,
    }),
  );

  // The artifact: the shipped Fields editor framed from the tab strip down —
  // Fields selected, the five schematic regions with their chips, the live
  // summary and the layout controls — with the draft the studio has just painted
  // in the shell. It is taken in this stack-layout draft state on purpose: the
  // polar draft's 16rem masthead band pushes the summary and controls below a
  // 1280x800 frame, and the claim is the editor, not the layout. Aligning the
  // tab strip to the scroll-port top spends the frame on the claim; a centred
  // crop showed a mid-form sliver instead.
  await evaluate(`(() => {
    const editor = document.querySelector('[data-testid="customization-editor"]');
    const tabs = document.querySelector('[data-testid="customization-editor-tab-fields"]');
    if (!editor || !tabs) return false;
    const scroller = editor.closest(".shell__content");
    if (scroller) {
      const offset =
        tabs.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      scroller.scrollTop += offset - 12;
    } else {
      editor.scrollIntoView({ block: "start" });
    }
    return true;
  })()`);
  await sleep(400);
  const studioShot = await win.webContents.capturePage();
  fs.writeFileSync(STUDIO_PNG, studioShot.toPNG());

  // ── 12j.2: build the composition, save it ───────────────────────────────
  // A quick action in the orbit needs the polar layout; the layout switch is
  // the control that makes the draft valid again, and the label edit is the
  // authored word the saved file must carry.
  const orbitAdded = studioOpened
    ? await addStudioWidget("quickAction", "page.orbit", 2)
    : false;
  const polarClicked = await click("studio-layout-polar");
  const polarReady = polarClicked
    ? await waitFor(
        (s) =>
          s.compositionOrbit?.layout === "polar" && s.studioWidgetCount === 2,
        12_000,
      )
    : null;
  const saveEnabledAfterPolar = await evaluate(
    `(() => { const b = document.querySelector('[data-testid="studio-save"]'); return Boolean(b && !b.disabled); })()`,
  );
  const badgeChipClicked = await clickStudioChip(0);
  const labelTyped = badgeChipClicked
    ? await setStudioValue("studio-widget-label", "Rig Badge One")
    : false;
  const draftLabelPainted = labelTyped
    ? await waitFor(
        (s) => (s.compositionMasthead?.labels ?? []).includes("Rig Badge One"),
        10_000,
      )
    : null;
  // Fields→JSON serialises the draft; capture that text as the draft of record,
  // then return to Fields and let Save write the draft through the same path.
  await click("customization-editor-tab-json");
  const draftRawReady = await untilTrue(
    `(() => {
      const area = document.querySelector('[data-testid="customization-editor-raw"]');
      if (!area) return false;
      try {
        const parsed = JSON.parse(area.value);
        return Boolean(
          parsed &&
            parsed.composition &&
            Array.isArray(parsed.composition.widgets) &&
            parsed.composition.widgets.length === 2,
        );
      } catch {
        return false;
      }
    })()`,
    10_000,
  );
  const draftRaw = draftRawReady
    ? await evaluate(
        `document.querySelector('[data-testid="customization-editor-raw"]')?.value ?? ""`,
      )
    : "";
  let draftTheme = null;
  try {
    draftTheme = JSON.parse(draftRaw);
  } catch {
    draftTheme = null;
  }
  const backToFields = await click("customization-editor-tab-fields");
  const fieldsAgain = backToFields
    ? await untilTrue(
        `Boolean(document.querySelector('[data-testid="customization-studio"]'))`,
        10_000,
      )
    : false;
  const saveReady = fieldsAgain
    ? await untilTrue(
        `(() => { const b = document.querySelector('[data-testid="studio-save"]'); return Boolean(b && !b.disabled); })()`,
        10_000,
      )
    : false;
  const saveClicked = saveReady ? await click("studio-save") : false;
  const savedPreview = saveClicked
    ? await waitFor(
        (s) =>
          !s.editorTab &&
          (s.previewText ?? "").includes(studioFile) &&
          s.compositionOrbit?.layout === "polar" &&
          (s.compositionMasthead?.labels ?? []).includes("Rig Badge One"),
        20_000,
      )
    : null;
  let savedStudio = null;
  for (let i = 0; i < 100; i += 1) {
    try {
      savedStudio = JSON.parse(fs.readFileSync(studioPath, "utf8"));
    } catch {
      savedStudio = null;
    }
    if (savedStudio?.composition?.widgets?.length === 2) break;
    await sleep(100);
  }
  const draftComposition = draftTheme?.composition ?? null;
  const savedComposition = savedStudio?.composition ?? null;
  const compositionEqualsDraft =
    draftComposition !== null &&
    savedComposition !== null &&
    JSON.stringify(stableKeys(draftComposition)) ===
      JSON.stringify(stableKeys(savedComposition));
  const savedWidgets = savedComposition?.widgets ?? [];
  const savedBadge = savedWidgets.find((widget) => widget.type === "badge");
  const savedQuickAction = savedWidgets.find(
    (widget) => widget.type === "quickAction",
  );
  const savedShapeOk =
    savedComposition?.layout === "polar" &&
    savedWidgets.length === 2 &&
    savedBadge?.region === "page.masthead" &&
    savedBadge?.label === "Rig Badge One" &&
    savedQuickAction?.region === "page.orbit";
  check(
    "the-studio-saves-the-composition-it-built",
    studioOpened === true &&
      orbitAdded === true &&
      polarClicked === true &&
      polarReady?.compositionOrbit?.layout === "polar" &&
      saveEnabledAfterPolar === true &&
      badgeChipClicked === true &&
      labelTyped === true &&
      draftLabelPainted !== null &&
      (draftLabelPainted?.compositionMasthead?.labels ?? []).includes(
        "Rig Badge One",
      ) &&
      draftRawReady === true &&
      backToFields === true &&
      fieldsAgain === true &&
      saveReady === true &&
      saveClicked === true &&
      (savedPreview?.previewText ?? "").includes(studioFile) &&
      savedPreview?.compositionOrbit?.layout === "polar" &&
      (savedPreview?.compositionMasthead?.labels ?? []).includes(
        "Rig Badge One",
      ) &&
      compositionEqualsDraft === true &&
      savedShapeOk === true,
    JSON.stringify({
      orbitAdded,
      polarClicked,
      polarLayout: polarReady?.compositionOrbit?.layout,
      saveEnabledAfterPolar,
      labelTyped,
      labelPainted: draftLabelPainted?.compositionMasthead?.labels,
      draftRawReady,
      backToFields,
      fieldsAgain,
      saveReady,
      saveClicked,
      previewed: (savedPreview?.previewText ?? "").slice(0, 80),
      savedPreviewLayout: savedPreview?.compositionOrbit?.layout,
      compositionEqualsDraft,
      draftComposition,
      savedComposition,
      savedShapeOk,
    }),
  );

  // ── 12j.3: Cancel is a true undo ────────────────────────────────────────
  const savedBytes = fs.readFileSync(studioPath);
  const cancelOpened = await openStudioEditor();
  const cancelReady = cancelOpened
    ? await waitFor(
        (s) =>
          s.editorTab === "fields" &&
          s.studioWidgetCount === 2 &&
          s.preview === false,
        15_000,
      )
    : null;
  const badgeChipAgain = await clickStudioChip(0);
  const cancelLabelTyped = badgeChipAgain
    ? await setStudioValue("studio-widget-label", "Rig Badge Cancel")
    : false;
  const cancelDraftPainted = cancelLabelTyped
    ? await waitFor(
        (s) =>
          (s.compositionMasthead?.labels ?? []).includes("Rig Badge Cancel"),
        10_000,
      )
    : null;
  const cancelClicked = await click("studio-cancel");
  const cancelClosed = cancelClicked
    ? await untilTrue(
        `!document.querySelector('[data-testid="customization-editor"]')`,
        10_000,
      )
    : false;
  const diskAfterCancel = fs.readFileSync(studioPath);
  const diskUnchangedOnCancel = savedBytes.equals(diskAfterCancel);
  const backOnKept = cancelClosed
    ? await waitFor(
        (s) =>
          s.draftPainted === false &&
          !(s.compositionMasthead?.labels ?? []).includes("Rig Badge Cancel") &&
          s.preview === false,
        15_000,
      )
    : null;
  const cancelHistory = await evaluate(
    `window.lifequest.themeHistory(${JSON.stringify(studioFile)})`,
  );
  check(
    "cancelling-a-draft-leaves-the-file-and-shell-alone",
    cancelOpened === true &&
      cancelReady?.studioWidgetCount === 2 &&
      badgeChipAgain === true &&
      cancelLabelTyped === true &&
      cancelDraftPainted !== null &&
      (cancelDraftPainted?.compositionMasthead?.labels ?? []).includes(
        "Rig Badge Cancel",
      ) &&
      cancelClicked === true &&
      cancelClosed === true &&
      diskUnchangedOnCancel === true &&
      backOnKept?.draftPainted === false &&
      backOnKept?.kept === null &&
      !(backOnKept?.compositionMasthead?.labels ?? []).includes(
        "Rig Badge Cancel",
      ) &&
      cancelHistory?.ok === true &&
      cancelHistory.value?.versions?.length === 1,
    JSON.stringify({
      cancelOpened,
      widgets: cancelReady?.studioWidgetCount,
      badgeChipAgain,
      labelTyped: cancelLabelTyped,
      draftLabelPainted: cancelDraftPainted?.compositionMasthead?.labels,
      cancelClicked,
      cancelClosed,
      diskUnchanged: diskUnchangedOnCancel,
      afterCancel: {
        painted: backOnKept?.draftPainted,
        kept: backOnKept?.kept,
        labels: backOnKept?.compositionMasthead?.labels,
        preview: backOnKept?.preview,
      },
      historyVersions: cancelHistory?.ok
        ? cancelHistory.value.versions.length
        : cancelHistory?.error,
    }),
  );

  // ── 12j.4: the editor only offers the contract's closed vocabulary ──────
  const contractOpened = await openStudioEditor();
  const contractReady = contractOpened
    ? await waitFor(
        (s) => s.editorTab === "fields" && s.studioWidgetCount === 2,
        15_000,
      )
    : null;
  const fillerTypes = ["meter", "list", "avatar", "calendar", "clock", "brief"];
  let fillerAdded = contractReady?.studioWidgetCount === 2;
  for (let i = 0; i < fillerTypes.length && fillerAdded; i += 1) {
    fillerAdded = await addStudioWidget(fillerTypes[i], "page.footer", 3 + i);
  }
  const offersAtEight = fillerAdded
    ? await waitFor(
        (s) =>
          s.studioWidgetCount === 8 &&
          s.studioOffers !== null &&
          s.studioOffers.addDisabled === true,
        15_000,
      )
    : null;
  const regionNames = [
    "page.masthead",
    "page.footer",
    "page.orbit",
    "rail.top",
    "rail.footer",
  ];
  const regionSetOk =
    JSON.stringify([...(offersAtEight?.studioOffers?.regions ?? [])].sort()) ===
    JSON.stringify([...regionNames].sort());
  const regionIdsOk =
    JSON.stringify([...(offersAtEight?.studioOffers?.regionIds ?? [])].sort()) ===
    JSON.stringify(
      regionNames.map((region) => `studio-region-${region}`).sort(),
    );
  const widgetTypes = [
    "badge",
    "meter",
    "quickAction",
    "avatar",
    "list",
    "clock",
    "calendar",
    "brief",
  ];
  const typeSetOk =
    JSON.stringify([...(offersAtEight?.studioOffers?.types ?? [])].sort()) ===
    JSON.stringify([...widgetTypes].sort());
  const layoutsOk = ["stack", "grid", "polar"].every((layout) =>
    (offersAtEight?.studioOffers?.layouts ?? []).includes(`studio-layout-${layout}`),
  );
  // No schema drift: the saved file may only carry keys the ThemeFile /
  // ThemeComposition / CompositionWidget types own.
  const themeSchemaKeys = [
    "name",
    "label",
    "description",
    "chrome",
    "material",
    "scene",
    "composition",
    "colors",
    "darkColors",
  ];
  const compositionSchemaKeys = ["layout", "columns", "radius", "widgets"];
  const widgetSchemaKeys = [
    "type",
    "region",
    "label",
    "tone",
    "data",
    "route",
    "format",
    "max",
    "limit",
    "caption",
  ];
  const badThemeKeys = Object.keys(savedStudio ?? {}).filter(
    (key) => !themeSchemaKeys.includes(key),
  );
  const badCompositionKeys = Object.keys(savedStudio?.composition ?? {}).filter(
    (key) => !compositionSchemaKeys.includes(key),
  );
  const badWidgetKeys = (savedStudio?.composition?.widgets ?? []).flatMap(
    (widget) => Object.keys(widget).filter((key) => !widgetSchemaKeys.includes(key)),
  );
  const noSchemaDrift =
    badThemeKeys.length === 0 &&
    badCompositionKeys.length === 0 &&
    badWidgetKeys.length === 0;
  const contractCancel = await click("studio-cancel");
  const contractClosed = contractCancel
    ? await untilTrue(
        `!document.querySelector('[data-testid="customization-editor"]')`,
        10_000,
      )
    : false;
  const diskAfterContract = fs.readFileSync(studioPath);
  const contractDiskUnchanged = savedBytes.equals(diskAfterContract);
  check(
    "the-composition-editor-obeys-the-contract",
    contractOpened === true &&
      contractReady?.studioWidgetCount === 2 &&
      fillerAdded === true &&
      offersAtEight?.studioWidgetCount === 8 &&
      offersAtEight?.studioOffers?.addDisabled === true &&
      (offersAtEight?.studioOffers?.addNote ?? "").toLowerCase().includes("cap") &&
      offersAtEight?.studioOffers?.labelMaxLength === 32 &&
      regionSetOk === true &&
      regionIdsOk === true &&
      typeSetOk === true &&
      layoutsOk === true &&
      (offersAtEight?.studioOffers?.summary ?? "").includes("8 widgets") &&
      noSchemaDrift === true &&
      contractClosed === true &&
      contractDiskUnchanged === true,
    JSON.stringify({
      contractOpened,
      widgets: contractReady?.studioWidgetCount,
      fillerAdded,
      atEight: offersAtEight?.studioWidgetCount,
      addDisabled: offersAtEight?.studioOffers?.addDisabled,
      addNote: offersAtEight?.studioOffers?.addNote,
      labelMaxLength: offersAtEight?.studioOffers?.labelMaxLength,
      regions: offersAtEight?.studioOffers?.regions,
      regionIds: offersAtEight?.studioOffers?.regionIds,
      types: offersAtEight?.studioOffers?.types,
      layouts: offersAtEight?.studioOffers?.layouts,
      summary: offersAtEight?.studioOffers?.summary,
      regionSetOk,
      regionIdsOk,
      typeSetOk,
      layoutsOk,
      schema: { badThemeKeys, badCompositionKeys, badWidgetKeys },
      noSchemaDrift,
      contractClosed,
      contractDiskUnchanged,
    }),
  );

  // ── 12k: Studio — the rest of the look, on the same live draft ──────────
  // Chrome and material edits must repaint the shell with no write; the palette
  // editor must refuse a failing pair by naming it and the ratio (Save off, no
  // file change), then write the complete palette; removing the palette groups
  // must hand the window back to the skin. The target is the profile file 12j
  // left behind.
  const lookFile = studioFile;
  const lookPath = studioPath;
  const requiredLookColors = [
    "background",
    "foreground",
    "card",
    "cardForeground",
    "muted",
    "mutedForeground",
    "popover",
    "popoverForeground",
    "primary",
    "primaryForeground",
    "secondary",
    "secondaryForeground",
    "accent",
    "accentForeground",
    "border",
    "input",
    "ring",
    "destructive",
    "destructiveForeground",
  ];
  const readLookTokens = async () =>
    evaluate(`(() => {
      const root = document.documentElement;
      const read = (name) => getComputedStyle(root).getPropertyValue(name).trim();
      return {
        background: read("--background"),
        foreground: read("--foreground"),
        card: read("--card"),
        accent: read("--accent"),
        border: read("--border"),
        muted: read("--muted-surface"),
      };
    })()`);
  /**
   * The studio's Fields view swaps one look section at a time behind a section
   * strip, so a control is only in the DOM once its section is chosen. The
   * Settings controls keep their own ids in Settings and take the `studio-`
   * prefix here, so the picks below drive the real segmented options.
   */
  const openStudioSection = async (section) => {
    const clicked = await click(`studio-section-tab-${section}`);
    if (!clicked) return false;
    return untilTrue(
      `Boolean(document.querySelector('[data-testid="studio-${section}"]')) && (document.querySelector('[data-testid="studio-section-tab-${section}"]')?.getAttribute("aria-selected") === "true")`,
      10_000,
    );
  };

  const skinTokens = await readLookTokens();
  const lookOpened = await openStudioEditor();
  const lookReady = lookOpened
    ? await waitFor(
        (s) => s.editorTab === "fields" && s.preview === false,
        15_000,
      )
    : null;
  const lookBaseline = await evaluate(SAMPLE);
  const wingBefore = lookBaseline?.draftWingPlace ?? null;
  const radiusBefore = lookBaseline?.radiusLg ?? null;
  const lookDiskBefore = fs.readFileSync(lookPath);

  const chromeSectionOpened = await openStudioSection("chrome");
  const wingChosen = chromeSectionOpened
    ? await click("studio-chrome-wing-place-floating-left")
    : false;
  const wingPainted = wingChosen
    ? await waitFor(
        (s) =>
          s.draftWingPlace === "floating-left" && s.wingFloating === true,
        12_000,
      )
    : null;
  const materialSectionOpened = await openStudioSection("material");
  const materialChosen = materialSectionOpened
    ? await click("studio-material-option-radius-round")
    : false;
  const radiusChanged = materialChosen
    ? await waitFor((s) => s.radiusLg === "28px", 12_000)
    : null;
  const radiusState = radiusChanged ? await evaluate(SAMPLE) : null;
  const controlShowsRound = String(
    radiusState?.studioMaterialRadius ?? "",
  ).includes("round");
  const lookNoPreview = await evaluate(
    `!document.querySelector('[data-testid="theme-preview-bar"]')`,
  );
  const lookDiskAfterDraft = fs.readFileSync(lookPath);
  const draftKeptLookDisk = lookDiskBefore.equals(lookDiskAfterDraft);
  check(
    "the-studio-moves-chrome-and-material-in-a-draft",
    lookOpened === true &&
      lookReady?.editorTab === "fields" &&
      wingBefore === "rail-top" &&
      chromeSectionOpened === true &&
      wingChosen === true &&
      wingPainted?.draftWingPlace === "floating-left" &&
      wingPainted?.wingFloating === true &&
      materialSectionOpened === true &&
      materialChosen === true &&
      radiusBefore === "24px" &&
      radiusChanged?.radiusLg === "28px" &&
      controlShowsRound === true &&
      lookNoPreview === true &&
      draftKeptLookDisk === true,
    JSON.stringify({
      lookOpened,
      tab: lookReady?.editorTab,
      wingBefore,
      chromeSectionOpened,
      wingChosen,
      wingPainted: wingPainted?.draftWingPlace,
      wingFloating: wingPainted?.wingFloating,
      materialSectionOpened,
      radiusBefore,
      radiusAfter: radiusChanged?.radiusLg,
      materialChosen,
      controlShowsRound,
      controlRadius: radiusState?.studioMaterialRadius,
      noPreview: lookNoPreview,
      diskUnchanged: draftKeptLookDisk,
    }),
  );

  // ── 12k.2: the palette refuses a failing pair, then saves the whole thing ─
  const paletteSectionOpened = await openStudioSection("palette");
  const paletteCopyClicked = paletteSectionOpened
    ? await click("studio-palette-copy")
    : false;
  const paletteCopied = paletteCopyClicked
    ? await waitFor(
        (s) =>
          s.paletteTokens !== null &&
          requiredLookColors.every(
            (token) =>
              typeof s.paletteTokens.light?.[token] === "string" &&
              /^#/.test(s.paletteTokens.light[token]),
          ) &&
          requiredLookColors.every(
            (token) =>
              typeof s.paletteTokens.dark?.[token] === "string" &&
              /^#/.test(s.paletteTokens.dark[token]),
          ),
        15_000,
      )
    : null;
  const lightCopy = paletteCopied?.paletteTokens?.light ?? {};
  const darkCopy = paletteCopied?.paletteTokens?.dark ?? {};
  /*
   * Copy is the safe starting point the contract claims: it seeds both groups
   * from the worn skin and nudges only the skin's own sub-AA pair, so the draft
   * passes the parser as soon as it lands. Assert that before breaking a pair of
   * our own, or a later refusal would be attributable to the skin instead.
   */
  const copyVerdict = paletteCopied
    ? await waitFor(
        (s) => (s.studioPaletteVerdict ?? "").includes("Palettes pass"),
        12_000,
      )
    : null;
  const failingBackgroundValue = lightCopy.foreground;
  const failingTyped = failingBackgroundValue
    ? await setStudioValue(
        "studio-palette-light-background",
        failingBackgroundValue,
      )
    : false;
  const failingVerdict = failingTyped
    ? await waitFor(
        (s) =>
          (s.studioPaletteVerdict ?? "").includes("background/foreground") &&
          /4\.5/.test(s.studioPaletteVerdict ?? "") &&
          /1(?:\.0)?:1/.test(s.studioPaletteVerdict ?? ""),
        12_000,
      )
    : null;
  const failingState = failingVerdict ? await evaluate(SAMPLE) : null;
  const saveDisabledFailing = await evaluate(
    `(() => { const b = document.querySelector('[data-testid="studio-save"]'); return Boolean(b && b.disabled); })()`,
  );
  const diskOnFailing = fs.readFileSync(lookPath);
  const failingKeptDisk = lookDiskBefore.equals(diskOnFailing);
  // The artifact: the studio with the live failing-pair verdict in frame. Put
  // the verdict's floor just above the scroll port's, so the palette editor's
  // inputs and the named pair are both visible.
  await evaluate(`(() => {
    const editor = document.querySelector('[data-testid="customization-editor"]');
    const verdict = document.querySelector('[data-testid="studio-palette-verdict"]');
    if (!editor || !verdict) return false;
    const scroller = editor.closest(".shell__content");
    if (!scroller) {
      verdict.scrollIntoView({ block: "center" });
      return true;
    }
    const scrollerRect = scroller.getBoundingClientRect();
    const verdictRect = verdict.getBoundingClientRect();
    scroller.scrollTop += verdictRect.bottom - scrollerRect.bottom + 28;
    return true;
  })()`);
  await sleep(400);
  const lookShot = await win.webContents.capturePage();
  fs.writeFileSync(STUDIO_LOOK_PNG, lookShot.toPNG());

  // Fix the pair the verdict named, and give each copied palette a `border` the
  // skin does not own (`border` has no text pair, so it cannot make the file
  // invalid). The window's mode decides which palette paints the shell, so both
  // borders are distinct: "back to the skin" below is then a real return in
  // either mode rather than a same-value no-op.
  const backgroundFixed = await setStudioValue(
    "studio-palette-light-background",
    lightCopy.background,
  );
  const backgroundLanded = backgroundFixed
    ? await waitFor(
        (s) => s.paletteTokens?.light?.background === lightCopy.background,
        8_000,
      )
    : null;
  const lightBorderTyped = await setStudioValue(
    "studio-palette-light-border",
    "#123456",
  );
  const lightBorderLanded = lightBorderTyped
    ? await waitFor(
        (s) => s.paletteTokens?.light?.border === "#123456",
        8_000,
      )
    : null;
  const darkBorderTyped = await setStudioValue(
    "studio-palette-dark-border",
    "#654321",
  );
  const darkBorderLanded = darkBorderTyped
    ? await waitFor(
        (s) => s.paletteTokens?.dark?.border === "#654321",
        8_000,
      )
    : null;
  const paletteValidAgain =
    backgroundLanded && lightBorderLanded && darkBorderLanded
      ? await waitFor(
          (s) =>
            (s.studioPaletteVerdict ?? "").includes("Palettes pass") &&
            !(s.studioPaletteVerdict ?? "").includes(
              "background/foreground",
            ) &&
            s.studioPaletteEnabled?.light === true &&
            s.studioPaletteEnabled?.dark === true,
          12_000,
        )
      : null;
  const palettePassesAgain = Boolean(
    (paletteValidAgain?.studioPaletteVerdict ?? "").includes("Palettes pass"),
  );
  const editsLanded =
    backgroundLanded?.paletteTokens?.light?.background ===
      lightCopy.background &&
    lightBorderLanded?.paletteTokens?.light?.border === "#123456" &&
    darkBorderLanded?.paletteTokens?.dark?.border === "#654321";
  const saveEnabledAfterFix = await evaluate(
    `(() => { const b = document.querySelector('[data-testid="studio-save"]'); return Boolean(b && !b.disabled); })()`,
  );
  const diskBeforePaletteSave = fs.readFileSync(lookPath);
  const paletteSaveClicked = saveEnabledAfterFix
    ? await click("studio-save")
    : false;
  const palettePreview = paletteSaveClicked
    ? await waitFor(
        (s) => !s.editorTab && (s.previewText ?? "").includes(lookFile),
        20_000,
      )
    : null;
  let paletteSavedLook = null;
  for (let i = 0; i < 100; i += 1) {
    try {
      paletteSavedLook = JSON.parse(fs.readFileSync(lookPath, "utf8"));
    } catch {
      paletteSavedLook = null;
    }
    if (
      paletteSavedLook?.colors &&
      requiredLookColors.every(
        (token) => typeof paletteSavedLook.colors[token] === "string",
      )
    ) {
      break;
    }
    await sleep(100);
  }
  const savedLightNames = paletteSavedLook?.colors
    ? Object.keys(paletteSavedLook.colors).sort()
    : [];
  const savedDarkNames = paletteSavedLook?.darkColors
    ? Object.keys(paletteSavedLook.darkColors).sort()
    : [];
  const completePalette =
    JSON.stringify(savedLightNames) ===
      JSON.stringify([...requiredLookColors].sort()) &&
    JSON.stringify(savedDarkNames) ===
      JSON.stringify([...requiredLookColors].sort());
  const borderWritten =
    String(paletteSavedLook?.colors?.border ?? "").toLowerCase() === "#123456";
  const darkBorderWritten =
    String(paletteSavedLook?.darkColors?.border ?? "").toLowerCase() ===
    "#654321";
  const backgroundWritten =
    paletteSavedLook?.colors?.background === lightCopy.background;
  const paletteDiskChanged = !lookDiskBefore.equals(
    fs.readFileSync(lookPath),
  );
  check(
    "the-studio-refuses-a-palette-that-fails-contrast",
    paletteSectionOpened === true &&
      paletteCopyClicked === true &&
      paletteCopied !== null &&
      copyVerdict !== null &&
      (copyVerdict?.studioPaletteVerdict ?? "").includes("Palettes pass") &&
      failingTyped === true &&
      failingVerdict !== null &&
      (failingVerdict?.studioPaletteVerdict ?? "").includes(
        "background/foreground",
      ) &&
      /4\.5/.test(failingVerdict?.studioPaletteVerdict ?? "") &&
      /1(?:\.0)?:1/.test(failingVerdict?.studioPaletteVerdict ?? "") &&
      (failingState?.studioStatus ?? "").includes(
        "colors fails WCAG AA contrast",
      ) &&
      (failingState?.studioStatus ?? "").includes("background/foreground") &&
      saveDisabledFailing === true &&
      failingKeptDisk === true &&
      palettePassesAgain === true &&
      editsLanded === true &&
      saveEnabledAfterFix === true &&
      paletteSaveClicked === true &&
      (palettePreview?.previewText ?? "").includes(lookFile) &&
      lookDiskBefore.equals(diskBeforePaletteSave) &&
      completePalette === true &&
      borderWritten === true &&
      darkBorderWritten === true &&
      backgroundWritten === true &&
      paletteDiskChanged === true,
    JSON.stringify({
      paletteSectionOpened,
      paletteCopyClicked,
      copiedTokens: {
        light: Object.keys(lightCopy).length,
        dark: Object.keys(paletteCopied?.paletteTokens?.dark ?? {}).length,
      },
      copyVerdict: copyVerdict?.studioPaletteVerdict,
      failingTyped,
      verdict: failingVerdict?.studioPaletteVerdict,
      failingStatus: failingState?.studioStatus,
      saveDisabledFailing,
      diskUnchangedWhileFailing: failingKeptDisk,
      validAgain: paletteValidAgain?.studioPaletteVerdict,
      editsLanded,
      editedTokens: paletteValidAgain?.paletteTokens,
      saveEnabledAfterFix,
      paletteSaveClicked,
      previewed: (palettePreview?.previewText ?? "").slice(0, 80),
      diskUnchangedBeforeSave: lookDiskBefore.equals(diskBeforePaletteSave),
      savedLightNames: savedLightNames.length,
      savedDarkNames: savedDarkNames.length,
      completePalette,
      borderWritten,
      darkBorderWritten,
      darkCopyBorder: darkCopy.border,
      backgroundWritten,
      paletteDiskChanged,
    }),
  );

  // ── 12k.3: removing the palette hands the window back to the skin ────────
  const palettedTokens = await readLookTokens();
  // Both copied palettes carry a border the skin does not, so the shell shows a
  // changed border whichever mode it paints with.
  const paletteWorn =
    String(palettedTokens.border ?? "") !== String(skinTokens.border ?? "");
  const removeOpened = await openStudioEditor();
  const removeSectionOpened = removeOpened
    ? await openStudioSection("palette")
    : false;
  const removeReady = removeSectionOpened
    ? await waitFor(
        (s) =>
          s.editorTab === "fields" &&
          s.studioPaletteEnabled?.light === true &&
          s.studioPaletteEnabled?.dark === true,
        15_000,
      )
    : null;
  const lightToggleClicked = await click("studio-palette-light-enabled");
  // Confirm the first group actually left the draft before the second click, so
  // a stale draft prop cannot resurrect it.
  const lightGroupOff = lightToggleClicked
    ? await waitFor(
        (s) => s.studioPaletteEnabled?.light === false,
        8_000,
      )
    : null;
  const darkToggleClicked = await click("studio-palette-dark-enabled");
  const palettesOff = darkToggleClicked
    ? await waitFor(
        (s) =>
          s.studioPaletteEnabled?.light === false &&
          s.studioPaletteEnabled?.dark === false,
        12_000,
      )
    : null;
  const saveEnabledNoPalette = await evaluate(
    `(() => { const b = document.querySelector('[data-testid="studio-save"]'); return Boolean(b && !b.disabled); })()`,
  );
  const removeSaveClicked = saveEnabledNoPalette
    ? await click("studio-save")
    : false;
  const removePreview = removeSaveClicked
    ? await waitFor(
        (s) => !s.editorTab && (s.previewText ?? "").includes(lookFile),
        20_000,
      )
    : null;
  let strippedLook = null;
  for (let i = 0; i < 100; i += 1) {
    try {
      strippedLook = JSON.parse(fs.readFileSync(lookPath, "utf8"));
    } catch {
      strippedLook = null;
    }
    if (
      strippedLook &&
      !("colors" in strippedLook) &&
      !("darkColors" in strippedLook)
    ) {
      break;
    }
    await sleep(100);
  }
  const skinBackTokens = await readLookTokens();
  const skinPaletteBack =
    JSON.stringify(skinBackTokens) === JSON.stringify(skinTokens);
  const paletteAbsent =
    Boolean(strippedLook) &&
    !("colors" in strippedLook) &&
    !("darkColors" in strippedLook);
  const chromeKept =
    strippedLook?.chrome?.wingSwitcher?.place === "floating-left";
  const materialKept = strippedLook?.material?.radius === "round";
  check(
    "the-studio-can-hand-the-palette-back-to-the-skin",
    paletteWorn === true &&
      removeOpened === true &&
      removeSectionOpened === true &&
      removeReady?.studioPaletteEnabled?.light === true &&
      removeReady?.studioPaletteEnabled?.dark === true &&
      lightToggleClicked === true &&
      lightGroupOff?.studioPaletteEnabled?.light === false &&
      darkToggleClicked === true &&
      palettesOff?.studioPaletteEnabled?.light === false &&
      palettesOff?.studioPaletteEnabled?.dark === false &&
      saveEnabledNoPalette === true &&
      removeSaveClicked === true &&
      (removePreview?.previewText ?? "").includes(lookFile) &&
      paletteAbsent === true &&
      chromeKept === true &&
      materialKept === true &&
      skinPaletteBack === true,
    JSON.stringify({
      paletteWorn,
      palettedBorder: palettedTokens.border,
      removeOpened,
      removeSectionOpened,
      toggles: { light: lightToggleClicked, dark: darkToggleClicked },
      lightGroupOff: lightGroupOff?.studioPaletteEnabled,
      off: palettesOff?.studioPaletteEnabled,
      saveEnabledNoPalette,
      removeSaveClicked,
      previewed: (removePreview?.previewText ?? "").slice(0, 80),
      paletteAbsent,
      fileKeys: strippedLook ? Object.keys(strippedLook) : null,
      chromeKept,
      materialKept,
      skinTokens,
      skinBackTokens,
      skinPaletteBack,
    }),
  );

  // ── 12l: Gallery — five bundled examples, seeded once and removable ─────
  // A fresh profile gets the whole gallery exactly once: five showcase files on
  // disk and their names recorded in theme-state.json. Each bundled file must
  // pass the same parser the companion's validator runs. The chip is a card
  // affordance on the bundled five and nowhere else. Removing one is final:
  // seeding records the name, so a renderer reload must not bring it back.
  const expectedGalleryFiles = [
    "showcase-control-room.json",
    "showcase-helios.json",
    "showcase-night-shift.json",
    "showcase-paper-trail.json",
    "showcase-solar-system.json",
  ].sort();
  const expectedGalleryNames = expectedGalleryFiles.map((file) =>
    file.replace(/\.json$/, ""),
  );
  const validateShowcase = async (theme) => {
    try {
      return await gateCall("validate_theme", { theme });
    } catch (error) {
      return { json: null, isError: true, error: String(error) };
    }
  };
  const galleryParse = {};
  for (const file of expectedGalleryFiles) {
    const full = path.join(themesDir, file);
    let theme = null;
    try {
      theme = JSON.parse(fs.readFileSync(full, "utf8"));
    } catch {
      theme = null;
    }
    const answer = theme ? await validateShowcase(theme) : null;
    galleryParse[file] = {
      present: fs.existsSync(full),
      parsed: answer?.json?.ok === true,
      name: theme?.name ?? null,
      error: answer?.json?.error?.message ?? (theme ? null : "not JSON"),
    };
  }
  const galleryStatePath = path.join(profileDir, "theme-state.json");
  const readGalleryState = () => {
    try {
      return JSON.parse(fs.readFileSync(galleryStatePath, "utf8"));
    } catch {
      return null;
    }
  };
  const galleryState = readGalleryState();
  const seededNames = Array.isArray(galleryState?.seededShowcase)
    ? galleryState.seededShowcase
    : null;
  const seededNamesOk =
    seededNames !== null &&
    JSON.stringify([...seededNames].sort()) ===
      JSON.stringify([...expectedGalleryNames].sort());
  check(
    "a-fresh-profile-seeds-the-whole-gallery",
    expectedGalleryFiles.every(
      (file) =>
        galleryParse[file].present === true &&
        galleryParse[file].parsed === true &&
        galleryParse[file].name === file.replace(/\.json$/, ""),
    ) &&
      seededNamesOk === true,
    JSON.stringify({
      files: galleryParse,
      seededNames,
      stateKeys: galleryState ? Object.keys(galleryState) : null,
    }),
  );

  // ── 12l.2: the chip marks the bundled five and nothing else ─────────────
  // Captured before the removal below, while all five cards are still listed;
  // it is also the gallery artifact (the list scrolled to the showcase cards).
  const galleryReady = await waitFor(
    (s) =>
      s.customizationsPage === true &&
      Array.isArray(s.galleryChips) &&
      s.galleryChips.some(
        (card) => card.file === "showcase-control-room.json",
      ),
    15_000,
  );
  // Let any countdown from 12k finish: the screenshot is the list, not a bar.
  await waitFor((s) => s.preview === false, 15_000);
  const chipCards = (galleryReady?.galleryChips ?? []).filter(
    (card) => card.chip === true,
  );
  const chippedFiles = chipCards.map((card) => card.file).sort();
  const chipSetOk =
    JSON.stringify(chippedFiles) === JSON.stringify([...expectedGalleryFiles].sort());
  const chipNotesOk =
    chipCards.length === expectedGalleryFiles.length &&
    chipCards.every((card) => (card.note ?? "").includes("Bundled example"));
  const chipLabelsOk = chipCards.every(
    (card) => typeof card.chipText === "string" && card.chipText.length > 0,
  );
  const operatorFilesClear = [
    "rig-studio.json",
    "helios-authored.json",
    "solar-system.json",
  ].every((file) => {
    const card = (galleryReady?.galleryChips ?? []).find(
      (entry) => entry.file === file,
    );
    return card === undefined || card.chip === false;
  });
  const galleryNotes = galleryReady?.galleryNotes ?? [];
  await evaluate(`(() => {
    const card = document.querySelector('[data-testid="customization-showcase-control-room"]');
    if (!card) return false;
    card.scrollIntoView({ block: "start" });
    return true;
  })()`);
  await sleep(400);
  const galleryShot = await win.webContents.capturePage();
  fs.writeFileSync(GALLERY_PNG, galleryShot.toPNG());
  check(
    "the-gallery-chip-marks-the-bundled-examples",
    galleryReady?.customizationsPage === true &&
      chipSetOk === true &&
      chipNotesOk === true &&
      chipLabelsOk === true &&
      operatorFilesClear === true &&
      galleryNotes.length === expectedGalleryFiles.length,
    JSON.stringify({
      galleryPage: galleryReady?.customizationsPage,
      chippedFiles,
      chipSetOk,
      chipNotesOk,
      chipLabelsOk,
      operatorFilesClear,
      notes: galleryNotes,
    }),
  );

  // ── 12l.3: removing a gallery theme is final ────────────────────────────
  const controlRoomSelector = '[data-testid="customization-showcase-control-room"]';
  const controlRoomPath = path.join(themesDir, "showcase-control-room.json");
  const removeGalleryCard = async () =>
    evaluate(`(() => {
      const b = document.querySelector('${controlRoomSelector} [data-testid="customization-remove"]');
      if (!b) return false;
      b.click();
      return true;
    })()`);
  const removeFirstPressed = await removeGalleryCard();
  await sleep(250);
  const removeSecondPressed = await removeGalleryCard();
  const removedFromPage =
    removeSecondPressed &&
    (await untilTrue(`!document.querySelector('${controlRoomSelector}')`, 15_000));
  const goneFromDisk = !fs.existsSync(controlRoomPath);
  const stateAfterRemoval = readGalleryState();
  const recordedAfterRemoval =
    Array.isArray(stateAfterRemoval?.seededShowcase) &&
    stateAfterRemoval.seededShowcase.includes("showcase-control-room");
  // Reload the renderer: boot-time seeding is not re-run, and the recorded name
  // means a later boot would not re-add the file either (single-boot rig: the
  // boot side is covered by the fresh-profile check plus review).
  win.webContents.reload();
  await new Promise((resolve) =>
    win.webContents.once("did-finish-load", resolve),
  );
  let galleryUp = null;
  const galleryDeadline = Date.now() + 60_000;
  while (Date.now() < galleryDeadline) {
    try {
      galleryUp = await evaluate("Boolean(document.querySelector('.shell'))");
    } catch {
      galleryUp = null;
    }
    if (galleryUp) break;
    await sleep(100);
  }
  await evaluate(`(() => {
    if (location.hash !== "#/customizations") location.hash = "#/customizations";
    return true;
  })()`);
  const customizationsBack = await waitFor(
    (s) => s.customizationsPage === true && (s.customizationsRows ?? 0) > 0,
    20_000,
  );
  const absentAfterReload = await evaluate(
    `!document.querySelector('${controlRoomSelector}')`,
  );
  const stillGoneFromDisk = !fs.existsSync(controlRoomPath);
  const stateAfterReload = readGalleryState();
  const recordedAfterReload =
    Array.isArray(stateAfterReload?.seededShowcase) &&
    stateAfterReload.seededShowcase.includes("showcase-control-room");
  const remainingChipFiles = (customizationsBack?.galleryChips ?? [])
    .filter((card) => card.chip === true)
    .map((card) => card.file)
    .sort();
  const expectedRemaining = expectedGalleryFiles
    .filter((file) => file !== "showcase-control-room.json")
    .sort();
  const otherGalleryCardsStillChip =
    JSON.stringify(remainingChipFiles) === JSON.stringify(expectedRemaining);
  check(
    "removing-a-gallery-theme-does-not-bring-it-back",
    removeFirstPressed === true &&
      removeSecondPressed === true &&
      removedFromPage === true &&
      goneFromDisk === true &&
      recordedAfterRemoval === true &&
      galleryUp === true &&
      customizationsBack?.customizationsPage === true &&
      absentAfterReload === true &&
      stillGoneFromDisk === true &&
      recordedAfterReload === true &&
      otherGalleryCardsStillChip === true,
    JSON.stringify({
      removeFirstPressed,
      removeSecondPressed,
      removedFromPage,
      goneFromDisk,
      recordedAfterRemoval,
      galleryUp,
      customizationsPage: customizationsBack?.customizationsPage,
      absentAfterReload,
      stillGoneFromDisk,
      recordedAfterReload,
      remainingChipFiles,
      otherGalleryCardsStillChip,
    }),
  );

  const report = {
    ranAt: new Date().toISOString(),
    world,
    checks,
    failures,
    pass: failures.length === 0,
    artifacts: {
      preview: path.relative(desktopRoot, PREVIEW_PNG),
      kept: path.relative(desktopRoot, KEPT_PNG),
      floating: path.relative(desktopRoot, FLOATING_PNG),
      bareFrame: path.relative(desktopRoot, BARE_FRAME_PNG),
      settings: path.relative(desktopRoot, SETTINGS_PNG),
      material: path.relative(desktopRoot, MATERIAL_PNG),
      layout: path.relative(desktopRoot, LAYOUT_PNG),
      variants: path.relative(desktopRoot, VARIANTS_PNG),
      sidebarRight: path.relative(desktopRoot, SIDEBAR_RIGHT_PNG),
      dockLeft: path.relative(desktopRoot, DOCK_LEFT_PNG),
      floatingRail: path.relative(desktopRoot, FLOATING_RAIL_PNG),
      outsideTheme: path.relative(desktopRoot, OUTSIDE_PNG),
      scene: path.relative(desktopRoot, SCENE_PNG),
      frames: path.relative(desktopRoot, FRAMES_PNG),
      showcase: path.relative(desktopRoot, SHOWCASE_PNG),
      r3Gate: path.relative(desktopRoot, R3_GATE_PNG),
      focusFloating: path.relative(desktopRoot, FOCUS_FLOATING_PNG),
      r4Validation: path.relative(desktopRoot, R4_VALIDATION_JSON),
      composition: path.relative(desktopRoot, COMPOSITION_PNG),
      compositionSettings: path.relative(
        desktopRoot,
        COMPOSITION_SETTINGS_PNG,
      ),
      compositionOrbit: path.relative(desktopRoot, COMPOSITION_ORBIT_PNG),
      compositionGrid: path.relative(desktopRoot, COMPOSITION_GRID_PNG),
      compositionVocabulary: path.relative(
        desktopRoot,
        COMPOSITION_VOCABULARY_PNG,
      ),
      helios: path.relative(desktopRoot, HELIOS_PNG),
      customizations: path.relative(desktopRoot, CUSTOMIZATIONS_PNG),
      customizationsOn: path.relative(desktopRoot, CUSTOMIZATIONS_ON_PNG),
      customizationsOff: path.relative(desktopRoot, CUSTOMIZATIONS_OFF_PNG),
      trust: path.relative(desktopRoot, TRUST_PNG),
      studio: path.relative(desktopRoot, STUDIO_PNG),
      look: path.relative(desktopRoot, STUDIO_LOOK_PNG),
      gallery: path.relative(desktopRoot, GALLERY_PNG),
    },
    theme: THEME,
    refused: BAD_THEME,
  };
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  if (failures.length > 0) {
    console.error(failures.join("\n"));
    app.exit(1);
    return;
  }
  app.exit(0);
}

main().catch((error) => {
  const report = {
    ranAt: new Date().toISOString(),
    world: world ?? null,
    checks,
    failures: [...failures, String(error)],
    pass: false,
  };
  try {
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  } catch {
    /* ignore */
  }
  console.error(error);
  app.exit(1);
});

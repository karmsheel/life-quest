/**
 * App background — the vertical slice, judged on the REAL app.
 *
 * The contract (docs/superpowers/specs/2026-11-22-app-background.md) says the
 * page can wear a picture the operator picked, that the picture is copied into
 * the app profile rather than linked, that scene themes may carry one, and that
 * the Extensions studio can author one. This rig falsifies each claim on the
 * shipped shell:
 *
 *  1. `the-appearance-page-shows-the-background-section` — Settings →
 *     Appearance has the Background section, the picture row, and Fit/Position/
 *     Dim/Blur rows that are inert until a picture is set.
 *  2. `the-picture-is-copied-and-the-shell-wears-it` — the real Choose button
 *     goes through main's picker seam, the picture is copied into
 *     `<profile>/backgrounds/`, and the shell paints
 *     `[data-scene-preset=image]` with a `blob:` URL and the default axes.
 *  3. `fit-position-dim-blur-repaint-the-layer` — each pick repaints the
 *     document/backdrop datasets, the picture row says "yours", and Reset to
 *     theme is offered.
 *  4. `the-app-wears-the-picture-outside-settings` — with the settings sheet
 *     closed the wallpaper is the shipped shell's background (the hero shot).
 *  5. `the-picks-and-the-picture-survive-a-reload` — a reload re-reads the file
 *     and the operator override: the picture comes back on a fresh blob URL.
 *  6. `reset-to-theme-hands-the-picture-back` — Reset removes only the picture
 *     override; the drawn preset returns and the row is empty again.
 *  7. `a-theme-file-can-carry-the-picture` — a theme file naming the stored
 *     picture previews with its own axes on the shell.
 *  8. `a-picture-theme-keeps-across-a-reload` — Keep makes that file the kept
 *     theme, and a reload still wears its picture.
 *  9. `the-horizon-sky-paints` + `the-mesh-sky-paints` +
 *     `settings-offers-both-new-skies` — the two new procedural presets paint
 *     their own layers and Settings' Sky row lists them.
 * 10. `the-studio-authors-the-picture-and-saves-it` — Extensions → Edit → Fields
 *     → Scene shows the studio picture rows, choosing updates the draft, and
 *     Save writes `scene.background.image` to the profile file (read back).
 * 11. `a-missing-picture-falls-back-to-the-drawn-sky` — a theme naming a file
 *     that is not in the profile keeps the shell painted on its drawn preset.
 * 12. `an-invalid-picture-is-refused-by-name` +
 *     `the-watcher-refuses-an-invalid-picture-by-name` — `image.file:
 *     "../escape.png"` and a bad `fit` are refused with the field named, in the
 *     studio's JSON verdict and in the watcher's write refusal.
 *
 * Round 2 puts the backdrop behind the whole shell tray and gives the sidebar
 * and the chat bar a five-step shade (Solid/Heavy/Medium/Light/Clear), carried
 * by the theme file and overridable in Settings. The same rig proves it:
 *
 * 13. `a-fresh-shell-is-solid-on-both-panels` — the default is the opaque shell
 *     the app always had: root datasets solid, computed panel alphas 1.
 * 14. `settings-shades-the-sidebar-and-chat-bar` — the two always-live rows
 *     appear; Clear on the sidebar and Heavy on the dock repaint the datasets,
 *     the computed veils, both "yours" pills, and the panel surfaces.
 * 15. `clear-panels-show-the-wallpaper-through-the-shell` — with both panels
 *     clear the scene layer is a child of `.shell` and its rect covers the rail
 *     and dock columns, so the picture runs behind them (artifact
 *     `theme-background-clear-panels.png`).
 * 16. `panel-picks-survive-a-reload` — the picks are the operator's override and
 *     come back on the same reload the picture uses.
 * 17. `reset-restores-solid-panels` — Reset to theme hands the shades back with
 *     the picture: both panels opaque again.
 * 18. `a-theme-file-can-shade-the-panels` — the picture theme also names
 *     `panels { navRail: clear, chat: light }`; it previews, Keep keeps it, a
 *     reload still wears it, and the profile JSON still names both.
 * 19. `the-studio-authors-the-panel-shades` — the studio's controlled rows pick
 *     one axis at a time, the draft paints each, and Save writes the deep-merged
 *     `scene.background.panels` object (read back).
 * 20. `an-invalid-panel-is-refused-by-name` — `panels.chat: "translucent"` is
 *     refused with the field named in the studio verdict and the watcher.
 *
 * Round 3 gives the companion the same layer over its real MCP door: a picture
 * store tool and a `get_theme` that reports the scene and the profile's
 * pictures. The rig opens that door exactly as the app does:
 *
 * 21. `the-companion-door-offers-the-background-tools` — `listTools` carries
 *     `get_theme`, `validate_theme`, `write_theme` and `store_background_picture`.
 * 22. `get-theme-reports-the-background-layer` — the kept theme's resolved scene
 *     (picture file, panel shades), every listed file's scene, the `backgrounds`
 *     inventory with the picture the operator stored, and a vocabulary line for
 *     `scene.background.panels`.
 * 23. `the-agent-stores-a-vault-picture` — a vault image copied with the tool
 *     lands in `<profile>/backgrounds/`, byte-identical, and `get_theme` lists it.
 * 24. `the-agent-wears-the-picture-it-stored` — `validate_theme` then
 *     `write_theme` with that image and panel shades; the real window previews
 *     it, Keep keeps it, a reload still wears it (artifact
 *     `theme-background-agent.png`).
 * 25. `store-background-refuses-a-path-outside-the-vault` — `"../escape.png"` and
 *     a non-image vault file are refused, and neither creates a profile file.
 *
 * The world is throwaway: its own profile, vault, stub Hermes host, stub
 * `hermes` on PATH and its own MCP ports. `bootForE2e` runs the product's main
 * process, preload and renderer, so this is the shipped shell. The picker seam
 * is `LIFEQUEST_E2E.themeBackgroundSources`: main shifts one absolute path per
 * `theme:pickBackground`, which is how a file dialog is answered here.
 *
 * Run with the checkout's dev server up (`lifequest-e2e` does both):
 *
 *   LQ_BACKGROUND_WORLD=<dir> <electron> e2e/theme-background.electron.mjs
 *
 * Exit 0 = every check held. The report is `e2e/artifacts/theme-background.json`
 * and the pictures are `theme-background-settings.png`, `theme-background-app.png`,
 * `theme-background-clear-panels.png`, `theme-background-horizon.png`,
 * `theme-background-studio.png` and `theme-background-agent.png`, all beside it.
 */
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import { createVault } from "@lifequest/vault-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(here, "..");
const artifactsDir = path.join(here, "artifacts");

app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");

const world = process.env.LQ_BACKGROUND_WORLD;
const DEV_URL = process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173";
const REPORT = path.join(artifactsDir, "theme-background.json");
const SETTINGS_PNG = path.join(artifactsDir, "theme-background-settings.png");
const APP_PNG = path.join(artifactsDir, "theme-background-app.png");
const HORIZON_PNG = path.join(artifactsDir, "theme-background-horizon.png");
const STUDIO_PNG = path.join(artifactsDir, "theme-background-studio.png");
const CLEAR_PANELS_PNG = path.join(
  artifactsDir,
  "theme-background-clear-panels.png",
);
const AGENT_PNG = path.join(artifactsDir, "theme-background-agent.png");
const FIXTURE = path.join(here, "fixtures", "background-ridge.png");
const FIXTURE_NAME = "background-ridge";

const failures = [];
const checks = [];
function check(label, pass, detail = null) {
  checks.push({ label, pass: Boolean(pass), detail });
  if (!pass) failures.push(detail ? `${label}: ${detail}` : label);
  return Boolean(pass);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A Hermes host gateway that is serving this profile, and nothing else. */
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
  await Promise.all(held.map((server) => new Promise((r) => server.close(r))));
  return ports;
}

/** The `hermes` on PATH: succeeds for seeding, never brings a host up. */
function writeHermesStub(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  const stub = path.join(binDir, "hermes");
  fs.writeFileSync(
    stub,
    ["#!/bin/sh", 'case "$1" in', "  gateway) exit 1 ;;", "esac", "exit 0", ""].join("\n"),
    { mode: 0o755 },
  );
}

/** One probe of the shipped DOM: everything the checks below judge. */
const SAMPLE = `(async () => {
  const root = document.documentElement;
  const layer = document.querySelector('[data-testid="scene-backdrop"]');
  const picture = document.querySelector('[data-testid="scene-backdrop-image"]');
  const text = (id) => {
    const el = document.querySelector('[data-testid="' + id + '"]');
    return el ? (el.textContent || "").trim() : null;
  };
  const button = (id) => {
    const el = document.querySelector('[data-testid="' + id + '"]');
    if (!el) return null;
    return { disabled: el.disabled === true || el.getAttribute("aria-disabled") === "true" };
  };
  const attr = (name) =>
    (layer && layer.getAttribute(name)) ?? (picture && picture.getAttribute(name)) ?? null;
  const urlOf = (value) => {
    if (!value) return null;
    const start = value.indexOf("url(");
    if (start < 0) return null;
    let inner = value.slice(start + 4).trim();
    if (inner.endsWith(")")) inner = inner.slice(0, -1);
    inner = inner.trim();
    if (inner.startsWith('"') || inner.startsWith("'")) inner = inner.slice(1);
    if (inner.endsWith('"') || inner.endsWith("'")) inner = inner.slice(0, -1);
    return inner || null;
  };
  const optionGroup = (prefix, axis) => {
    const host = document.querySelector('[data-testid="' + prefix + "background-" + axis + '"]');
    if (!host) return null;
    // Match the row's options by the axis segment ("background-option-fit-"),
    // but report values axis-qualified ("fit-contain") — the word every check
    // below compares against and the same shape the scene preset row reports.
    const matchPrefix = prefix + "background-option-" + axis + "-";
    const labelPrefix = prefix + "background-option-";
    const options = [...host.querySelectorAll('[data-testid^="' + matchPrefix + '"]')];
    const active = options.find(
      (option) =>
        option.getAttribute("aria-checked") === "true" ||
        option.getAttribute("aria-pressed") === "true",
    );
    const label = (el) => (el.getAttribute("data-testid") || "").slice(labelPrefix.length);
    return {
      options: options.map(label),
      active: active ? label(active) : null,
      disabled:
        host.getAttribute("aria-disabled") === "true" ||
        (options.length > 0 && options.every((option) => option.disabled === true)),
    };
  };
  const navRailEl = document.querySelector(".nav-rail");
  const chatPanelEl = document.querySelector(".chat-panel");
  const shellEl = document.querySelector(".shell");
  const rectOf = (el) => {
    if (!el) return null;
    const box = el.getBoundingClientRect();
    return {
      left: Math.round(box.left),
      right: Math.round(box.right),
      top: Math.round(box.top),
      bottom: Math.round(box.bottom),
      width: Math.round(box.width),
      height: Math.round(box.height),
    };
  };
  /**
   * The alpha channel of a computed CSS colour.
   *
   * The panel veils are color-mix(... transparent); Chromium may serialise the
   * resolved value as rgba(), rgb(... / a) or color(srgb ... / a), so this reads
   * whichever shape it got and falls back to a one-pixel canvas fill for any
   * other colour syntax.
   */
  const alphaOf = (color) => {
    if (!color) return null;
    const value = String(color).trim();
    if (value === "transparent") return 0;
    const open = value.indexOf("(");
    const close = value.lastIndexOf(")");
    if (open > 0 && close > open) {
      const inner = value.slice(open + 1, close);
      // Serialisations differ by engine: comma rgba(), space rgb(... / a) and
      // color(srgb ... / a) all occur, and an alpha may arrive as a percentage.
      const alphaNumber = (text) => {
        const value = String(text).trim();
        const percent = value.endsWith("%");
        const number = Number(percent ? value.slice(0, -1) : value);
        if (!Number.isFinite(number)) return null;
        return percent ? number / 100 : number;
      };
      const slash = inner.split("/");
      if (slash.length === 2) {
        const alpha = alphaNumber(slash[1]);
        return alpha === null ? 1 : alpha;
      }
      // Comma forms carry alpha as a fourth argument (rgba()/hsla() legacy).
      const parts = inner.split(",");
      if (parts.length >= 4) {
        const alpha = alphaNumber(parts[3]);
        if (alpha !== null) return alpha;
      }
      // Any other colour function without a slash is implicitly opaque; the
      // canvas fallback below is only for bare keywords.
      return 1;
    }
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d");
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      return context.getImageData(0, 0, 1, 1).data[3] / 255;
    } catch {
      return null;
    }
  };
  const panelProbe = (el) => {
    if (!el) return null;
    const color = getComputedStyle(el).backgroundColor;
    return { color, alpha: alphaOf(color) };
  };
  const veilOf = (name) =>
    getComputedStyle(root).getPropertyValue(name).trim() || null;
  const section = document.querySelector('[data-testid="theme-background"]');
  const previewBar = document.querySelector('[data-testid="theme-preview-bar"]');
  const errorBar = document.querySelector('[data-testid="theme-error"]');
  const editor = document.querySelector('[data-testid="extension-editor"]');
  const editorStatus =
    document.querySelector('[data-testid="extension-editor-status"]') ||
    document.querySelector('[data-testid="studio-status"]');
  const editorSave =
    document.querySelector('[data-testid="extension-editor-save"]') ||
    document.querySelector('[data-testid="studio-save"]');
  const presetHost = document.querySelector('[data-testid="scene-background"]');
  const presetPrefix = "scene-option-";
  let kept = null;
  try {
    kept = await window.lifequest?.themeGetState?.();
  } catch {
    // A poll may race a navigation/reload; "no answer yet" is not a failure.
    kept = null;
  }
  return {
    hash: location.hash,
    shell: Boolean(document.querySelector(".shell")),
    pageVisible: (() => {
      const page = document.querySelector(".shell__content");
      if (!page) return null;
      const style = getComputedStyle(page);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        page.getBoundingClientRect().width > 1
      );
    })(),
    errors: (window.__lqErrors ?? []).slice(-6),
    preview: Boolean(previewBar),
    previewText: previewBar ? (previewBar.textContent || "").trim() : null,
    error: errorBar ? (errorBar.textContent || "").trim() : null,
    keptFile: kept && kept.ok ? kept.value.keptFile : null,
    root: {
      sceneBackdrop: root.dataset.sceneBackdrop ?? null,
      sceneImageFit: root.dataset.sceneImageFit ?? null,
      sceneImagePosition: root.dataset.sceneImagePosition ?? null,
      sceneImageDim: root.dataset.sceneImageDim ?? null,
      sceneImageBlur: root.dataset.sceneImageBlur ?? null,
      sceneIntensity: root.dataset.sceneIntensity ?? null,
      scenePanelSidebar: root.dataset.scenePanelSidebar ?? null,
      scenePanelChat: root.dataset.scenePanelChat ?? null,
    },
    // Round 2: the backdrop now spans the whole tray and the rail/dock veil it.
    panels: {
      sidebar: root.dataset.scenePanelSidebar ?? null,
      chat: root.dataset.scenePanelChat ?? null,
      sidebarVeil: veilOf("--scene-panel-sidebar-veil"),
      chatVeil: veilOf("--scene-panel-chat-veil"),
      rail: panelProbe(navRailEl),
      chatPanel: panelProbe(chatPanelEl),
      railRect: rectOf(navRailEl),
      chatRect: rectOf(chatPanelEl),
      shellRect: rectOf(shellEl),
      sceneParentClass:
        layer && layer.parentElement ? String(layer.parentElement.className) : null,
      sceneRect: rectOf(layer),
    },
    layer: layer
      ? {
          preset: layer.getAttribute("data-scene-preset"),
          className: String(layer.className),
          nodes: layer.querySelectorAll("*").length,
          imageFit: attr("data-image-fit"),
          imagePosition: attr("data-image-position"),
          imageDim: attr("data-image-dim"),
          imageBlur: attr("data-image-blur"),
          ariaHidden: layer.getAttribute("aria-hidden"),
        }
      : null,
    picture: picture
      ? {
          url: urlOf(picture.style.backgroundImage || getComputedStyle(picture).backgroundImage),
          size: getComputedStyle(picture).backgroundSize,
          position: getComputedStyle(picture).backgroundPosition,
          repeat: getComputedStyle(picture).backgroundRepeat,
          filter: getComputedStyle(picture).filter,
        }
      : null,
    settings: {
      section: Boolean(section),
      title: section
        ? ((section.querySelector(".theme-material__title") || {}).textContent || "").trim()
        : null,
      pictureName: text("background-picture-name"),
      choose: Boolean(document.querySelector('[data-testid="background-choose"]')),
      remove: Boolean(document.querySelector('[data-testid="background-remove"]')),
      yours: Boolean(document.querySelector('[data-testid="background-picture-yours"]')),
      reset: button("background-reset"),
      fit: optionGroup("", "fit"),
      position: optionGroup("", "position"),
      dim: optionGroup("", "dim"),
      blur: optionGroup("", "blur"),
      sidebarShade: optionGroup("", "panel-sidebar"),
      chatShade: optionGroup("", "panel-chat"),
      sidebarYours: Boolean(
        document.querySelector('[data-testid="background-panel-sidebar-yours"]'),
      ),
      chatYours: Boolean(
        document.querySelector('[data-testid="background-panel-chat-yours"]'),
      ),
      presetOptions: presetHost
        ? [...presetHost.querySelectorAll('[data-testid^="' + presetPrefix + '"]')].map((el) =>
            (el.getAttribute("data-testid") || "").slice(presetPrefix.length),
          )
        : null,
      presetLabels: presetHost
        ? [...presetHost.querySelectorAll("button")].map((el) => (el.textContent || "").trim())
        : null,
    },
    studio: {
      sectionOpen: Boolean(document.querySelector('[data-testid="studio-scene"]')),
      panel: Boolean(document.querySelector('[data-testid="studio-background-panel"]')),
      picture: Boolean(document.querySelector('[data-testid="studio-background-picture"]')),
      pictureName: text("studio-background-picture-name"),
      choose: Boolean(document.querySelector('[data-testid="studio-background-choose"]')),
      remove: Boolean(document.querySelector('[data-testid="studio-background-remove"]')),
      fit: optionGroup("studio-", "fit"),
      position: optionGroup("studio-", "position"),
      dim: optionGroup("studio-", "dim"),
      blur: optionGroup("studio-", "blur"),
      sidebarShade: optionGroup("studio-", "panel-sidebar"),
      chatShade: optionGroup("studio-", "panel-chat"),
    },
    editor: {
      present: Boolean(editor),
      statusText: editorStatus ? (editorStatus.textContent || "").trim() : null,
      saveDisabled: editorSave ? Boolean(editorSave.disabled) : null,
    },
    studioSection: (() => {
      const active = [...document.querySelectorAll('[data-testid^="studio-section-tab-"]')].find(
        (tab) => tab.getAttribute("aria-selected") === "true",
      );
      return active
        ? (active.getAttribute("data-testid") || "").replace("studio-section-tab-", "")
        : null;
    })(),
    extensionsPage: Boolean(document.querySelector('[data-testid="extensions-page"]')),
  };
})()`;

/** The picture the fixture is expected to be stored as (name only; hash varies). */
const FIXTURE_RE = /^[a-z0-9][a-z0-9-]{0,79}\.(png|jpe?g|webp|gif)$/;

async function main() {
  if (!world) throw new Error("LQ_BACKGROUND_WORLD is required");
  if (!fs.existsSync(FIXTURE)) throw new Error(`missing fixture: ${FIXTURE}`);
  fs.mkdirSync(artifactsDir, { recursive: true });

  const profileDir = path.join(world, "profile");
  const vaultDir = path.join(world, "vault");
  const hermesHome = path.join(world, "hermes-home");
  const binDir = path.join(world, "bin");
  const themesDir = path.join(profileDir, "themes");
  const backgroundsDir = path.join(profileDir, "backgrounds");

  // ── The world ────────────────────────────────────────────────────────────
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(hermesHome, { recursive: true });
  writeHermesStub(binDir);

  let vaultId;
  if (fs.existsSync(path.join(vaultDir, "lifequest.json"))) {
    vaultId = JSON.parse(fs.readFileSync(path.join(vaultDir, "lifequest.json"), "utf8")).id;
  } else {
    fs.mkdirSync(vaultDir, { recursive: true });
    const created = await createVault(vaultDir, "Background Ridge");
    if (!created.ok) throw new Error(`createVault: ${created.error}`);
    vaultId = created.value.lifequest.id;
  }

  fs.writeFileSync(
    path.join(profileDir, "recent.json"),
    `${JSON.stringify(
      {
        recent: [
          {
            id: vaultId,
            name: "Background Ridge",
            path: vaultDir,
            lastOpenedAt: new Date().toISOString(),
          },
        ],
        activeDomainByVaultId: {},
        deadlineDismissedOnByVaultId: {},
        deadlineNotifiedOnByVaultId: {},
        companionProfile: "lq-background-probe",
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
  // The picker seam. The product main process reads LIFEQUEST_E2E at import
  // time, so the queued sources must be set before `bootForE2e` is imported.
  // `theme:pickBackground` shifts one source per call while the seam is active:
  // the Settings "Choose picture…" and the studio's picture row are the two
  // real buttons this rig presses; the third is spare so a stray click cannot
  // fall through to a native dialog.
  process.env.LIFEQUEST_E2E = JSON.stringify({
    userData: profileDir,
    showWindow: true,
    mcpPorts: { local: mcpLocal, invite: mcpInvite },
    themeBackgroundSources: [FIXTURE, FIXTURE, FIXTURE],
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

  const installErrorListeners = () =>
    evaluate(`(() => {
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

  const until = async (expression, timeout = 12_000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if ((await evaluate(expression)) === true) return true;
      await sleep(120);
    }
    return false;
  };

  const waitFor = async (predicate, timeout = 15_000) => {
    const deadline = Date.now() + timeout;
    let last = null;
    while (Date.now() < deadline) {
      last = await evaluate(SAMPLE);
      if (predicate(last)) return last;
      await sleep(100);
    }
    return last;
  };

  const click = (testId) =>
    evaluate(`(() => {
      const el = document.querySelector('[data-testid="${testId}"]');
      if (!el) return false;
      el.click();
      return true;
    })()`);

  const openAppearance = async () => {
    const opened = await evaluate(`(() => {
      const trigger = document.querySelector(".settings-menu__trigger");
      if (!trigger) return false;
      trigger.click();
      return true;
    })()`);
    if (!opened) return false;
    for (let i = 0; i < 120; i += 1) {
      const ready = await evaluate(`(() => {
        if (document.querySelector('[data-testid="theme-background"]')) return true;
        const item = [...document.querySelectorAll(".settings-nav-item")].find((el) =>
          (el.textContent ?? "").includes("Appearance"),
        );
        if (item) item.click();
        return false;
      })()`);
      if (ready) return true;
      await sleep(150);
    }
    return false;
  };

  const leaveSettings = async () => {
    await evaluate(`(() => { location.hash = "#/home"; return location.hash; })()`);
    return waitFor((s) => s.shell === true && s.settings.section === false, 12_000);
  };

  const reload = async () => {
    win.webContents.reload();
    await new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
    const upAgain = await waitFor((s) => s.shell === true, 40_000);
    if (!upAgain?.shell) throw new Error("the shell never came back after a reload");
    await installErrorListeners();
    return upAgain;
  };

  // ── Boot ─────────────────────────────────────────────────────────────────
  const bootDeadline = Date.now() + 60_000;
  let up = null;
  while (Date.now() < bootDeadline) {
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
      path.join(artifactsDir, "theme-background-debug.json"),
      `${JSON.stringify(debug, null, 2)}\n`,
    );
    const debugShot = await win.webContents.capturePage().catch(() => null);
    if (debugShot) {
      fs.writeFileSync(path.join(artifactsDir, "theme-background-debug.png"), debugShot.toPNG());
    }
    throw new Error(`the app shell never mounted: ${JSON.stringify(debug)}`);
  }
  await installErrorListeners();

  const baseline = await waitFor((s) => s.shell === true && s.settings.section === false, 20_000);
  check(
    "the-app-starts-with-a-drawn-sky",
    baseline?.shell === true &&
      baseline.root.sceneBackdrop === "plain" &&
      baseline.layer === null &&
      baseline.picture === null,
    JSON.stringify({
      sceneBackdrop: baseline?.root.sceneBackdrop,
      layer: baseline?.layer?.preset,
      picture: Boolean(baseline?.picture),
    }),
  );

  // ── R2.1: a fresh profile is solid on both shell panels ─────────────────
  const freshRailAlpha = baseline?.panels?.rail?.alpha ?? 0;
  const freshChatAlpha = baseline?.panels?.chatPanel?.alpha ?? 0;
  check(
    "a-fresh-shell-is-solid-on-both-panels",
    baseline?.shell === true &&
      baseline.panels.sidebar === "solid" &&
      baseline.panels.chat === "solid" &&
      freshRailAlpha >= 0.99 &&
      freshChatAlpha >= 0.99 &&
      baseline.panels.sidebarVeil === "100%" &&
      baseline.panels.chatVeil === "100%",
    JSON.stringify({
      datasets: {
        sidebar: baseline?.panels?.sidebar,
        chat: baseline?.panels?.chat,
      },
      veils: {
        sidebar: baseline?.panels?.sidebarVeil,
        chat: baseline?.panels?.chatVeil,
      },
      rail: baseline?.panels?.rail,
      chatPanel: baseline?.panels?.chatPanel,
    }),
  );

  // ── 1: Settings → Appearance has the Background section ─────────────────
  const appearanceOpened = await openAppearance();
  const appearance = await waitFor(
    (s) => s.settings.section === true && s.settings.choose === true,
    15_000,
  );
  const noPictureYet = appearance?.settings.pictureName === null;
  const axesInert = ["fit", "position", "dim", "blur"].every(
    (axis) => appearance?.settings[axis]?.disabled === true,
  );
  check(
    "the-appearance-page-shows-the-background-section",
    appearanceOpened === true &&
      appearance?.settings.section === true &&
      (appearance.settings.title ?? "").toLowerCase().includes("background") &&
      noPictureYet === true &&
      appearance.settings.choose === true &&
      appearance.settings.remove === false &&
      appearance.settings.fit !== null &&
      appearance.settings.position !== null &&
      appearance.settings.dim !== null &&
      appearance.settings.blur !== null &&
      axesInert === true,
    JSON.stringify({
      title: appearance?.settings.title,
      choose: appearance?.settings.choose,
      pictureName: appearance?.settings.pictureName,
      axesDisabled: ["fit", "position", "dim", "blur"].map(
        (axis) => appearance?.settings[axis]?.disabled,
      ),
    }),
  );

  // ── 2: choose the picture through the real button ───────────────────────
  const choosePressed = await click("background-choose");
  let storedName = null;
  for (let i = 0; i < 150; i += 1) {
    if (fs.existsSync(backgroundsDir)) {
      const files = fs.readdirSync(backgroundsDir).filter((file) => FIXTURE_RE.test(file));
      if (files.length === 1) {
        storedName = files[0];
        break;
      }
    }
    await sleep(100);
  }
  const fixtureBytes = fs.readFileSync(FIXTURE);
  const storedBytes = storedName
    ? fs.readFileSync(path.join(backgroundsDir, storedName))
    : null;
  const worn = await waitFor(
    (s) =>
      s.layer !== null &&
      s.layer.preset === "image" &&
      (s.picture?.url ?? "").startsWith("blob:") &&
      s.root.sceneBackdrop === "image",
    20_000,
  );
  check(
    "the-picture-is-copied-and-the-shell-wears-it",
    choosePressed === true &&
      storedName !== null &&
      storedBytes !== null &&
      storedBytes.equals(fixtureBytes) === true &&
      worn?.layer?.preset === "image" &&
      worn.root.sceneBackdrop === "image" &&
      (worn.picture?.url ?? "").startsWith("blob:") === true &&
      (worn.settings.pictureName ?? "").includes(FIXTURE_NAME) === true &&
      worn.settings.remove === true &&
      worn.root.sceneImageFit === "cover" &&
      worn.root.sceneImagePosition === "center" &&
      worn.root.sceneImageDim === "soft" &&
      worn.root.sceneImageBlur === "none" &&
      worn.layer.imageFit === "cover" &&
      worn.layer.imagePosition === "center" &&
      worn.layer.imageDim === "soft" &&
      worn.layer.imageBlur === "none" &&
      worn.picture?.size === "cover" &&
      worn.picture?.filter === "none",
    JSON.stringify({
      choosePressed,
      storedName,
      sameBytes: Boolean(storedBytes && storedBytes.equals(fixtureBytes)),
      layer: worn?.layer,
      pictureUrl: (worn?.picture?.url ?? "").slice(0, 24),
      picture: worn?.picture,
      remove: worn?.settings.remove,
      axes: {
        fit: worn?.root.sceneImageFit,
        position: worn?.root.sceneImagePosition,
        dim: worn?.root.sceneImageDim,
        blur: worn?.root.sceneImageBlur,
      },
      pictureName: worn?.settings.pictureName,
    }),
  );

  // ── 3: every axis repaints; the row says "yours" ────────────────────────
  // One pick at a time, each confirmed by its paint: the controls emit the whole
  // image object, so a second click fired before React committed the first would
  // legitimately overwrite it (last pick wins) and make the rig's own timing the
  // variable under test.
  const fitPressed = await click("background-option-fit-contain");
  const fitPainted = fitPressed
    ? await waitFor((s) => s.root.sceneImageFit === "contain" && s.settings.fit?.active === "fit-contain", 10_000)
    : null;
  const positionPressed = fitPainted
    ? await click("background-option-position-top")
    : false;
  const positionPainted = positionPressed
    ? await waitFor(
        (s) => s.root.sceneImagePosition === "top" && s.settings.position?.active === "position-top",
        10_000,
      )
    : null;
  const dimPressed = positionPainted ? await click("background-option-dim-none") : false;
  const dimPainted = dimPressed
    ? await waitFor((s) => s.root.sceneImageDim === "none" && s.settings.dim?.active === "dim-none", 10_000)
    : null;
  const blurPressed = dimPainted ? await click("background-option-blur-soft") : false;
  const blurPainted = blurPressed
    ? await waitFor(
        (s) =>
          s.root.sceneImageBlur === "soft" &&
          s.settings.blur?.active === "blur-soft" &&
          s.picture?.filter !== "none",
        10_000,
      )
    : null;
  const axesChanged = await waitFor(
    (s) =>
      s.root.sceneImageFit === "contain" &&
      s.root.sceneImagePosition === "top" &&
      s.root.sceneImageDim === "none" &&
      s.root.sceneImageBlur === "soft" &&
      s.layer?.imageFit === "contain" &&
      s.layer.imagePosition === "top" &&
      s.layer.imageDim === "none" &&
      s.layer.imageBlur === "soft" &&
      s.settings.fit?.active === "fit-contain" &&
      s.settings.position?.active === "position-top" &&
      s.settings.dim?.active === "dim-none" &&
      s.settings.blur?.active === "blur-soft" &&
      s.settings.yours === true &&
      s.settings.reset?.disabled === false,
    15_000,
  );
  // Return the fit to cover for the hero shot: a wallpaper should fill the
  // frame, and the repaint in this direction is proof the control is live too.
  const coverPressed = await click("background-option-fit-cover");
  const coverAgain = coverPressed
    ? await waitFor(
        (s) => s.root.sceneImageFit === "cover" && s.settings.fit?.active === "fit-cover",
        12_000,
      )
    : null;
  check(
    "fit-position-dim-blur-repaint-the-layer",
    fitPressed === true &&
      fitPainted !== null &&
      positionPressed === true &&
      positionPainted !== null &&
      dimPressed === true &&
      dimPainted !== null &&
      blurPressed === true &&
      blurPainted !== null &&
      coverPressed === true &&
      axesChanged?.root.sceneImageFit === "contain" &&
      axesChanged.root.sceneImagePosition === "top" &&
      axesChanged.root.sceneImageDim === "none" &&
      axesChanged.root.sceneImageBlur === "soft" &&
      axesChanged.layer?.imageFit === "contain" &&
      axesChanged.layer?.imagePosition === "top" &&
      axesChanged.picture?.filter !== "none" &&
      coverAgain?.root.sceneImageFit === "cover" &&
      coverAgain.root.sceneImagePosition === "top" &&
      coverAgain.root.sceneImageDim === "none" &&
      coverAgain.root.sceneImageBlur === "soft" &&
      coverAgain.settings.yours === true &&
      coverAgain.settings.reset?.disabled === false &&
      coverAgain.settings.fit?.active === "fit-cover",
    JSON.stringify({
      pressed: { fitPressed, positionPressed, dimPressed, blurPressed, coverPressed },
      during: axesChanged
        ? {
            axes: {
              fit: axesChanged.root.sceneImageFit,
              position: axesChanged.root.sceneImagePosition,
              dim: axesChanged.root.sceneImageDim,
              blur: axesChanged.root.sceneImageBlur,
            },
            filter: axesChanged.picture?.filter,
            layer: {
              imageFit: axesChanged.layer?.imageFit,
              imagePosition: axesChanged.layer?.imagePosition,
            },
            active: {
              fit: axesChanged.settings.fit?.active,
              position: axesChanged.settings.position?.active,
              dim: axesChanged.settings.dim?.active,
              blur: axesChanged.settings.blur?.active,
            },
            yours: axesChanged.settings.yours,
          }
        : null,
      after: coverAgain
        ? {
            fit: coverAgain.root.sceneImageFit,
            position: coverAgain.root.sceneImagePosition,
            dim: coverAgain.root.sceneImageDim,
            blur: coverAgain.root.sceneImageBlur,
            filter: coverAgain.picture?.filter,
            active: coverAgain.settings.fit?.active,
            yours: coverAgain.settings.yours,
            resetDisabled: coverAgain.settings.reset?.disabled,
          }
        : null,
    }),
  );
  // Frame the artifact on the section under test: Background is the third card
  // in the Appearance stack, so a settings sheet left at the top would photograph
  // Material and Scene and not the picture rows.
  await evaluate(`(() => {
    const panel = document.querySelector('[data-testid="theme-background"]');
    if (!panel) return false;
    panel.scrollIntoView({ block: "center" });
    return true;
  })()`);
  await sleep(500);
  const settingsShot = await win.webContents.capturePage();
  fs.writeFileSync(SETTINGS_PNG, settingsShot.toPNG());

  // ── 4: the shell outside the settings sheet (the hero shot) ─────────────
  const leftSettings = await leaveSettings();
  await sleep(900);
  const appShot = await win.webContents.capturePage();
  fs.writeFileSync(APP_PNG, appShot.toPNG());
  check(
    "the-app-wears-the-picture-outside-settings",
    leftSettings?.shell === true &&
      leftSettings.settings.section === false &&
      leftSettings.layer?.preset === "image" &&
      leftSettings.root.sceneBackdrop === "image" &&
      (leftSettings.picture?.url ?? "").startsWith("blob:") &&
      leftSettings.pageVisible === true,
    JSON.stringify({
      hash: leftSettings?.hash,
      layer: leftSettings?.layer?.preset,
      picture: (leftSettings?.picture?.url ?? "").slice(0, 24),
      pageVisible: leftSettings?.pageVisible,
    }),
  );

  // ── R2.2/R2.3: the two panel shades in Settings ─────────────────────────
  // The rows are always live — the shade applies to whatever backdrop is set —
  // and picking Clear on the sidebar must make the rail paint exactly the
  // backdrop behind it, while Heavy leaves the chat bar ~80% opaque.
  const panelAppearanceOpened = await openAppearance();
  const panelRows = panelAppearanceOpened
    ? await waitFor(
        (s) =>
          s.settings.section === true &&
          s.settings.sidebarShade !== null &&
          s.settings.chatShade !== null &&
          s.settings.sidebarShade.options.length === 5 &&
          s.settings.chatShade.options.length === 5,
        15_000,
      )
    : null;
  const expectedPanelOptions =
    "panel-sidebar-solid,panel-sidebar-heavy,panel-sidebar-medium,panel-sidebar-light,panel-sidebar-clear";
  const sidebarClearPressed = panelRows
    ? await click("background-option-panel-sidebar-clear")
    : false;
  const sidebarClear = sidebarClearPressed
    ? await waitFor(
        (s) =>
          s.root.scenePanelSidebar === "clear" &&
          s.settings.sidebarShade?.active === "panel-sidebar-clear" &&
          (s.panels.rail?.alpha ?? 1) <= 0.02 &&
          s.panels.sidebarVeil === "0%",
        10_000,
      )
    : null;
  const chatHeavyPressed = sidebarClear
    ? await click("background-option-panel-chat-heavy")
    : false;
  const chatHeavy = chatHeavyPressed
    ? await waitFor(
        (s) =>
          s.root.scenePanelChat === "heavy" &&
          s.settings.chatShade?.active === "panel-chat-heavy" &&
          (s.panels.chatPanel?.alpha ?? 1) >= 0.75 &&
          (s.panels.chatPanel?.alpha ?? 1) <= 0.85 &&
          s.panels.chatVeil === "80%",
        10_000,
      )
    : null;
  check(
    "settings-shades-the-sidebar-and-chat-bar",
    panelAppearanceOpened === true &&
      panelRows?.settings.sidebarShade?.options.join(",") === expectedPanelOptions &&
      panelRows.settings.chatShade?.options.join(",") ===
        "panel-chat-solid,panel-chat-heavy,panel-chat-medium,panel-chat-light,panel-chat-clear" &&
      panelRows.settings.sidebarYours === false &&
      panelRows.settings.chatYours === false &&
      sidebarClearPressed === true &&
      sidebarClear !== null &&
      sidebarClear.settings.sidebarYours === true &&
      sidebarClear.root.scenePanelSidebar === "clear" &&
      typeof sidebarClear.panels.rail?.color === "string" &&
      chatHeavyPressed === true &&
      chatHeavy !== null &&
      chatHeavy.settings.chatYours === true &&
      chatHeavy.root.scenePanelChat === "heavy",
    JSON.stringify({
      rows: panelRows
        ? {
            sidebar: panelRows.settings.sidebarShade,
            chat: panelRows.settings.chatShade,
            yoursAtStart: {
              sidebar: panelRows.settings.sidebarYours,
              chat: panelRows.settings.chatYours,
            },
          }
        : null,
      afterSidebar: sidebarClear
        ? {
            dataset: sidebarClear.root.scenePanelSidebar,
            veil: sidebarClear.panels.sidebarVeil,
            railColor: sidebarClear.panels.rail?.color,
            railAlpha: sidebarClear.panels.rail?.alpha,
            yours: sidebarClear.settings.sidebarYours,
          }
        : null,
      afterChat: chatHeavy
        ? {
            dataset: chatHeavy.root.scenePanelChat,
            veil: chatHeavy.panels.chatVeil,
            chatColor: chatHeavy.panels.chatPanel?.color,
            chatAlpha: chatHeavy.panels.chatPanel?.alpha,
            yours: chatHeavy.settings.chatYours,
          }
        : null,
    }),
  );

  // ── R2.3: both panels clear — the wallpaper runs behind rail and dock ───
  const chatClearPressed = chatHeavy
    ? await click("background-option-panel-chat-clear")
    : false;
  const bothClear = chatClearPressed
    ? await waitFor(
        (s) =>
          s.root.scenePanelSidebar === "clear" &&
          s.root.scenePanelChat === "clear" &&
          (s.panels.rail?.alpha ?? 1) <= 0.02 &&
          (s.panels.chatPanel?.alpha ?? 1) <= 0.02 &&
          s.panels.sidebarVeil === "0%" &&
          s.panels.chatVeil === "0%",
        10_000,
      )
    : null;
  await leaveSettings();
  await sleep(900);
  const clearPanelsShot = await win.webContents.capturePage();
  fs.writeFileSync(CLEAR_PANELS_PNG, clearPanelsShot.toPNG());
  const clearPanels = await evaluate(SAMPLE);
  const clearState = bothClear ? clearPanels : null;
  const clearSceneParent = (clearState?.panels?.sceneParentClass ?? "").split(" ");
  const clearRect = clearState?.panels?.sceneRect ?? null;
  const clearRailRect = clearState?.panels?.railRect ?? null;
  const clearChatRect = clearState?.panels?.chatRect ?? null;
  const clearShellRect = clearState?.panels?.shellRect ?? null;
  const spansShell =
    clearSceneParent.includes("shell") &&
    Boolean(clearRect && clearRailRect && clearChatRect && clearShellRect) &&
    clearRect.left <= clearRailRect.left &&
    clearRect.right >= clearChatRect.right &&
    clearRect.width >= clearShellRect.width - 2;
  check(
    "clear-panels-show-the-wallpaper-through-the-shell",
    bothClear !== null &&
      clearState?.root.scenePanelSidebar === "clear" &&
      clearState.root.scenePanelChat === "clear" &&
      (clearState.panels.rail?.alpha ?? 1) <= 0.02 &&
      (clearState.panels.chatPanel?.alpha ?? 1) <= 0.02 &&
      spansShell === true &&
      clearState.settings.section === false &&
      (clearState.picture?.url ?? "").startsWith("blob:") === true &&
      clearState.layer?.preset === "image",
    JSON.stringify({
      sceneParent: clearState?.panels?.sceneParentClass ?? null,
      sceneRect: clearRect,
      railRect: clearRailRect,
      chatRect: clearChatRect,
      shellRect: clearShellRect,
      spansShell,
      rail: clearState?.panels?.rail ?? null,
      chatPanel: clearState?.panels?.chatPanel ?? null,
      picture: (clearState?.picture?.url ?? "").slice(0, 24),
      layer: clearState?.layer?.preset,
    }),
  );

  // ── 5: reload keeps the operator's picture and axes ─────────────────────
  const beforeReload = await evaluate(SAMPLE);
  const firstUrl = beforeReload?.picture?.url ?? null;
  await reload();
  const afterReload = await waitFor(
    (s) =>
      s.layer?.preset === "image" &&
      (s.picture?.url ?? "").startsWith("blob:") &&
      s.root.sceneImageFit === "cover" &&
      s.root.sceneImagePosition === "top" &&
      s.root.sceneImageDim === "none" &&
      s.root.sceneImageBlur === "soft",
    30_000,
  );
  check(
    "the-picks-and-the-picture-survive-a-reload",
    afterReload?.layer?.preset === "image" &&
      afterReload.root.sceneBackdrop === "image" &&
      (afterReload.picture?.url ?? "").startsWith("blob:") === true &&
      (afterReload.picture?.url ?? "") !== (firstUrl ?? "") &&
      afterReload.root.sceneImageFit === "cover" &&
      afterReload.root.sceneImagePosition === "top" &&
      afterReload.root.sceneImageDim === "none" &&
      afterReload.root.sceneImageBlur === "soft",
    JSON.stringify({
      freshBlob: Boolean(firstUrl) && afterReload?.picture?.url !== firstUrl,
      axes: afterReload
        ? {
            fit: afterReload.root.sceneImageFit,
            position: afterReload.root.sceneImagePosition,
            dim: afterReload.root.sceneImageDim,
            blur: afterReload.root.sceneImageBlur,
          }
        : null,
      layer: afterReload?.layer?.preset,
      errors: afterReload?.errors,
    }),
  );

  // ── R2.4: the panel picks are the operator's, so a reload keeps them ────
  const panelsReloaded = await waitFor(
    (s) =>
      s.root.scenePanelSidebar === "clear" &&
      s.root.scenePanelChat === "clear" &&
      (s.panels.rail?.alpha ?? 1) <= 0.02 &&
      (s.panels.chatPanel?.alpha ?? 1) <= 0.02 &&
      s.panels.sidebarVeil === "0%" &&
      s.panels.chatVeil === "0%",
    20_000,
  );
  const panelsReloadedParent = (panelsReloaded?.panels?.sceneParentClass ?? "").split(" ");
  check(
    "panel-picks-survive-a-reload",
    panelsReloaded?.root.scenePanelSidebar === "clear" &&
      panelsReloaded.root.scenePanelChat === "clear" &&
      (panelsReloaded.panels.rail?.alpha ?? 1) <= 0.02 &&
      (panelsReloaded.panels.chatPanel?.alpha ?? 1) <= 0.02 &&
      panelsReloadedParent.includes("shell") &&
      (panelsReloaded.picture?.url ?? "").startsWith("blob:") === true,
    JSON.stringify({
      datasets: {
        sidebar: panelsReloaded?.root.scenePanelSidebar,
        chat: panelsReloaded?.root.scenePanelChat,
      },
      veils: {
        sidebar: panelsReloaded?.panels.sidebarVeil,
        chat: panelsReloaded?.panels.chatVeil,
      },
      rail: panelsReloaded?.panels.rail ?? null,
      chatPanel: panelsReloaded?.panels.chatPanel ?? null,
      sceneParent: panelsReloaded?.panels.sceneParentClass ?? null,
      picture: (panelsReloaded?.picture?.url ?? "").slice(0, 24),
    }),
  );

  // ── 6: Reset to theme hands the picture back ────────────────────────────
  const resetOpened = await openAppearance();
  const resetReady = resetOpened
    ? await waitFor((s) => s.settings.section === true && s.settings.remove === true, 12_000)
    : null;
  const resetPressed = resetReady ? await click("background-reset") : false;
  const reset = await waitFor(
    (s) =>
      s.root.sceneBackdrop !== "image" &&
      s.root.sceneImageFit === null &&
      s.picture === null &&
      s.settings.choose === true &&
      s.settings.pictureName === null,
    15_000,
  );
  check(
    "reset-to-theme-hands-the-picture-back",
    resetReady !== null &&
      resetPressed === true &&
      reset?.root.sceneBackdrop !== "image" &&
      reset.root.sceneImageFit === null &&
      reset.root.sceneImagePosition === null &&
      reset.picture === null &&
      reset.layer?.preset !== "image" &&
      reset.settings.choose === true &&
      reset.settings.remove === false &&
      reset.settings.pictureName === null,
    JSON.stringify({
      resetPressed,
      sceneBackdrop: reset?.root.sceneBackdrop,
      layer: reset?.layer?.preset,
      picture: Boolean(reset?.picture),
      choose: reset?.settings.choose,
      errors: reset?.errors,
    }),
  );
  // R2.4: the section's one Reset hands the panel shades back with the picture.
  const resetPanelState = await waitFor(
    (s) =>
      s.root.scenePanelSidebar === "solid" &&
      s.root.scenePanelChat === "solid" &&
      (s.panels.rail?.alpha ?? 0) >= 0.99 &&
      (s.panels.chatPanel?.alpha ?? 0) >= 0.99,
    12_000,
  );
  check(
    "reset-restores-solid-panels",
    resetPanelState?.root.scenePanelSidebar === "solid" &&
      resetPanelState.root.scenePanelChat === "solid" &&
      (resetPanelState.panels.rail?.alpha ?? 0) >= 0.99 &&
      (resetPanelState.panels.chatPanel?.alpha ?? 0) >= 0.99 &&
      resetPanelState.panels.sidebarVeil === "100%" &&
      resetPanelState.panels.chatVeil === "100%" &&
      resetPanelState.settings.sidebarYours === false &&
      resetPanelState.settings.chatYours === false,
    JSON.stringify({
      datasets: {
        sidebar: resetPanelState?.root.scenePanelSidebar,
        chat: resetPanelState?.root.scenePanelChat,
      },
      veils: {
        sidebar: resetPanelState?.panels.sidebarVeil,
        chat: resetPanelState?.panels.chatVeil,
      },
      rail: resetPanelState?.panels.rail ?? null,
      chatPanel: resetPanelState?.panels.chatPanel ?? null,
      yours: {
        sidebar: resetPanelState?.settings.sidebarYours,
        chat: resetPanelState?.settings.chatYours,
      },
    }),
  );
  await leaveSettings();

  // ── 7: a theme file may carry the picture ───────────────────────────────
  const pictureThemeFile = "background-picture.json";
  fs.writeFileSync(
    path.join(themesDir, pictureThemeFile),
    `${JSON.stringify(
      {
        name: "background-picture",
        label: "Background Picture",
        description: "A scene theme that names the operator's picture.",
        scene: {
          background: {
            preset: "plain",
            image: {
              file: storedName,
              fit: "contain",
              position: "bottom",
              dim: "soft",
              blur: "none",
            },
            panels: { navRail: "clear", chat: "light" },
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  const panelPreview = await waitFor(
    (s) =>
      s.preview === true &&
      (s.previewText ?? "").includes(pictureThemeFile) &&
      s.root.scenePanelSidebar === "clear" &&
      s.root.scenePanelChat === "light" &&
      (s.panels.rail?.alpha ?? 1) <= 0.02 &&
      (s.panels.chatPanel?.alpha ?? 0) >= 0.3 &&
      (s.panels.chatPanel?.alpha ?? 0) <= 0.38 &&
      s.panels.sidebarVeil === "0%" &&
      s.panels.chatVeil === "34%",
    15_000,
  );
  const picturePreview = await waitFor(
    (s) =>
      s.preview === true &&
      (s.previewText ?? "").includes(pictureThemeFile) &&
      s.layer?.preset === "image" &&
      s.root.sceneBackdrop === "image" &&
      s.root.sceneImageFit === "contain" &&
      s.root.sceneImagePosition === "bottom" &&
      s.root.sceneImageDim === "soft" &&
      (s.picture?.url ?? "").startsWith("blob:"),
    25_000,
  );
  check(
    "a-theme-file-can-carry-the-picture",
    picturePreview?.preview === true &&
      (picturePreview.previewText ?? "").includes(pictureThemeFile) &&
      picturePreview.layer?.preset === "image" &&
      picturePreview.layer?.imageFit === "contain" &&
      picturePreview.layer?.imagePosition === "bottom" &&
      picturePreview.layer?.imageDim === "soft" &&
      picturePreview.root.sceneImageFit === "contain" &&
      picturePreview.root.sceneImageBlur === "none" &&
      (picturePreview.picture?.url ?? "").startsWith("blob:") &&
      picturePreview.settings.section === false,
    JSON.stringify({
      preview: picturePreview?.previewText,
      layer: picturePreview?.layer,
      axes: picturePreview
        ? {
            fit: picturePreview.root.sceneImageFit,
            position: picturePreview.root.sceneImagePosition,
            dim: picturePreview.root.sceneImageDim,
          }
        : null,
      errors: picturePreview?.errors,
    }),
  );

  const keepPictureTheme = await click("theme-keep");
  const pictureKept = await waitFor(
    (s) => s.keptFile === pictureThemeFile && s.preview === false && s.layer?.preset === "image",
    15_000,
  );
  await reload();
  const pictureReloaded = await waitFor(
    (s) =>
      s.keptFile === pictureThemeFile &&
      s.layer?.preset === "image" &&
      s.root.sceneImageFit === "contain" &&
      s.root.sceneImagePosition === "bottom" &&
      (s.picture?.url ?? "").startsWith("blob:"),
    30_000,
  );
  check(
    "a-picture-theme-keeps-across-a-reload",
    keepPictureTheme === true &&
      pictureKept?.keptFile === pictureThemeFile &&
      pictureKept.layer?.preset === "image" &&
      pictureReloaded?.keptFile === pictureThemeFile &&
      pictureReloaded.layer?.preset === "image" &&
      pictureReloaded.root.sceneImageFit === "contain" &&
      pictureReloaded.root.sceneImagePosition === "bottom" &&
      (pictureReloaded.picture?.url ?? "").startsWith("blob:"),
    JSON.stringify({
      keepPressed: keepPictureTheme,
      kept: pictureKept?.keptFile,
      reloadedKept: pictureReloaded?.keptFile,
      layer: pictureReloaded?.layer?.preset,
      axes: pictureReloaded
        ? {
            fit: pictureReloaded.root.sceneImageFit,
            position: pictureReloaded.root.sceneImagePosition,
          }
        : null,
      errors: pictureReloaded?.errors,
    }),
  );

  // R2.5: the theme file's panel shades survived Keep and the reload, and the
  // profile file the app parsed still names them.
  const panelReloaded = await waitFor(
    (s) =>
      s.keptFile === pictureThemeFile &&
      s.root.scenePanelSidebar === "clear" &&
      s.root.scenePanelChat === "light" &&
      (s.panels.rail?.alpha ?? 1) <= 0.02 &&
      (s.panels.chatPanel?.alpha ?? 0) >= 0.3 &&
      (s.panels.chatPanel?.alpha ?? 0) <= 0.38,
    20_000,
  );
  let pictureThemeOnDisk = null;
  try {
    pictureThemeOnDisk = JSON.parse(
      fs.readFileSync(path.join(themesDir, pictureThemeFile), "utf8"),
    );
  } catch {
    pictureThemeOnDisk = null;
  }
  check(
    "a-theme-file-can-shade-the-panels",
    panelPreview?.root.scenePanelSidebar === "clear" &&
      panelPreview.root.scenePanelChat === "light" &&
      (panelPreview.panels.rail?.alpha ?? 1) <= 0.02 &&
      (panelPreview.panels.chatPanel?.alpha ?? 0) >= 0.3 &&
      (panelPreview.panels.chatPanel?.alpha ?? 0) <= 0.38 &&
      panelPreview.panels.sidebarVeil === "0%" &&
      panelPreview.panels.chatVeil === "34%" &&
      pictureKept?.keptFile === pictureThemeFile &&
      pictureReloaded?.keptFile === pictureThemeFile &&
      panelReloaded?.keptFile === pictureThemeFile &&
      panelReloaded.root.scenePanelSidebar === "clear" &&
      panelReloaded.root.scenePanelChat === "light" &&
      pictureThemeOnDisk?.scene?.background?.panels?.navRail === "clear" &&
      pictureThemeOnDisk?.scene?.background?.panels?.chat === "light",
    JSON.stringify({
      preview: panelPreview
        ? {
            datasets: {
              sidebar: panelPreview.root.scenePanelSidebar,
              chat: panelPreview.root.scenePanelChat,
            },
            veils: {
              sidebar: panelPreview.panels.sidebarVeil,
              chat: panelPreview.panels.chatVeil,
            },
            rail: panelPreview.panels.rail,
            chatPanel: panelPreview.panels.chatPanel,
          }
        : null,
      reloaded: panelReloaded
        ? {
            datasets: {
              sidebar: panelReloaded.root.scenePanelSidebar,
              chat: panelReloaded.root.scenePanelChat,
            },
            rail: panelReloaded.panels.rail,
            chatPanel: panelReloaded.panels.chatPanel,
          }
        : null,
      onDisk: pictureThemeOnDisk?.scene?.background?.panels ?? null,
    }),
  );

  // ── 8: the two new procedural skies ─────────────────────────────────────
  fs.writeFileSync(
    path.join(themesDir, "horizon-sky.json"),
    `${JSON.stringify(
      { name: "horizon-sky", label: "Horizon Sky", scene: { background: { preset: "horizon" } } },
      null,
      2,
    )}\n`,
  );
  const horizon = await waitFor(
    (s) =>
      s.preview === true &&
      (s.previewText ?? "").includes("horizon-sky.json") &&
      s.layer?.preset === "horizon" &&
      (s.layer.className ?? "").includes("scene-backdrop--horizon"),
    25_000,
  );
  await sleep(500);
  const horizonShot = await win.webContents.capturePage();
  fs.writeFileSync(HORIZON_PNG, horizonShot.toPNG());
  check(
    "the-horizon-sky-paints",
    horizon?.layer?.preset === "horizon" &&
      (horizon.layer?.className ?? "").includes("scene-backdrop--horizon") &&
      (horizon.layer?.nodes ?? 0) > 0 &&
      horizon.root.sceneBackdrop === "horizon",
    JSON.stringify({
      preview: horizon?.previewText,
      layer: horizon?.layer,
      errors: horizon?.errors,
    }),
  );

  const keepHorizon = await click("theme-keep");
  const horizonKept = await waitFor((s) => s.keptFile === "horizon-sky.json", 15_000);

  fs.writeFileSync(
    path.join(themesDir, "mesh-sky.json"),
    `${JSON.stringify(
      { name: "mesh-sky", label: "Mesh Sky", scene: { background: { preset: "mesh" } } },
      null,
      2,
    )}\n`,
  );
  const mesh = await waitFor(
    (s) =>
      s.preview === true &&
      (s.previewText ?? "").includes("mesh-sky.json") &&
      s.layer?.preset === "mesh" &&
      (s.layer.className ?? "").includes("scene-backdrop--mesh"),
    25_000,
  );
  const keepMesh = await click("theme-keep");
  const meshKept = await waitFor((s) => s.keptFile === "mesh-sky.json", 15_000);
  check(
    "the-mesh-sky-paints",
    keepHorizon === true &&
      horizonKept?.keptFile === "horizon-sky.json" &&
      mesh?.layer?.preset === "mesh" &&
      (mesh.layer?.className ?? "").includes("scene-backdrop--mesh") &&
      (mesh.layer?.nodes ?? 0) > 0 &&
      mesh.root.sceneBackdrop === "mesh" &&
      keepMesh === true &&
      meshKept?.keptFile === "mesh-sky.json",
    JSON.stringify({
      horizon: horizonKept?.keptFile,
      meshPreview: mesh?.previewText,
      layer: mesh?.layer,
      kept: meshKept?.keptFile,
      errors: mesh?.errors,
    }),
  );

  const skiesOpened = await openAppearance();
  const skyRow = skiesOpened
    ? await waitFor(
        (s) =>
          s.settings.presetOptions !== null &&
          s.settings.presetOptions.includes("preset-horizon") &&
          s.settings.presetOptions.includes("preset-mesh"),
        12_000,
      )
    : null;
  check(
    "settings-offers-both-new-skies",
    skiesOpened === true &&
      skyRow?.settings.presetOptions?.includes("preset-horizon") === true &&
      skyRow?.settings.presetOptions?.includes("preset-mesh") === true &&
      (skyRow?.settings.presetLabels ?? []).some((label) => label === "Horizon") &&
      (skyRow?.settings.presetLabels ?? []).some((label) => label === "Mesh"),
    JSON.stringify({
      options: skyRow?.settings.presetOptions,
      labels: skyRow?.settings.presetLabels,
    }),
  );
  await leaveSettings();

  // ── 9: the Extensions studio authors the picture ────────────────────────
  await evaluate(`(() => { location.hash = "#/extensions"; return location.hash; })()`);
  const extensionsPage = await until(
    `Boolean(document.querySelector('[data-testid="extensions-page"]'))`,
    20_000,
  );
  const studioFile = "rig-background.json";
  const studioPath = path.join(themesDir, studioFile);
  fs.writeFileSync(
    studioPath,
    `${JSON.stringify(
      { name: "rig-background", label: "Rig Background", material: { radius: "soft" } },
      null,
      2,
    )}\n`,
  );
  const studioRow = await until(
    `Boolean(document.querySelector('[data-testid="extension-rig-background"]'))`,
    15_000,
  );
  const openStudioEditor = async () => {
    const clicked = await evaluate(`(() => {
      const el = document.querySelector('[data-testid="extension-rig-background"] [data-testid="extension-edit"]');
      if (!el) return false;
      el.click();
      return true;
    })()`);
    if (!clicked) return false;
    if (!(await until(`Boolean(document.querySelector('[data-testid="extension-editor"]'))`, 10_000))) {
      return false;
    }
    await evaluate(`(() => {
      const tab = document.querySelector('[data-testid="extension-editor-tab-fields"]');
      if (tab && tab.getAttribute("aria-selected") !== "true") tab.click();
      return true;
    })()`);
    return until(`Boolean(document.querySelector('[data-testid="extension-studio"]'))`, 10_000);
  };
  const studioOpened = await openStudioEditor();
  const sceneTab = studioOpened
    ? await (async () => {
        const clicked = await click("studio-section-tab-scene");
        if (!clicked) return false;
        return until(
          `Boolean(document.querySelector('[data-testid="studio-scene"]')) && Boolean(document.querySelector('[data-testid="studio-background-panel"]'))`,
          10_000,
        );
      })()
    : false;
  const studioRows = sceneTab
    ? await waitFor(
        (s) =>
          s.studio.panel === true &&
          s.studio.picture === true &&
          s.studio.choose === true &&
          s.studio.fit !== null &&
          s.studio.position !== null,
        12_000,
      )
    : null;
  const studioChoose = studioRows ? await click("studio-background-choose") : false;
  const studioDraft = studioChoose
    ? await waitFor(
        (s) =>
          (s.studio.pictureName ?? "").includes(FIXTURE_NAME) &&
          s.root.sceneBackdrop === "image" &&
          (s.picture?.url ?? "").startsWith("blob:"),
        15_000,
      )
    : null;
  // Same one-at-a-time rule as Settings: the controlled rows emit the whole
  // picture, so each draft pick must land before the next one is pressed.
  const studioFitPressed = studioDraft
    ? await click("studio-background-option-fit-contain")
    : false;
  const studioFitPainted = studioFitPressed
    ? await waitFor((s) => s.studio.fit?.active === "fit-contain", 10_000)
    : null;
  const studioPositionPressed = studioFitPainted
    ? await click("studio-background-option-position-bottom")
    : false;
  const studioAxes = studioPositionPressed
    ? await waitFor(
        (s) =>
          s.studio.fit?.active === "fit-contain" &&
          s.studio.position?.active === "position-bottom" &&
          s.root.sceneImageFit === "contain" &&
          s.root.sceneImagePosition === "bottom",
        12_000,
      )
    : null;
  // R2.5: the studio's two controlled panel rows. Picked one at a time; the
  // draft must paint each shade (the shell datasets move with it) before the
  // next pick, because each emits only its own axis for withScenePatch to merge.
  const studioPanelRows = studioAxes
    ? await waitFor(
        (s) =>
          s.studio.sidebarShade !== null &&
          s.studio.chatShade !== null &&
          s.studio.sidebarShade.options.length === 5 &&
          s.studio.chatShade.options.length === 5,
        12_000,
      )
    : null;
  const studioSidebarPressed = studioPanelRows
    ? await click("studio-background-option-panel-sidebar-clear")
    : false;
  const studioSidebarPainted = studioSidebarPressed
    ? await waitFor(
        (s) =>
          s.studio.sidebarShade?.active === "panel-sidebar-clear" &&
          s.root.scenePanelSidebar === "clear" &&
          (s.panels.rail?.alpha ?? 1) <= 0.02,
        10_000,
      )
    : null;
  const studioChatPressed = studioSidebarPainted
    ? await click("studio-background-option-panel-chat-medium")
    : false;
  const studioPanelsPicked = studioChatPressed
    ? await waitFor(
        (s) =>
          s.studio.sidebarShade?.active === "panel-sidebar-clear" &&
          s.studio.chatShade?.active === "panel-chat-medium" &&
          s.root.scenePanelSidebar === "clear" &&
          s.root.scenePanelChat === "medium" &&
          (s.panels.chatPanel?.alpha ?? 1) >= 0.5 &&
          (s.panels.chatPanel?.alpha ?? 1) <= 0.66,
        10_000,
      )
    : null;
  // Frame the artifact on the Scene tab's picture rows, not the strip top.
  if (studioPanelsPicked) {
    await evaluate(`(() => {
      const panel = document.querySelector('[data-testid="studio-background-panel"]');
      if (!panel) return false;
      const scroller = panel.closest(".shell__content");
      if (scroller) {
        const offset = panel.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        scroller.scrollTop += offset - 120;
      } else {
        panel.scrollIntoView({ block: "center" });
      }
      return true;
    })()`);
  }
  await sleep(500);
  const studioShot = await win.webContents.capturePage();
  fs.writeFileSync(STUDIO_PNG, studioShot.toPNG());
  const studioSaveReady = studioPanelsPicked
    ? await until(
        `(() => { const b = document.querySelector('[data-testid="studio-save"]'); return Boolean(b && !b.disabled); })()`,
        10_000,
      )
    : false;
  const studioSaved = studioSaveReady ? await click("studio-save") : false;
  const studioSavedPreview = studioSaved
    ? await waitFor(
        (s) => s.editor.present === false && (s.previewText ?? "").includes(studioFile),
        25_000,
      )
    : null;
  let savedStudio = null;
  for (let i = 0; i < 100; i += 1) {
    try {
      const parsed = JSON.parse(fs.readFileSync(studioPath, "utf8"));
      if (parsed?.scene?.background?.image) {
        savedStudio = parsed;
        break;
      }
    } catch {
      savedStudio = null;
    }
    await sleep(100);
  }
  const savedImage = savedStudio?.scene?.background?.image ?? null;
  const savedPanels = savedStudio?.scene?.background?.panels ?? null;
  check(
    "the-studio-authors-the-picture-and-saves-it",
    extensionsPage === true &&
      studioRow === true &&
      studioOpened === true &&
      sceneTab === true &&
      studioRows?.studio.panel === true &&
      studioRows?.studio.picture === true &&
      studioRows?.studio.choose === true &&
      studioRows?.studio.fit?.options.length === 3 &&
      studioChoose === true &&
      (studioDraft?.studio.pictureName ?? "").includes(FIXTURE_NAME) === true &&
      (studioDraft?.picture?.url ?? "").startsWith("blob:") === true &&
      studioFitPressed === true &&
      studioFitPainted !== null &&
      studioPositionPressed === true &&
      studioAxes?.studio.fit?.active === "fit-contain" &&
      studioAxes.studio.position?.active === "position-bottom" &&
      studioSaveReady === true &&
      studioSaved === true &&
      studioSavedPreview?.preview === true &&
      savedImage?.file === storedName &&
      savedImage?.fit === "contain" &&
      savedImage?.position === "bottom" &&
      savedImage?.dim === "soft" &&
      savedImage?.blur === "none",
    JSON.stringify({
      extensionsPage,
      studioRow,
      studioOpened,
      sceneTab,
      rows: studioRows?.studio ?? null,
      choose: studioChoose,
      draftName: studioDraft?.studio.pictureName,
      draftPictureUrl: (studioDraft?.picture?.url ?? "").slice(0, 24),
      draftAxes: studioAxes
        ? {
            fit: studioAxes.studio.fit?.active,
            position: studioAxes.studio.position?.active,
            rootFit: studioAxes.root.sceneImageFit,
            rootPosition: studioAxes.root.sceneImagePosition,
          }
        : null,
      fitPainted: studioFitPainted !== null,
      saveReady: studioSaveReady,
      saved: studioSaved,
      preview: studioSavedPreview?.previewText,
      savedImage,
      storedName,
    }),
  );
  check(
    "the-studio-authors-the-panel-shades",
    studioOpened === true &&
      studioPanelRows?.studio.sidebarShade?.options.length === 5 &&
      studioPanelRows.studio.chatShade?.options.length === 5 &&
      studioSidebarPressed === true &&
      studioSidebarPainted !== null &&
      studioChatPressed === true &&
      studioPanelsPicked !== null &&
      savedPanels?.navRail === "clear" &&
      savedPanels?.chat === "medium",
    JSON.stringify({
      rows: studioPanelRows
        ? {
            sidebar: studioPanelRows.studio.sidebarShade,
            chat: studioPanelRows.studio.chatShade,
          }
        : null,
      picked: studioPanelsPicked
        ? {
            sidebar: studioPanelsPicked.studio.sidebarShade?.active,
            chat: studioPanelsPicked.studio.chatShade?.active,
            rail: studioPanelsPicked.panels.rail,
            chatPanel: studioPanelsPicked.panels.chatPanel,
          }
        : null,
      savedPanels,
      savedStudio: savedStudio?.scene?.background ?? null,
    }),
  );
  // Hand the preview back: the drawn mesh theme returns for the last two checks.
  await click("theme-revert").catch(() => false);
  await sleep(300);

  // ── 10: a theme naming a missing picture falls back to its sky ──────────
  fs.writeFileSync(
    path.join(themesDir, "missing-picture.json"),
    `${JSON.stringify(
      {
        name: "missing-picture",
        label: "Missing Picture",
        scene: {
          background: {
            preset: "starfield",
            image: { file: "missing-wallpaper.png" },
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  const missing = await waitFor(
    (s) =>
      s.preview === true &&
      (s.previewText ?? "").includes("missing-picture.json") &&
      s.shell === true &&
      s.error === null &&
      // The read is in flight first (`loading` paints the empty image layer);
      // wait for the refused-read fallback itself, not for the request to start.
      s.layer?.preset === "starfield",
    25_000,
  );
  // The contract (as the Lead arbitrated it) says the drawn sky paints when the
  // picture's bytes are gone: the document keeps the `image` backdrop attribute
  // — a picture is still the theme's choice — but the layer falls through to the
  // theme's procedural preset, so a layer with `--starfield` and no picture span
  // is the shipped behaviour. An empty picture layer is the failure this catches.
  const missingDrawn =
    missing?.layer?.preset === "starfield" &&
    (missing?.layer?.className ?? "").includes("scene-backdrop--starfield") &&
    (missing?.layer?.nodes ?? 0) > 0;
  check(
    "a-missing-picture-falls-back-to-the-drawn-sky",
    missing?.preview === true &&
      (missing.previewText ?? "").includes("missing-picture.json") &&
      missing.shell === true &&
      missing.pageVisible === true &&
      missing.error === null &&
      missingDrawn === true &&
      (missing.picture?.url ?? null) === null,
    JSON.stringify({
      preview: missing?.previewText,
      sceneBackdrop: missing?.root.sceneBackdrop,
      layer: missing?.layer,
      drawn: missingDrawn,
      pictureUrl: missing?.picture?.url,
      error: missing?.error,
      errors: missing?.errors,
    }),
  );
  await click("theme-revert").catch(() => false);
  await sleep(300);

  // ── 11: an invalid picture is refused by name ───────────────────────────
  const invalidOpened = await openStudioEditor();
  const invalidJsonTab = invalidOpened
    ? await (async () => {
        const clicked = await click("extension-editor-tab-json");
        if (!clicked) return false;
        return until(
          `Boolean(document.querySelector('[data-testid="extension-editor-raw"]'))`,
          10_000,
        );
      })()
    : false;
  const setEditorSource = async (text) =>
    evaluate(`(() => {
      const area = document.querySelector('[data-testid="extension-editor-raw"]');
      if (!area) return false;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      ).set;
      setter.call(area, ${JSON.stringify(text)});
      area.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
  const baseDraft = JSON.parse(fs.readFileSync(studioPath, "utf8"));
  const escaping = JSON.parse(JSON.stringify(baseDraft));
  escaping.scene.background.image.file = "../escape.png";
  await setEditorSource(`${JSON.stringify(escaping, null, 2)}\n`);
  const escapeVerdict = await waitFor(
    (s) =>
      s.editor.present === true &&
      (s.editor.statusText ?? "").includes("scene.background.image.file") &&
      s.editor.saveDisabled === true,
    12_000,
  );
  const badFit = JSON.parse(JSON.stringify(baseDraft));
  badFit.scene.background.image.fit = "stretch";
  await setEditorSource(`${JSON.stringify(badFit, null, 2)}\n`);
  const fitVerdict = await waitFor(
    (s) =>
      s.editor.present === true &&
      (s.editor.statusText ?? "").includes("scene.background.image.fit") &&
      s.editor.saveDisabled === true,
    12_000,
  );
  // R2.5: the panel shades are validated by the same parser, naming the axis.
  const badPanel = JSON.parse(JSON.stringify(baseDraft));
  badPanel.scene.background.panels = {
    ...(badPanel.scene.background.panels ?? {}),
    chat: "translucent",
  };
  await setEditorSource(`${JSON.stringify(badPanel, null, 2)}\n`);
  const panelVerdict = await waitFor(
    (s) =>
      s.editor.present === true &&
      (s.editor.statusText ?? "").includes("scene.background.panels.chat") &&
      s.editor.saveDisabled === true,
    12_000,
  );
  // Close the editor; the draft (and its preview) must not have reached disk.
  const cancelEditor = await click("extension-editor-cancel");
  const editorClosed = cancelEditor
    ? await until(`!document.querySelector('[data-testid="extension-editor"]')`, 10_000)
    : false;
  const diskAfterRefusal = JSON.parse(fs.readFileSync(studioPath, "utf8"));
  check(
    "an-invalid-picture-is-refused-by-name",
    invalidOpened === true &&
      invalidJsonTab === true &&
      escapeVerdict?.editor.statusText?.includes("scene.background.image.file") === true &&
      escapeVerdict.editor.saveDisabled === true &&
      fitVerdict?.editor.statusText?.includes("scene.background.image.fit") === true &&
      fitVerdict.editor.saveDisabled === true &&
      cancelEditor === true &&
      editorClosed === true &&
      diskAfterRefusal?.scene?.background?.image?.file === storedName &&
      diskAfterRefusal?.scene?.background?.image?.fit === "contain",
    JSON.stringify({
      opened: invalidOpened,
      jsonTab: invalidJsonTab,
      escape: escapeVerdict?.editor,
      badFit: fitVerdict?.editor,
      cancelled: cancelEditor,
      closed: editorClosed,
      diskImage: diskAfterRefusal?.scene?.background?.image ?? null,
    }),
  );

  // ── 11b: the watcher refuses a written theme by the same field names ────
  fs.writeFileSync(
    path.join(themesDir, "refused-picture.json"),
    `${JSON.stringify(
      {
        name: "refused-picture",
        label: "Refused Picture",
        scene: { background: { image: { file: "../escape.png" } } },
      },
      null,
      2,
    )}\n`,
  );
  const escapeRefusal = await waitFor(
    (s) => s.error !== null && s.error.includes("scene.background.image.file"),
    20_000,
  );
  await click("theme-dismiss").catch(() => false);
  await sleep(250);
  fs.rmSync(path.join(themesDir, "refused-picture.json"), { force: true });
  await sleep(250);
  fs.writeFileSync(
    path.join(themesDir, "refused-fit.json"),
    `${JSON.stringify(
      {
        name: "refused-fit",
        label: "Refused Fit",
        scene: {
          background: { image: { file: storedName, fit: "stretch" } },
        },
      },
      null,
      2,
    )}\n`,
  );
  const fitRefusal = await waitFor(
    (s) => s.error !== null && s.error.includes("scene.background.image.fit"),
    20_000,
  );
  await click("theme-dismiss").catch(() => false);
  await sleep(250);
  fs.rmSync(path.join(themesDir, "refused-fit.json"), { force: true });
  await sleep(250);
  fs.writeFileSync(
    path.join(themesDir, "refused-panels.json"),
    `${JSON.stringify(
      {
        name: "refused-panels",
        label: "Refused Panels",
        scene: {
          background: { panels: { navRail: "solid", chat: "translucent" } },
        },
      },
      null,
      2,
    )}\n`,
  );
  const panelRefusal = await waitFor(
    (s) => s.error !== null && s.error.includes("scene.background.panels.chat"),
    20_000,
  );
  await click("theme-dismiss").catch(() => false);
  check(
    "the-watcher-refuses-an-invalid-picture-by-name",
    escapeRefusal?.error?.includes("scene.background.image.file") === true &&
      fitRefusal?.error?.includes("scene.background.image.fit") === true &&
      escapeRefusal.shell === true &&
      fitRefusal.shell === true,
    JSON.stringify({
      escape: escapeRefusal?.error,
      fit: fitRefusal?.error,
      shell: fitRefusal?.shell,
      errors: fitRefusal?.errors,
    }),
  );

  check(
    "an-invalid-panel-is-refused-by-name",
    panelVerdict?.editor.statusText?.includes("scene.background.panels.chat") === true &&
      panelVerdict.editor.saveDisabled === true &&
      panelRefusal?.error?.includes("scene.background.panels.chat") === true &&
      panelRefusal.shell === true &&
      diskAfterRefusal?.scene?.background?.panels?.navRail === "clear" &&
      diskAfterRefusal?.scene?.background?.panels?.chat === "medium",
    JSON.stringify({
      verdict: panelVerdict?.editor ?? null,
      watcher: panelRefusal?.error ?? null,
      diskPanels: diskAfterRefusal?.scene?.background?.panels ?? null,
    }),
  );

  // ── Round 3: the companion's own background tools, through the real door ─
  // Everything above wrote theme files with the rig's pen. These checks drive
  // the shipped MCP door instead: the picture store, the scene `get_theme`
  // reports, and a theme authored entirely through `write_theme`.
  //
  // First the window must be wearing a picture, so `get_theme`'s resolved scene
  // is the one the operator sees. The rig writes that one theme file (this round
  // is about the agent's tools, not about setting up the initial state).
  const r3WornFile = "round3-worn.json";
  fs.writeFileSync(
    path.join(themesDir, r3WornFile),
    `${JSON.stringify(
      {
        name: "round3-worn",
        label: "Round 3 Worn",
        scene: {
          background: {
            preset: "plain",
            image: {
              file: storedName,
              fit: "cover",
              position: "center",
              dim: "soft",
              blur: "none",
            },
            panels: { navRail: "light", chat: "medium" },
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  const r3WornPreview = await waitFor(
    (s) => s.preview === true && (s.previewText ?? "").includes(r3WornFile),
    20_000,
  );
  const r3WornKeptByClick = r3WornPreview ? await click("theme-keep") : false;
  const r3Worn = await waitFor(
    (s) =>
      s.keptFile === r3WornFile &&
      s.layer?.preset === "image" &&
      s.root.scenePanelSidebar === "light" &&
      s.root.scenePanelChat === "medium" &&
      (s.picture?.url ?? "").startsWith("blob:"),
    25_000,
  );
  // The refusal checks left one invalid theme file behind; `themes[]` entries
  // that do not parse have no resolved scene, so take it out before reading.
  fs.rmSync(path.join(themesDir, "refused-panels.json"), { force: true });
  await sleep(250);

  // The picture the agent will copy out of the vault: the rig's own fixture,
  // placed where the vault keeps images.
  const vaultImagesDir = path.join(vaultDir, "images", "files");
  fs.mkdirSync(vaultImagesDir, { recursive: true });
  fs.writeFileSync(path.join(vaultImagesDir, "agent-background.png"), fixtureBytes);

  const { e2eCompanionDoor } = await import("../dist-electron/main.js");
  const door = await e2eCompanionDoor();
  const backgroundDoorChecks = [
    "the-companion-door-offers-the-background-tools",
    "get-theme-reports-the-background-layer",
    "the-agent-stores-a-vault-picture",
    "the-agent-wears-the-picture-it-stored",
    "store-background-refuses-a-path-outside-the-vault",
  ];
  if (!door?.url || !door.token) {
    for (const label of backgroundDoorChecks) {
      check(label, false, "e2eCompanionDoor returned no url/token");
    }
  } else {
    let backgroundClient = null;
    try {
      const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
      const { StreamableHTTPClientTransport } = await import(
        "@modelcontextprotocol/sdk/client/streamableHttp.js"
      );
      backgroundClient = new Client({ name: "background-rig", version: "0.1.0" });
      await backgroundClient.connect(
        new StreamableHTTPClientTransport(new URL(door.url), {
          requestInit: { headers: { Authorization: `Bearer ${door.token}` } },
        }),
      );
      const callJson = async (name, args) => {
        const result = await backgroundClient.callTool({
          name,
          arguments: args,
        });
        const text =
          result.content?.find((part) => part.type === "text")?.text ?? "{}";
        try {
          return {
            json: JSON.parse(text),
            isError: result.isError === true,
            text,
          };
        } catch {
          return { json: null, isError: true, text };
        }
      };

      // 1/5 — the shipped door advertises the background tools.
      const listed = await backgroundClient.listTools();
      const doorToolNames = (listed.tools ?? []).map((tool) => tool.name);
      const wantedBackgroundTools = [
        "get_theme",
        "validate_theme",
        "write_theme",
        "store_background_picture",
      ];
      check(
        "the-companion-door-offers-the-background-tools",
        wantedBackgroundTools.every((name) => doorToolNames.includes(name)),
        JSON.stringify({
          missing: wantedBackgroundTools.filter(
            (name) => !doorToolNames.includes(name),
          ),
          backgroundTools: doorToolNames.filter((name) =>
            name.includes("theme") || name.includes("background"),
          ),
        }),
      );

      // 2/5 — `get_theme` reports the worn scene, each file's scene, and the
      // profile's picture inventory.
      const getTheme = await callJson("get_theme", {});
      const reportedThemes = Array.isArray(getTheme.json?.themes)
        ? getTheme.json.themes
        : [];
      const currentScene = getTheme.json?.current?.scene ?? null;
      // The tool reports `resolveScene(theme.scene)`, whose shape is the resolved
      // ThemeScene: `{ background: { preset, intensity, image, panels }, frames }`.
      // Assert that nested shape, not a flattened scene.
      const sceneShapeBad = (scene) =>
        !scene ||
        !scene.background ||
        typeof scene.background.preset !== "string" ||
        typeof scene.background.intensity !== "string" ||
        typeof scene.background.panels?.navRail !== "string" ||
        typeof scene.background.panels?.chat !== "string" ||
        !Object.prototype.hasOwnProperty.call(scene.background, "image") ||
        !scene.frames ||
        typeof scene.frames.canvas !== "string" ||
        typeof scene.frames.cards !== "string";
      const scenesMissing = reportedThemes
        .filter((entry) => sceneShapeBad(entry?.scene))
        .map((entry) => entry.file);
      const backgroundsReported = Array.isArray(getTheme.json?.backgrounds)
        ? getTheme.json.backgrounds
        : [];
      const storedReported =
        backgroundsReported.find((entry) => entry?.file === storedName) ?? null;
      const vocabularyText = JSON.stringify(getTheme.json?.vocabulary ?? "");
      check(
        "get-theme-reports-the-background-layer",
        r3Worn?.keptFile === r3WornFile &&
          getTheme.json?.keptFile === r3WornFile &&
          currentScene?.background?.preset === "plain" &&
          currentScene?.background?.image?.file === storedName &&
          currentScene?.background?.panels?.navRail === "light" &&
          currentScene?.background?.panels?.chat === "medium" &&
          typeof currentScene?.background?.intensity === "string" &&
          !sceneShapeBad(currentScene) &&
          reportedThemes.length > 0 &&
          scenesMissing.length === 0 &&
          storedReported?.bytes === fixtureBytes.length &&
          storedReported?.mime === "image/png" &&
          vocabularyText.includes("scene.background.panels"),
        JSON.stringify({
          worn: {
            kept: r3Worn?.keptFile ?? null,
            panels: r3Worn
              ? [r3Worn.root.scenePanelSidebar, r3Worn.root.scenePanelChat]
              : null,
            previewKept: r3WornKeptByClick,
          },
          kept: getTheme.json?.keptFile ?? null,
          currentScene,
          themes: reportedThemes.length,
          scenesMissing,
          sceneShapes: reportedThemes.map((entry) => ({
            file: entry?.file ?? null,
            scene: entry?.scene ?? null,
          })),
          backgrounds: backgroundsReported,
          storedReported,
          vocabularyHasPanels: vocabularyText.includes("scene.background.panels"),
        }),
      );

      // 3/5 — the agent copies a vault picture into the profile's store.
      const storeCall = await callJson("store_background_picture", {
        source: "images/files/agent-background.png",
      });
      const agentStored =
        typeof storeCall.json?.stored === "string" ? storeCall.json.stored : null;
      const agentImageAnswer = storeCall.json?.image ?? null;
      const agentStoreNote =
        typeof storeCall.json?.note === "string" ? storeCall.json.note : null;
      const agentStoredPath = agentStored
        ? path.join(backgroundsDir, agentStored)
        : null;
      const agentStoredBytes =
        agentStoredPath && fs.existsSync(agentStoredPath)
          ? fs.readFileSync(agentStoredPath)
          : null;
      const themeAfterStore = await callJson("get_theme", {});
      const agentInventory =
        (Array.isArray(themeAfterStore.json?.backgrounds)
          ? themeAfterStore.json.backgrounds
          : []
        ).find((entry) => entry?.file === agentStored) ?? null;
      check(
        "the-agent-stores-a-vault-picture",
        agentStored !== null &&
          FIXTURE_RE.test(agentStored) &&
          agentStored.includes("agent-background-") &&
          agentStoredBytes !== null &&
          agentStoredBytes.equals(fixtureBytes) &&
          agentImageAnswer?.file === agentStored &&
          agentImageAnswer?.fit === "cover" &&
          agentImageAnswer?.position === "center" &&
          agentImageAnswer?.dim === "soft" &&
          agentImageAnswer?.blur === "none" &&
          (agentStoreNote ?? "").includes("write_theme") &&
          agentInventory?.bytes === fixtureBytes.length &&
          agentInventory?.mime === "image/png",
        JSON.stringify({
          stored: agentStored,
          error: storeCall.json?.error?.message ?? null,
          image: agentImageAnswer,
          note: agentStoreNote,
          storedBytesEqual: Boolean(
            agentStoredBytes && agentStoredBytes.equals(fixtureBytes),
          ),
          listedInGetTheme: agentInventory,
          backgrounds: themeAfterStore.json?.backgrounds ?? null,
        }),
      );

      // 4/5 — validate then write a theme that wears the agent's picture and
      // shades both panels; the real window previews it, Keep keeps it, a
      // reload still wears it.
      const agentTheme = {
        name: "agent-background",
        label: "Agent Background",
        description: "A vault picture copied by the companion's own tool.",
        scene: {
          background: {
            image: {
              file: agentStored,
              fit: "cover",
              position: "center",
              dim: "soft",
              blur: "none",
            },
            panels: { navRail: "light", chat: "medium" },
          },
        },
      };
      const agentValid = agentStored
        ? await callJson("validate_theme", { theme: agentTheme })
        : null;
      const agentWritten = agentStored
        ? await callJson("write_theme", { theme: agentTheme })
        : null;
      const agentWrittenFile =
        typeof agentWritten?.json?.written === "string"
          ? agentWritten.json.written
          : null;
      const agentPreview = agentWrittenFile
        ? await waitFor(
            (s) =>
              s.preview === true &&
              (s.previewText ?? "").includes(agentWrittenFile) &&
              s.layer?.preset === "image" &&
              (s.picture?.url ?? "").startsWith("blob:") &&
              s.root.scenePanelSidebar === "light" &&
              s.root.scenePanelChat === "medium" &&
              (s.panels.rail?.alpha ?? 1) >= 0.3 &&
              (s.panels.rail?.alpha ?? 0) <= 0.38 &&
              (s.panels.chatPanel?.alpha ?? 1) >= 0.5 &&
              (s.panels.chatPanel?.alpha ?? 0) <= 0.66,
            25_000,
          )
        : null;
      const agentKeepPressed = agentPreview
        ? await click("theme-keep")
        : false;
      const agentKept = agentKeepPressed
        ? await waitFor(
            (s) =>
              s.keptFile === agentWrittenFile &&
              s.preview === false &&
              s.layer?.preset === "image",
            15_000,
          )
        : null;
      let agentReloaded = null;
      if (agentKept) {
        await reload();
        agentReloaded = await waitFor(
          (s) =>
            s.keptFile === agentWrittenFile &&
            s.layer?.preset === "image" &&
            (s.picture?.url ?? "").startsWith("blob:") &&
            s.root.scenePanelSidebar === "light" &&
            s.root.scenePanelChat === "medium",
          30_000,
        );
        await evaluate(`(() => { location.hash = "#/home"; return location.hash; })()`);
        await sleep(900);
        const agentShot = await win.webContents.capturePage();
        fs.writeFileSync(AGENT_PNG, agentShot.toPNG());
      }
      check(
        "the-agent-wears-the-picture-it-stored",
        agentValid?.json?.ok === true &&
          agentValid.json.theme?.scene?.background?.image?.file ===
            agentStored &&
          agentWrittenFile === "agent-background.json" &&
          agentPreview?.preview === true &&
          agentPreview.layer?.preset === "image" &&
          agentPreview.root.scenePanelSidebar === "light" &&
          agentPreview.root.scenePanelChat === "medium" &&
          (agentPreview.picture?.url ?? "").startsWith("blob:") &&
          agentKeepPressed === true &&
          agentKept?.keptFile === agentWrittenFile &&
          agentReloaded?.keptFile === agentWrittenFile &&
          agentReloaded.layer?.preset === "image" &&
          (agentReloaded.picture?.url ?? "").startsWith("blob:") &&
          agentReloaded.root.scenePanelSidebar === "light" &&
          agentReloaded.root.scenePanelChat === "medium",
        JSON.stringify({
          validation: agentValid?.json?.ok ?? null,
          validationError: agentValid?.json?.error?.message ?? null,
          written: agentWrittenFile,
          preview: agentPreview?.previewText ?? null,
          previewPanels: agentPreview
            ? {
                sidebar: agentPreview.root.scenePanelSidebar,
                chat: agentPreview.root.scenePanelChat,
                rail: agentPreview.panels.rail,
                chatPanel: agentPreview.panels.chatPanel,
              }
            : null,
          kept: agentKept?.keptFile ?? null,
          reloaded: agentReloaded?.keptFile ?? null,
          reloadedPanels: agentReloaded
            ? {
                sidebar: agentReloaded.root.scenePanelSidebar,
                chat: agentReloaded.root.scenePanelChat,
              }
            : null,
        }),
      );

      // 5/5 — the store tool refuses what is not a picture inside the vault,
      // and neither refusal writes a profile file.
      const backgroundsBeforeRefusals = fs.existsSync(backgroundsDir)
        ? fs.readdirSync(backgroundsDir).sort()
        : [];
      const escapeStore = await callJson("store_background_picture", {
        source: "../escape.png",
      });
      const escapeStoreMessage = String(
        escapeStore.json?.error?.message ??
          escapeStore.json?.error ??
          "no error returned",
      );
      fs.writeFileSync(
        path.join(vaultImagesDir, "not-a-picture.txt"),
        "this is not an image\n",
      );
      const textStore = await callJson("store_background_picture", {
        source: "images/files/not-a-picture.txt",
      });
      const textStoreMessage = String(
        textStore.json?.error?.message ??
          textStore.json?.error ??
          "no error returned",
      );
      await sleep(200);
      const backgroundsAfterRefusals = fs.existsSync(backgroundsDir)
        ? fs.readdirSync(backgroundsDir).sort()
        : [];
      check(
        "store-background-refuses-a-path-outside-the-vault",
        escapeStoreMessage.includes("picture inside the vault") &&
          (textStoreMessage.includes("only PNG") ||
            textStoreMessage.includes("not a picture")) &&
          JSON.stringify(backgroundsBeforeRefusals) ===
            JSON.stringify(backgroundsAfterRefusals),
        JSON.stringify({
          escape: escapeStoreMessage,
          text: textStoreMessage,
          before: backgroundsBeforeRefusals,
          after: backgroundsAfterRefusals,
        }),
      );
    } catch (error) {
      // A door failure must not swallow the report: record the failure and let
      // any checks that never ran show up as failed too.
      const message = String(error);
      failures.push(`background tools: ${message}`);
      const recorded = new Set(checks.map((entry) => entry.label));
      for (const label of backgroundDoorChecks) {
        if (!recorded.has(label)) check(label, false, message);
      }
    } finally {
      if (backgroundClient) {
        await backgroundClient.close().catch(() => {});
      }
    }
  }

  // ── The report ───────────────────────────────────────────────────────────
  const report = {
    ranAt: new Date().toISOString(),
    world,
    fixture: path.relative(desktopRoot, FIXTURE),
    storedPicture: storedName,
    checks,
    failures,
    pass: failures.length === 0,
    artifacts: {
      settings: path.relative(desktopRoot, SETTINGS_PNG),
      app: path.relative(desktopRoot, APP_PNG),
      horizon: path.relative(desktopRoot, HORIZON_PNG),
      studio: path.relative(desktopRoot, STUDIO_PNG),
      clearPanels: path.relative(desktopRoot, CLEAR_PANELS_PNG),
      agent: path.relative(desktopRoot, AGENT_PNG),
    },
    themeFiles: {
      picture: pictureThemeFile,
      horizon: "horizon-sky.json",
      mesh: "mesh-sky.json",
      studio: studioFile,
      missing: "missing-picture.json",
    },
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

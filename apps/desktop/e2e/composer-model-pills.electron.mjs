/**
 * Drives the composer's model and thinking pills in a real Electron window and
 * turns the measurements into `e2e/artifacts/composer-model-pills.{json,png}`.
 *
 * Run through its wrapper (`npm run test -w @lifequest/desktop`, which skips
 * when the dev server is down), or by hand against a live `npm run dev`:
 *
 *   npx electron e2e/composer-model-pills.electron.mjs
 *
 * Failure modes this rig exists to catch, in the order they would bite:
 *
 *  1. The row renders when there is no catalog (companion down, no providers) —
 *     the composer must be exactly what it was before this feature.
 *  2. The row paints chrome of its own, or the menu opens *downward* off the
 *     bottom of the window, where nothing can be clicked.
 *  3. A pill submits the draft: the row lives inside the composer's form, so a
 *     control without `type="button"` turns Enter into a send.
 *  4. A pick that never reaches the turn: the pill must hand `runtime` to the
 *     chat call, and only the fields the operator actually chose.
 *  5. The capability gates drift from the Desktop rule — the thinking pill
 *     present when the model has no reasoning control, or "Off" offered where
 *     the catalog says thinking cannot be switched off.
 *  6. A provider the gateway has no credential for being choosable.
 *
 * Exit code 0 = every invariant held.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(here, "artifacts");
const url =
  process.env.LIFEQUEST_E2E_URL ?? "http://127.0.0.1:5173/e2e/chat-panel.html";

// Its own Electron profile: the pick is remembered in localStorage, and a rig
// sharing a profile with another run would start on the previous run's model.
const userDataDir = path.join(artifactsDir, "userdata", "composer-model-pills");
fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);

const DEFAULT_SIZE = { width: 1280, height: 900 };
const STORAGE_KEY = "lifequest.companion.runtimePins";
/** The harness's two chats, in the order its session list serves them. */
const FIRST_CHAT = "harness-session";
const SECOND_CHAT = "harness-session-2";

/** Alpha channel of a computed colour; 1 when the string carries none. */
const alphaOf = (color) => {
  const numbers = ((color ?? "").match(/[\d.]+/g) ?? []).map(Number);
  return numbers.length >= 4 ? numbers[3] : 1;
};

/** One chat's pin out of the store the panel writes (keyed by session id). */
const pinOf = (raw, sessionId = FIRST_CHAT) => {
  try {
    return JSON.parse(raw ?? "{}")[sessionId] ?? {};
  } catch {
    return {};
  }
};

const failures = [];
const check = (label, condition, detail) => {
  if (!condition) failures.push(`${label}: ${detail}`);
  return Boolean(condition);
};

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
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  const run = (expression) => win.webContents.executeJavaScript(expression, true);

  let report;
  const timeout = setTimeout(() => {
    console.error("composer-model-pills: timed out after 90s");
    app.exit(1);
  }, 90_000);

  try {
    await win.loadURL(url);
    await run("window.chatPanelHarnessReady.then(() => true)");

    // The pick is *remembered across launches* — that is the feature — so this
    // rig would otherwise start on whatever the previous run chose, and the
    // resting-state checks would fail on a correct build. Clear the store and
    // reload, so every run measures the state a first launch actually shows.
    await run("window.localStorage.clear()");
    await win.loadURL(url);
    await run("window.chatPanelHarnessReady.then(() => true)");
    const restored = await run(
      `window.localStorage.getItem(${JSON.stringify(STORAGE_KEY)})`,
    );
    check("the run starts from no pick", restored === null, `stored pick ${restored}`);

    win.setContentSize(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
    await new Promise((resolve) => setTimeout(resolve, 250));
    win.showInactive();

    /** Everything one glance at the row can tell us. */
    const readRow = `(() => {
      const row = document.querySelector(".chat-panel__composer-controls");
      if (!row) return { rowPresent: false };
      const field = document.querySelector(".chat-panel__composer-input");
      const styles = getComputedStyle(row);
      return {
        rowPresent: true,
        rowBackground: styles.backgroundColor,
        rowBorderTopWidth: styles.borderTopWidth,
        rowHeight: row.offsetHeight,
        rowBelowField: Math.round(row.getBoundingClientRect().top) >=
          Math.round(field.getBoundingClientRect().bottom),
        menuClosed: !row.querySelector('[role="menu"]'),
        pills: [...row.querySelectorAll(".chat-panel__pill")].map((pill) => ({
          label: pill.querySelector(".chat-panel__pill-label")?.textContent ?? "",
          override: pill.getAttribute("data-override"),
          hasDot: Boolean(pill.querySelector(".chat-panel__pill-dot")),
          disabled: pill.disabled,
          hasPopup: pill.getAttribute("aria-haspopup"),
          expanded: pill.getAttribute("aria-expanded"),
          height: pill.offsetHeight,
          wrap: getComputedStyle(pill).borderTopWidth,
        })),
        // The line under the field, and the two ends of it: the attach control
        // owns the left end, the runtime pick the right. Measured against the
        // field's own box, so "under the composer" is a number, not a claim.
        line: (() => {
          const lineEl = document.querySelector(".chat-panel__composer-runtime");
          const attachEl = document.querySelector(".chat-panel__attach");
          const pickEl = document.querySelector(".chat-panel__composer-controls");
          if (!lineEl || !attachEl || !pickEl) return null;
          const box = (el) => {
            const r = el.getBoundingClientRect();
            return {
              left: Math.round(r.left),
              right: Math.round(r.right),
              top: Math.round(r.top),
              bottom: Math.round(r.bottom),
            };
          };
          const attach = box(attachEl);
          const pick = box(pickEl);
          return {
            fieldBottom: Math.round(field.getBoundingClientRect().bottom),
            line: box(lineEl),
            attach,
            pick,
            sameLine: attach.top < pick.bottom && pick.top < attach.bottom,
            attachGroup: Boolean(document.querySelector(".chat-panel__receipts")),
          };
        })(),
      };
    })()`;

    /** Open one pill's menu and read it, without choosing anything. */
    const readMenu = `(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const pill = document.querySelector(${JSON.stringify(".chat-panel__pill")});
      pill.click();
      await wait(70);
      const menu = document.querySelector(".chat-panel__composer-menu");
      if (!menu) return { menuPresent: false, expanded: pill.getAttribute("aria-expanded") };
      const mb = menu.getBoundingClientRect();
      const pb = pill.getBoundingClientRect();
      const panel = document.querySelector(".chat-panel").getBoundingClientRect();
      const styles = getComputedStyle(menu);
      // Chromium snaps a used border width to whole device pixels, so a 1px
      // border reads 0.8px on a 125% display: measure a reference in the same
      // renderer rather than comparing against a hard-coded string.
      const reference = document.createElement("div");
      reference.style.cssText = "position:absolute;left:-9999px;top:0;border-top:1px solid var(--border);";
      document.body.appendChild(reference);
      const borderReference = getComputedStyle(reference).borderTopWidth;
      reference.remove();
      const providers = [...menu.querySelectorAll(".chat-panel__menu-provider")];
      const rows = [...menu.querySelectorAll(".chat-panel__menu-models button")];
      return {
        menuPresent: true,
        expanded: pill.getAttribute("aria-expanded"),
        menuBackground: styles.backgroundColor,
        menuBorderWidth: styles.borderTopWidth,
        menuBorderStyle: styles.borderTopStyle,
        borderReference,
        menuShadow: styles.boxShadow !== "none",
        opensUpward: Math.round(mb.bottom) <= Math.round(pb.top),
        menuBottom: Math.round(mb.bottom),
        pillTop: Math.round(pb.top),
        insidePanel: mb.top >= panel.top - 1 && mb.bottom <= panel.bottom + 1,
        providerChips: providers.map((chip) => ({
          label: chip.textContent.trim(),
          checked: chip.getAttribute("aria-checked"),
          authenticated: chip.getAttribute("data-authenticated"),
          disabled: chip.disabled,
        })),
        rows: rows.map((row) => ({
          label: row.getAttribute("aria-label"),
          checked: row.getAttribute("aria-checked"),
        })),
      };
    })()`;

    const pickRow = (label) => `(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const target = [...document.querySelectorAll(".chat-panel__composer-menu .chat-panel__menu-models button")]
        .find((row) => row.getAttribute("aria-label") === ${JSON.stringify(label)});
      if (!target) return { clicked: false };
      target.click();
      await wait(70);
      const row = document.querySelector(".chat-panel__composer-controls");
      return {
        clicked: true,
        pills: [...row.querySelectorAll(".chat-panel__pill")].map((pill) => ({
          label: pill.querySelector(".chat-panel__pill-label")?.textContent ?? "",
          override: pill.getAttribute("data-override"),
          hasDot: Boolean(pill.querySelector(".chat-panel__pill-dot")),
        })),
        menuClosed: !row.querySelector('[role="menu"]'),
        stored: window.localStorage.getItem(${JSON.stringify(STORAGE_KEY)}),
      };
    })()`;

    // 1 — the resting row: two pills naming what the next turn will use, with no
    // pick made, so nothing on the wire changes yet.
    /**
     * A model that lives under another provider: the menu lists the current
     * provider's models, so the chip has to be taken first.
     */
    const pickProviderModel = (providerLabel, rowLabel) => `(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const chip = [...document.querySelectorAll(".chat-panel__menu-provider")]
        .find((el) => el.textContent.trim() === ${JSON.stringify(providerLabel)});
      if (!chip || chip.disabled) return { chip: false, clicked: false };
      chip.click();
      await wait(70);
      const row = [...document.querySelectorAll(".chat-panel__composer-menu .chat-panel__menu-models button")]
        .find((el) => el.getAttribute("aria-label") === ${JSON.stringify(rowLabel)});
      if (!row) return { chip: true, clicked: false };
      row.click();
      await wait(70);
      return {
        chip: true,
        clicked: true,
        pills: [...document.querySelectorAll(".chat-panel__pill")].map((pill) => ({
          label: pill.querySelector(".chat-panel__pill-label")?.textContent ?? "",
          override: pill.getAttribute("data-override"),
        })),
        stored: window.localStorage.getItem(${JSON.stringify(STORAGE_KEY)}),
      };
    })()`;

    const initial = await run(readRow);
    check("the runtime row is present with a catalog", initial.rowPresent === true, JSON.stringify(initial));
    check(
      "the row paints no chrome of its own",
      initial.rowBackground && alphaOf(initial.rowBackground) === 0 && initial.rowBorderTopWidth === "0px",
      `background ${initial.rowBackground} / top border ${initial.rowBorderTopWidth}`,
    );
    check(
      "the row sits under the field it belongs to",
      initial.rowBelowField === true,
      "the pills are not below the composer field",
    );
    check(
      "the attach control sits under the field, at the left end of the line",
      Boolean(initial.line?.attach) &&
        initial.line.attach.top >= initial.line.fieldBottom &&
        Math.abs(initial.line.attach.left - initial.line.line.left) <= 1 &&
        initial.line.attach.right < initial.line.pick.left,
      `attach ${JSON.stringify(initial.line?.attach)} on line ${JSON.stringify(initial.line?.line)}, ` +
        `field bottom ${initial.line?.fieldBottom}`,
    );
    check(
      "the runtime pick sits at the right end of that same line",
      initial.line?.sameLine === true &&
        Math.abs(initial.line.pick.right - initial.line.line.right) <= 1,
      `pick ${JSON.stringify(initial.line?.pick)} on line ${JSON.stringify(initial.line?.line)}`,
    );
    check(
      "two pills at rest: the model and its thinking level",
      initial.pills?.length === 2,
      `pills ${JSON.stringify(initial.pills)}`,
    );
    check(
      "the model pill names the profile's own default until the operator picks",
      initial.pills?.[0]?.label === "space-bunny-alpha" &&
        initial.pills?.[0]?.override === "false" &&
        initial.pills?.[0]?.hasDot === false,
      `model pill ${JSON.stringify(initial.pills?.[0])}`,
    );
    check(
      "the thinking pill shows the gateway default, not a made-up level",
      initial.pills?.[1]?.label === "Default" && initial.pills?.[1]?.override === "false",
      `thinking pill ${JSON.stringify(initial.pills?.[1])}`,
    );
    check(
      "a pill announces itself as a menu trigger",
      initial.pills?.[0]?.hasPopup === "menu" && initial.pills?.[0]?.expanded === "false",
      `popup ${initial.pills?.[0]?.hasPopup} / expanded ${initial.pills?.[0]?.expanded}`,
    );
    check("no menu is open at rest", initial.menuClosed === true, "a menu rendered closed");

    // 2 — the thinking pill on the default model, which the catalog says may
    // think but may not be switched off: present, and offering no "Off".
    const defaultThinking = await run(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const pill = document.querySelectorAll(".chat-panel__pill")[1];
      pill.click();
      await wait(70);
      const rows = [...document.querySelectorAll(".chat-panel__composer-menu .chat-panel__menu-models button")]
        .map((row) => row.getAttribute("aria-label"));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await wait(60);
      return { rows, closedByEscape: !document.querySelector(".chat-panel__composer-menu") };
    })()`);
    check(
      "thinking off is not offered where the catalog forbids it",
      defaultThinking.rows?.includes("Default thinking level") &&
        !defaultThinking.rows?.includes("Thinking level Off"),
      `rows ${JSON.stringify(defaultThinking.rows)}`,
    );
    check(
      "Escape closes the menu",
      defaultThinking.closedByEscape === true,
      "the menu outlived Escape",
    );

    // 3 — the model menu: opens upward onto its own surface, lists the gateway's
    // providers, and offers an unauthenticated one inert.
    const menu = await run(readMenu);
    check("the model menu opens", menu.menuPresent === true, JSON.stringify(menu));
    check(
      "the menu opens upward and stays inside the panel",
      menu.opensUpward === true && menu.insidePanel === true,
      `menu bottom ${menu.menuBottom} vs pill top ${menu.pillTop}, inside panel ${menu.insidePanel}`,
    );
    check(
      "the menu paints its own surface",
      alphaOf(menu.menuBackground) === 1 &&
        menu.menuBorderStyle === "solid" &&
        menu.menuBorderWidth === menu.borderReference &&
        menu.menuShadow === true,
      `background ${menu.menuBackground} / border ${menu.menuBorderWidth} ${menu.menuBorderStyle}` +
        ` (1px reference ${menu.borderReference}) / shadow ${menu.menuShadow}`,
    );
    check(
      "the provider's models are listed newest-first",
      menu.rows?.[1]?.label === "moonshotai/kimi-linear" &&
        menu.rows?.[menu.rows.length - 1]?.label === "stealth/space-bunny-alpha",
      `rows ${JSON.stringify(menu.rows?.map((row) => row.label))}`,
    );
    check(
      "the provider strip marks the current provider and disables the unauthenticated one",
      menu.providerChips?.length === 3 &&
        menu.providerChips?.[0]?.checked === "true" &&
        menu.providerChips?.some(
          (chip) => chip.authenticated === "false" && chip.disabled === true,
        ),
      `chips ${JSON.stringify(menu.providerChips)}`,
    );
    check(
      "the menu offers the default model first, then the provider's own models",
      menu.rows?.[0]?.checked === "true" &&
        menu.rows?.some((row) => row.label === "openai/gpt-6-sol") &&
        menu.rows?.some((row) => row.label === "moonshotai/kimi-linear"),
      `rows ${JSON.stringify(menu.rows)}`,
    );

    // 4 — the guard that matters most: the row lives inside the composer's form,
    // so a pill that is not `type="button"` would submit the draft.
    const guard = await run(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const field = document.querySelector(".chat-panel__composer-input");
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(field, "A draft a pill must not send");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(50);
      let submits = 0;
      const form = document.querySelector(".chat-panel__composer");
      const count = () => { submits += 1; };
      form.addEventListener("submit", count);
      // The menu is open from the previous step; close it, then use a pill.
      document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      await wait(60);
      const closedByOutsideClick = !document.querySelector(".chat-panel__composer-menu");
      document.querySelectorAll(".chat-panel__pill")[0].click();
      await wait(60);
      document.querySelectorAll(".chat-panel__pill")[0].click();
      await wait(60);
      const out = {
        submits,
        chatCalls: (window.__lqChatCalls || []).length,
        draft: field.value,
        closedByOutsideClick,
        menuClosed: !document.querySelector(".chat-panel__composer-menu"),
      };
      form.removeEventListener("submit", count);
      return out;
    })()`);
    check(
      "a pill never submits the composer's draft",
      guard.submits === 0 && guard.chatCalls === 0 && guard.draft === "A draft a pill must not send",
      `${guard.submits} submit event(s), ${guard.chatCalls} chat call(s), draft ${JSON.stringify(guard.draft)}`,
    );
    check(
      "a click outside closes the menu, and the trigger toggles it",
      guard.closedByOutsideClick === true && guard.menuClosed === true,
      "the menu survived a click outside or a second trigger click",
    );

    // 5 — a pick: the pill takes the model's own short name, marks itself as the
    // operator's choice, and is remembered for the next launch.
    await run(readMenu);
    const pickedModel = await run(pickRow("openai/gpt-6-sol"));
    check(
      "choosing a model moves the pill off the default",
      pickedModel.clicked === true &&
        pickedModel.pills?.[0]?.label === "gpt-6-sol" &&
        pickedModel.pills?.[0]?.override === "true" &&
        pickedModel.pills?.[0]?.hasDot === true,
      `model pill ${JSON.stringify(pickedModel.pills?.[0])}`,
    );
    check("the menu closes on a choice", pickedModel.menuClosed === true, "the menu stayed open");
    check(
      "the pick is remembered against its own chat",
      pinOf(pickedModel.stored).model === "openai/gpt-6-sol" &&
        pinOf(pickedModel.stored).provider === "nous",
      `stored ${pickedModel.stored}`,
    );

    // …and the other half of remembering: a fresh launch comes back on the pick
    // rather than on the profile's default.
    await win.loadURL(url);
    await run("window.chatPanelHarnessReady.then(() => true)");
    await new Promise((resolve) => setTimeout(resolve, 250));
    const restoredRow = await run(readRow);
    check(
      "a fresh launch comes back on the pick",
      restoredRow.pills?.[0]?.label === "gpt-6-sol" &&
        restoredRow.pills?.[0]?.override === "true" &&
        restoredRow.pills?.[0]?.hasDot === true,
      `restored row ${JSON.stringify(restoredRow.pills)}`,
    );

    // The pin belongs to the *chat*, not the client: the other chat opens on its
    // own — absent — pin, and each chat's turn carries only what its own chat was
    // left on. This is the whole point of following Desktop's per-chat model.
    const switchToChat = async (index) => {
      await run(`(async () => {
        const el = document.querySelector('[aria-label="Chat history"]');
        if (!el) return false;
        el.click();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
        return true;
      })()`);
      return run(`(async () => {
        const el = document.querySelectorAll(".chat-panel__session")[${index}];
        if (!el) return false;
        el.click();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
        return true;
      })()`);
    };

    await switchToChat(1);
    const secondRow = await run(readRow);
    check(
      "the other chat opens on no pin of its own",
      secondRow.pills?.[0]?.label === "space-bunny-alpha" &&
        secondRow.pills?.[0]?.override === "false" &&
        secondRow.pills?.[1]?.label === "Default" &&
        secondRow.pills?.[1]?.override === "false",
      `second chat row ${JSON.stringify(secondRow.pills)}`,
    );

    await run(readMenu);
    const secondPick = await run(pickProviderModel("Anthropic", "anthropic/claude-opus-5"));
    const secondEffort = await run(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      document.querySelectorAll(".chat-panel__pill")[1].click();
      await wait(70);
      const medium = [...document.querySelectorAll(".chat-panel__composer-menu .chat-panel__menu-models button")]
        .find((row) => row.getAttribute("aria-label") === "Thinking level Medium");
      if (!medium) return false;
      medium.click();
      await wait(70);
      return true;
    })()`);
    const secondStored = await run(
      `window.localStorage.getItem(${JSON.stringify(STORAGE_KEY)})`,
    );
    check(
      "each chat keeps its own pin, side by side",
      secondPick.clicked === true &&
        secondEffort === true &&
        pinOf(secondStored, SECOND_CHAT).model === "anthropic/claude-opus-5" &&
        pinOf(secondStored, SECOND_CHAT).reasoningEffort === "medium" &&
        pinOf(secondStored, FIRST_CHAT).model === "openai/gpt-6-sol" &&
        !pinOf(secondStored, FIRST_CHAT).reasoningEffort,
      `pins ${secondStored}`,
    );

    const secondTurn = await run(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const field = document.querySelector(".chat-panel__composer-input");
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(field, "A turn in the second chat");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(50);
      const before = (window.__lqChatCalls || []).length;
      document.querySelector(".chat-panel__send").click();
      await wait(250);
      const calls = window.__lqChatCalls || [];
      return {
        runtime: calls[calls.length - 1]?.runtime ?? null,
        sessionId: calls[calls.length - 1]?.sessionId ?? null,
        added: calls.length - before,
      };
    })()`);
    check(
      "a turn carries the pin of the chat it was sent from",
      secondTurn.added === 1 &&
        secondTurn.sessionId === SECOND_CHAT &&
        secondTurn.runtime?.model === "anthropic/claude-opus-5" &&
        secondTurn.runtime?.reasoningEffort === "medium",
      `second-chat turn ${JSON.stringify(secondTurn)}`,
    );

    await switchToChat(0);
    const backRow = await run(readRow);
    check(
      "switching back returns the first chat's own pin",
      backRow.pills?.[0]?.label === "gpt-6-sol" &&
        backRow.pills?.[0]?.override === "true" &&
        backRow.pills?.[1]?.label === "Default",
      `first chat after switching back ${JSON.stringify(backRow.pills)}`,
    );

    // Browsing another provider on one chat must not decide what the next chat's
    // menu opens on: the list belongs to the chat, like the pick does.
    const providerBleed = await run(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      document.querySelectorAll(".chat-panel__pill")[0].click();
      await wait(70);
      const rows = [...document.querySelectorAll(".chat-panel__composer-menu .chat-panel__menu-models button")]
        .map((row) => row.getAttribute("aria-label"));
      const chip = [...document.querySelectorAll(".chat-panel__menu-provider")]
        .find((el) => el.getAttribute("aria-checked") === "true");
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await wait(60);
      return { rows, chip: chip?.textContent.trim() ?? "", closed: !document.querySelector(".chat-panel__composer-menu") };
    })()`);
    check(
      "another chat's provider browsing does not follow you into this chat",
      providerBleed.chip === "Nous Portal" &&
        providerBleed.rows?.some((label) => label === "moonshotai/kimi-linear") &&
        !providerBleed.rows?.some((label) => label === "anthropic/claude-opus-5") &&
        providerBleed.closed === true,
      `menu after the switch-back: ${JSON.stringify(providerBleed)}`,
    );

    // 6 — the thinking ladder on a model that may switch thinking off.
    const thinking = await run(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      document.querySelectorAll(".chat-panel__pill")[1].click();
      await wait(70);
      const rows = [...document.querySelectorAll(".chat-panel__composer-menu .chat-panel__menu-models button")]
        .map((row) => row.getAttribute("aria-label"));
      const high = [...document.querySelectorAll(".chat-panel__composer-menu .chat-panel__menu-models button")]
        .find((row) => row.getAttribute("aria-label") === "Thinking level High");
      high.click();
      await wait(70);
      const pill = document.querySelectorAll(".chat-panel__pill")[1];
      return {
        rows,
        label: pill.querySelector(".chat-panel__pill-label")?.textContent ?? "",
        override: pill.getAttribute("data-override"),
        stored: window.localStorage.getItem(${JSON.stringify(STORAGE_KEY)}),
      };
    })()`);
    check(
      "the ladder carries every wire level, plus off where it is allowed",
      thinking.rows?.includes("Thinking level Off") &&
        ["Minimal", "Low", "Medium", "High", "X-High", "Max"].every((level) =>
          thinking.rows?.includes(`Thinking level ${level}`),
        ),
      `rows ${JSON.stringify(thinking.rows)}`,
    );
    check(
      "choosing a level puts it on the pill",
      thinking.label === "High" && thinking.override === "true",
      `thinking pill ${thinking.label} / override ${thinking.override}`,
    );
    check(
      "the level is remembered with the model",
      pinOf(thinking.stored).reasoningEffort === "high",
      `stored ${thinking.stored}`,
    );

    // 7 — the capability gate the other way: a model with no reasoning control
    // takes the thinking pill off the row entirely.
    await run(readMenu);
    const noReasoning = await run(pickRow("moonshotai/kimi-linear"));
    check(
      "a model without a reasoning control drops the thinking pill",
      noReasoning.pills?.length === 1 && noReasoning.pills?.[0]?.label === "kimi-linear",
      `pills ${JSON.stringify(noReasoning.pills)}`,
    );

    // 8 — the provider strip drives the model list, and an unauthenticated
    // provider cannot be selected at all.
    const providers = await run(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      document.querySelectorAll(".chat-panel__pill")[0].click();
      await wait(70);
      const chips = [...document.querySelectorAll(".chat-panel__menu-provider")];
      const inert = chips.find((chip) => chip.disabled);
      if (!inert) {
        return { inertLabel: "", afterInert: [], rows: [], checkedAfterSwitch: "", currentChip: "" };
      }
      inert.click();
      await wait(50);
      const afterInert = [...document.querySelectorAll(".chat-panel__composer-menu .chat-panel__menu-models button")]
        .map((row) => row.getAttribute("aria-label"));
      const anthropic = chips.find((chip) => chip.textContent.trim() === "Anthropic");
      anthropic.click();
      await wait(70);
      const rows = [...document.querySelectorAll(".chat-panel__composer-menu .chat-panel__menu-models button")]
        .map((row) => row.getAttribute("aria-label"));
      const checked = [...document.querySelectorAll(".chat-panel__composer-menu .chat-panel__menu-models button")]
        .find((row) => row.getAttribute("aria-checked") === "true")?.getAttribute("aria-label");
      return {
        inertLabel: inert.textContent.trim(),
        afterInert,
        rows,
        checkedAfterSwitch: checked,
        currentChip: [...document.querySelectorAll(".chat-panel__menu-provider")]
          .find((chip) => chip.getAttribute("aria-checked") === "true")?.textContent.trim(),
      };
    })()`);
    check(
      "an unauthenticated provider cannot take the model list",
      providers.inertLabel === "Fireworks" &&
        providers.afterInert?.some((label) => label === "moonshotai/kimi-linear"),
      `after clicking ${providers.inertLabel}: ${JSON.stringify(providers.afterInert)}`,
    );
    check(
      "a provider chip switches the model list to its own models",
      providers.currentChip === "Anthropic" &&
        providers.rows?.some((label) => label === "anthropic/claude-opus-5") &&
        !providers.rows?.some((label) => label === "moonshotai/kimi-linear"),
      `chip ${providers.currentChip}, rows ${JSON.stringify(providers.rows)}`,
    );

    const menuShot = path.join(artifactsDir, "composer-model-pills-menu.png");
    fs.writeFileSync(menuShot, (await win.webContents.capturePage()).toPNG());

    await run(pickRow("anthropic/claude-opus-5"));

    // 9 — the turn itself: the pick rides the chat call, nothing is invented,
    // and the pills cannot be changed mid-turn.
    const sent = await run(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      window.__lqChatDelay = 500;
      const field = document.querySelector(".chat-panel__composer-input");
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(field, "Which model am I talking to?");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(50);
      const before = (window.__lqChatCalls || []).length;
      document.querySelector(".chat-panel__send").click();
      await wait(120);
      const during = [...document.querySelectorAll(".chat-panel__pill")].map((pill) => pill.disabled);
      const calls = window.__lqChatCalls || [];
      await wait(600);
      const after = [...document.querySelectorAll(".chat-panel__pill")].map((pill) => pill.disabled);
      window.__lqChatDelay = 0;
      return {
        runtime: calls[calls.length - 1]?.runtime ?? null,
        added: calls.length - before,
        sessionId: calls[calls.length - 1]?.sessionId ?? null,
        during,
        after,
        input: calls[calls.length - 1]?.input ?? null,
      };
    })()`);
    check(
      "the turn carries the pick and only the pick",
      sent.runtime !== null &&
        Object.keys(sent.runtime).length === 3 &&
        sent.runtime.provider === "anthropic" &&
        sent.runtime.model === "anthropic/claude-opus-5" &&
        sent.runtime.reasoningEffort === "high",
      `runtime ${JSON.stringify(sent.runtime)}`,
    );
    check(
      "the pick rides the same turn as the message",
      sent.added === 1 &&
        sent.sessionId === FIRST_CHAT &&
        sent.input === "Which model am I talking to?",
      `${sent.added} call(s) on ${sent.sessionId}, input ${JSON.stringify(sent.input)}`,
    );
    check(
      "the pills are inert while a turn is live and live again after it",
      sent.during?.every(Boolean) === true && sent.after?.every((disabled) => disabled === false),
      `during ${JSON.stringify(sent.during)}, after ${JSON.stringify(sent.after)}`,
    );

    const finalRow = await run(`(() => {
      const row = document.querySelector(".chat-panel__composer-controls");
      return row ? { height: row.offsetHeight, pills: row.querySelectorAll(".chat-panel__pill").length } : null;
    })()`);
    check(
      "the row still costs one line after a full session",
      finalRow?.height === initial.rowHeight && finalRow?.pills === 2,
      `row ${JSON.stringify(finalRow)} vs resting ${JSON.stringify(initial.rowHeight)}`,
    );

    // 10 — the absence state: no catalog, no row. This is what a companion that
    // is not up yet looks like, and the composer has to be exactly as it was.
    await win.loadURL(`${url}?nocatalog=1`);
    await run("window.chatPanelHarnessReady.then(() => true)");
    await new Promise((resolve) => setTimeout(resolve, 200));
    const withoutCatalog = await run(`(() => ({
      row: Boolean(document.querySelector(".chat-panel__composer-controls")),
      field: Boolean(document.querySelector(".chat-panel__composer-input")),
      send: Boolean(document.querySelector(".chat-panel__send")),
      stored: window.localStorage.getItem(${JSON.stringify(STORAGE_KEY)}),
    }))()`);
    check(
      "no catalog means no row at all",
      withoutCatalog.row === false,
      "the runtime row rendered without a catalog",
    );
    check(
      "the pick outlives a reload even when the row cannot be shown",
      pinOf(withoutCatalog.stored).model === "anthropic/claude-opus-5",
      `stored after reload ${withoutCatalog.stored}`,
    );
    check(
      "the composer is untouched without a catalog",
      withoutCatalog.field === true && withoutCatalog.send === false,
      `field ${withoutCatalog.field} / send ${withoutCatalog.send} on an empty draft`,
    );

    report = {
      url,
      ranAt: new Date().toISOString(),
      window: { ...DEFAULT_SIZE },
      initial,
      defaultThinking,
      menu,
      guard,
      pickedModel,
      restoredRow,
      secondRow,
      secondPick,
      secondStored,
      secondTurn,
      backRow,
      providerBleed,
      thinking,
      noReasoning,
      providers,
      sent,
      withoutCatalog,
      finalRow,
      screenshots: [menuShot],
      failures,
      pass: failures.length === 0,
    };
  } catch (error) {
    report = {
      url,
      ranAt: new Date().toISOString(),
      failures: [...failures, `threw: ${error instanceof Error ? error.message : String(error)}`],
      pass: false,
    };
  } finally {
    clearTimeout(timeout);
  }

  const reportFile = path.join(artifactsDir, "composer-model-pills.json");
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);

  if (report.initial) {
    console.log(
      `row: ${report.initial.rowHeight}px tall, ${report.initial.pills?.length} pill(s) — ` +
        `${report.initial.pills?.map((p) => `${p.label}${p.override === "true" ? "*" : ""}`).join(" | ")}`,
    );
    console.log(
      `line: attach ${JSON.stringify(report.initial.line?.attach)} | ` +
        `pick ${JSON.stringify(report.initial.line?.pick)} | ` +
        `line ${JSON.stringify(report.initial.line?.line)} (field bottom ${report.initial.line?.fieldBottom})`,
    );
    console.log(
      `menu: opens upward ${report.menu?.opensUpward}, inside the panel ${report.menu?.insidePanel}, ` +
        `${report.menu?.providerChips?.length} provider chip(s), ${report.menu?.rows?.length} row(s)`,
    );
    console.log(
      `picks: model "${report.pickedModel?.pills?.[0]?.label}" → thinking "${report.thinking?.label}" ` +
        `→ no-reasoning model leaves ${report.noReasoning?.pills?.length} pill(s)`,
    );
    console.log(`turn: runtime ${JSON.stringify(report.sent?.runtime)}`);
    console.log(
      `per chat: second chat opened on "${report.secondRow?.pills?.[0]?.label}", ` +
        `its turn carried ${JSON.stringify(report.secondTurn?.runtime)}, ` +
        `switching back gave "${report.backRow?.pills?.[0]?.label}"`,
    );
    console.log(`no catalog: row ${report.withoutCatalog?.row ? "rendered" : "absent"}`);
    console.log("");
  }
  console.log(`report: ${reportFile}`);
  for (const failure of report.failures ?? []) console.log(`FAIL ${failure}`);
  console.log(report.pass ? "composer model pills: PASS" : "composer model pills: FAIL");

  app.exit(report.pass ? 0 : 1);
}

app.on("window-all-closed", () => {});

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(`composer-model-pills: ${error instanceof Error ? error.stack : error}`);
    app.exit(1);
  });

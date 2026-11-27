/**
 * LifeQuest landing page.
 *
 * Vanilla, one file, no dependencies. Everything here is progressive: with
 * JavaScript off the page is still fully readable, and every motion below is
 * behind a reduced-motion check.
 */
(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const canAnimate = () => !reducedMotion.matches;

  const html = document.documentElement;
  const body = document.body;

  /* ----------------------------------------------------------------------
     Ticker: duplicate the phrases once, so the CSS marquee can loop at 50%.
     ---------------------------------------------------------------------- */
  const tickerTrack = $("[data-ticker-track]");
  if (tickerTrack) {
    tickerTrack.innerHTML += tickerTrack.innerHTML;
  }

  /* ----------------------------------------------------------------------
     Header state and scroll progress
     ---------------------------------------------------------------------- */
  const header = $("[data-testid='site-header']");
  const progress = $(".scroll-progress span");
  const axisDegree = $("[data-axis-degree]");

  let scrollQueued = false;
  const onScroll = () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      const y = window.scrollY || 0;
      header?.classList.toggle("is-scrolled", y > 24);
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = max > 0 ? Math.min(y / max, 1) : 0;
      if (progress) progress.style.transform = `scaleX(${ratio})`;
      if (axisDegree) axisDegree.textContent = `${(ratio * 99.99).toFixed(2).padStart(5, "0")}°`;
    });
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ----------------------------------------------------------------------
     Mobile menu
     ---------------------------------------------------------------------- */
  const menuToggle = $("[data-testid='menu-toggle']");
  const mobileMenu = $("[data-testid='mobile-menu']");
  const pageMain = $("#main");
  const pageFooter = $(".site-footer");
  const headerBrand = $(".site-header .brand");
  const headerCta = $("[data-testid='header-cta']");
  const inertTargets = [pageMain, pageFooter, headerBrand, headerCta].filter(Boolean);
  let menuOpen = false;

  const menuFocusables = () => {
    const inside = mobileMenu
      ? $$("a[href], button", mobileMenu).filter((element) => !element.disabled)
      : [];
    // The close control lives in the header chrome; keep it in the tab cycle so
    // the modal is not a keyboard trap with no way to close it.
    return menuToggle ? [menuToggle, ...inside] : inside;
  };

  const setInert = (inert) => {
    inertTargets.forEach((element) => {
      element.inert = inert;
      if (inert) element.setAttribute("aria-hidden", "true");
      else element.removeAttribute("aria-hidden");
    });
  };

  const setMenu = (open, restoreFocus = true) => {
    if (!menuToggle || !mobileMenu) return;
    menuOpen = open;
    menuToggle.setAttribute("aria-expanded", String(open));
    menuToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    body.classList.toggle("menu-open", open);
    setInert(open);
    mobileMenu.hidden = !open;
    if (open) {
      window.setTimeout(() => $$("a[href]", mobileMenu)[0]?.focus(), 30);
    } else if (restoreFocus) {
      menuToggle.focus();
    }
  };

  menuToggle?.addEventListener("click", () => setMenu(!menuOpen));
  $$("[data-mobile-link]").forEach((link) => link.addEventListener("click", () => setMenu(false)));
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menuOpen) setMenu(false);
  });
  mobileMenu?.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || !menuOpen) return;
    const focusables = menuFocusables();
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && (document.activeElement === first || !mobileMenu.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  window.addEventListener("resize", () => {
    if (window.innerWidth > 1024 && menuOpen) setMenu(false);
  });

  /* ----------------------------------------------------------------------
     Scroll reveals
     ---------------------------------------------------------------------- */
  // The premise statement is a line-mask display; it reveals line by line.
  $$(".premise__statement").forEach((statement) => statement.classList.add("reveal"));

  if ("IntersectionObserver" in window) {
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-in");
          revealObserver.unobserve(entry.target);
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    $$(".reveal").forEach((element) => revealObserver.observe(element));
  } else {
    $$(".reveal").forEach((element) => element.classList.add("is-in"));
  }

  /* ----------------------------------------------------------------------
     Section rail
     ---------------------------------------------------------------------- */
  const railDots = $$("[data-rail-target]");
  const sectionIds = ["top", "premise", "harness", "alignment", "sovereignty", "system", "access"];
  const setRail = (id) => {
    railDots.forEach((dot) => {
      dot.classList.toggle("is-active", dot.dataset.railTarget === id);
    });
    $$("[data-nav-link]").forEach((link) => {
      link.classList.toggle("is-current", link.getAttribute("href") === `#${id}`);
    });
  };

  if ("IntersectionObserver" in window && railDots.length) {
    const sectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setRail(entry.target.id);
        });
      },
      { rootMargin: "-42% 0px -50% 0px", threshold: 0 }
    );
    sectionIds.forEach((id) => {
      const section = document.getElementById(id);
      if (section) sectionObserver.observe(section);
    });
  }

  /* ----------------------------------------------------------------------
     Hero parallax
     ---------------------------------------------------------------------- */
  const axis = $("[data-testid='axis-visual']");
  if (axis && finePointer.matches && canAnimate()) {
    let frame = 0;
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;

    const render = () => {
      currentX += (targetX - currentX) * 0.08;
      currentY += (targetY - currentY) * 0.08;
      axis.style.setProperty("--ax", `${currentX.toFixed(2)}px`);
      axis.style.setProperty("--ay", `${currentY.toFixed(2)}px`);
      if (Math.abs(targetX - currentX) > 0.05 || Math.abs(targetY - currentY) > 0.05) {
        frame = requestAnimationFrame(render);
      } else {
        frame = 0;
      }
    };

    const queue = () => {
      if (!frame) frame = requestAnimationFrame(render);
    };

    window.addEventListener(
      "pointermove",
      (event) => {
        targetX = (event.clientX / window.innerWidth - 0.5) * 22;
        targetY = (event.clientY / window.innerHeight - 0.5) * 18;
        queue();
      },
      { passive: true }
    );
  }

  /* ----------------------------------------------------------------------
     Magnetic primary buttons
     ---------------------------------------------------------------------- */
  if (finePointer.matches && canAnimate()) {
    $$(".btn").forEach((button) => {
      const strength = 0.16;
      button.addEventListener("pointermove", (event) => {
        const rect = button.getBoundingClientRect();
        const dx = (event.clientX - (rect.left + rect.width / 2)) * strength;
        const dy = (event.clientY - (rect.top + rect.height / 2)) * strength;
        button.style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)`;
      });
      button.addEventListener("pointerleave", () => {
        button.style.transform = "";
      });
    });
  }

  /* ----------------------------------------------------------------------
     Custom cursor
     ---------------------------------------------------------------------- */
  const cursor = $(".cursor");
  if (cursor && finePointer.matches && canAnimate()) {
    body.classList.add("has-cursor");
    const dot = $(".cursor__dot", cursor);
    const ring = $(".cursor__ring", cursor);
    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let dotX = mouseX;
    let dotY = mouseY;
    let ringX = mouseX;
    let ringY = mouseY;
    let cursorFrame = 0;

    const renderCursor = () => {
      dotX += (mouseX - dotX) * 0.4;
      dotY += (mouseY - dotY) * 0.4;
      ringX += (mouseX - ringX) * 0.14;
      ringY += (mouseY - ringY) * 0.14;
      if (dot) dot.style.transform = `translate(${dotX}px, ${dotY}px) translate(-50%, -50%)`;
      if (ring) ring.style.transform = `translate(${ringX}px, ${ringY}px) translate(-50%, -50%)`;
      const settled =
        Math.abs(mouseX - dotX) < 0.15 &&
        Math.abs(mouseY - dotY) < 0.15 &&
        Math.abs(mouseX - ringX) < 0.15 &&
        Math.abs(mouseY - ringY) < 0.15;
      cursorFrame = settled ? 0 : requestAnimationFrame(renderCursor);
    };

    const queueCursor = () => {
      if (!cursorFrame) cursorFrame = requestAnimationFrame(renderCursor);
    };

    window.addEventListener(
      "pointermove",
      (event) => {
        mouseX = event.clientX;
        mouseY = event.clientY;
        const interactive = event.target instanceof Element
          ? event.target.closest("a, button, input, .wing, .stack__row, .shelf__items li")
          : null;
        cursor.classList.toggle("is-hover", Boolean(interactive));
        queueCursor();
      },
      { passive: true }
    );
    window.addEventListener("pointerleave", () => {
      cursor.style.opacity = "0";
    });
    window.addEventListener("pointerenter", () => {
      cursor.style.opacity = "";
      queueCursor();
    });
    queueCursor();
  }

  /* ----------------------------------------------------------------------
     Harness preview tabs
     ---------------------------------------------------------------------- */
  const tabs = $$("[data-mock-tab]");
  const panels = $$("[data-mock-panel]");

  const selectTab = (name, focus = false) => {
    tabs.forEach((tab) => {
      const active = tab.dataset.mockTab === name;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus();
    });
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.mockPanel !== name;
    });
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(tab.dataset.mockTab));
    tab.addEventListener("keydown", (event) => {
      let next = null;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      if (next === null) return;
      event.preventDefault();
      selectTab(tabs[next].dataset.mockTab, true);
    });
  });

  /* ----------------------------------------------------------------------
     Vertical alignment stack
     ---------------------------------------------------------------------- */
  const layers = $$("[data-layer]");
  const preview = $("[data-testid='stack-preview']");
  let stackManualAt = 0;
  const setLayer = (index) => {
    if (!layers.length) return;
    const safe = Math.max(0, Math.min(index, layers.length - 1));
    layers.forEach((layer, i) => layer.classList.toggle("is-active", i === safe));
    if (!preview) return;
    const title = $(".stack__title", layers[safe])?.textContent?.trim() ?? "";
    const desc = $(".stack__desc", layers[safe])?.textContent?.trim() ?? "";
    const titleEl = $("[data-stack-title]", preview);
    const descEl = $("[data-stack-desc]", preview);
    const indexEl = $("[data-stack-index]", preview);
    if (titleEl) titleEl.textContent = title;
    if (descEl) descEl.textContent = desc;
    if (indexEl) indexEl.textContent = `${String(safe + 1).padStart(2, "0")} / ${String(layers.length).padStart(2, "0")}`;
    $$("[data-stack-node]", preview).forEach((node, i) => node.classList.toggle("is-active", i === safe));
    preview.style.setProperty(
      "--stack-fill",
      `${layers.length > 1 ? (safe / (layers.length - 1)) * 100 : 0}%`
    );
  };

  layers.forEach((layer, index) => {
    const choose = () => {
      stackManualAt = performance.now();
      setLayer(index);
    };
    layer.addEventListener("pointerenter", choose);
    layer.addEventListener("focus", choose);
    layer.addEventListener("click", choose);
  });
  if (layers.length) setLayer(0);

  // On desktop the axis is also a scroll instrument: the layer nearest the
  // middle of the viewport becomes the active rung as the reader descends.
  if (preview && layers.length) {
    let stackQueued = false;
    const syncStackFromScroll = () => {
      if (stackQueued) return;
      stackQueued = true;
      requestAnimationFrame(() => {
        stackQueued = false;
        if (!window.matchMedia("(min-width: 901px)").matches) return;
        if (!preview.getClientRects().length) return;
        if (performance.now() - stackManualAt < 1400) return;
        const section = document.getElementById("alignment");
        if (!section) return;
        const sectionRect = section.getBoundingClientRect();
        // Above or below the section, the instrument returns to its resting
        // state; it only performs while the reader is inside it.
        if (sectionRect.bottom < window.innerHeight * 0.12 || sectionRect.top > window.innerHeight * 0.88) {
          setLayer(0);
          return;
        }
        const middle = window.innerHeight * 0.48;
        let nearest = 0;
        let distance = Infinity;
        layers.forEach((layer, index) => {
          const rect = layer.getBoundingClientRect();
          const centre = (rect.top + rect.bottom) / 2;
          const gap = Math.abs(centre - middle);
          if (rect.bottom > window.innerHeight * 0.15 && rect.top < window.innerHeight * 0.85 && gap < distance) {
            nearest = index;
            distance = gap;
          }
        });
        if (distance < window.innerHeight * 0.45) setLayer(nearest);
      });
    };
    window.addEventListener("scroll", syncStackFromScroll, { passive: true });
    syncStackFromScroll();
  }

  /* ----------------------------------------------------------------------
     Stats counters
     ---------------------------------------------------------------------- */
  const counters = $$("[data-count]");
  if (counters.length && "IntersectionObserver" in window && canAnimate()) {
    const countObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const element = entry.target;
          const target = Number(element.dataset.count || 0);
          countObserver.unobserve(element);
          if (target === 0) {
            element.textContent = "0";
            return;
          }
          const duration = 1100;
          const start = performance.now();
          const step = (now) => {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            element.textContent = String(Math.round(target * eased));
            if (progress < 1) requestAnimationFrame(step);
            else element.textContent = String(target);
          };
          requestAnimationFrame(step);
        });
      },
      { threshold: 0.6 }
    );
    counters.forEach((counter) => countObserver.observe(counter));
  }

  /* ----------------------------------------------------------------------
     Access form
     ---------------------------------------------------------------------- */
  const form = $("[data-testid='access-form']");
  const emailInput = $("[data-testid='access-email']");
  const status = $("[data-testid='access-status']");
  const success = $("[data-testid='access-success']");
  const liveStatus = $("[data-live-status]");
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!emailInput || !status) return;
    const value = emailInput.value.trim();
    if (!emailPattern.test(value)) {
      emailInput.setAttribute("aria-invalid", "true");
      status.classList.remove("is-ok");
      status.textContent = "Please enter a valid email address, like you@yourdomain.com.";
      emailInput.focus();
      return;
    }
    emailInput.removeAttribute("aria-invalid");
    status.textContent = "";
    form.hidden = true;
    if (liveStatus) liveStatus.textContent = "Request received. You're on the list.";
    if (success) {
      success.hidden = false;
      success.focus({ preventScroll: true });
    }
  });

  emailInput?.addEventListener("input", () => {
    if (emailInput.getAttribute("aria-invalid") === "true") {
      emailInput.removeAttribute("aria-invalid");
      if (status) status.textContent = "";
      if (liveStatus) liveStatus.textContent = "";
    }
  });

  /* ----------------------------------------------------------------------
     Footer year
     ---------------------------------------------------------------------- */
  $$("[data-year]").forEach((year) => {
    year.textContent = String(new Date().getFullYear());
  });

  /* ----------------------------------------------------------------------
     Ready signal for the E2E rig and screenshot captures
     ---------------------------------------------------------------------- */
  const markReady = () => {
    html.dataset.ready = "true";
    window.__LIFEQUEST_LANDING_READY__ = true;
  };
  const fontsReady = document.fonts?.ready ?? Promise.resolve();
  fontsReady.then(() => {
    requestAnimationFrame(() => requestAnimationFrame(markReady));
  });
})();

(function () {
  try {
    var pref = localStorage.getItem("lifequest-theme");
    if (pref === "light" || pref === "dark") {
      document.documentElement.setAttribute("data-theme", pref);
    } else if (pref === "system") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", "dark");
    }
  } catch (e) {}
  /*
   * Which lockup the splash wears. The same key the app writes from Settings →
   * Developer (`src/lib/brand/logo.ts`); unknown values fall back to the shipped
   * default, as the app's own reader does. The splash has to know this before
   * React exists, which is why it is localStorage and not the app profile.
   */
  try {
    var logo = localStorage.getItem("lifequest-logo");
    var known = ["modern", "athletic", "classic", "minimal"];
    document.documentElement.setAttribute(
      "data-logo",
      known.indexOf(logo) >= 0 ? logo : "minimal",
    );
  } catch (e) {
    document.documentElement.setAttribute("data-logo", "minimal");
  }
  window.__LQ_SPLASH_T0 = performance.now();
})();

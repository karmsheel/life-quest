/**
 * Copy text to the clipboard, with a fallback for the packaged app.
 *
 * The window loads `file://` in a packaged build, where `navigator.clipboard` is
 * not guaranteed to exist; the execCommand path is the one that still works
 * there. A failure is reported rather than swallowed, because a Copy button that
 * silently does nothing is worse than no button.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the textarea path
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/**
 * The mark a chat from another surface wears at the start of its name.
 *
 * A conversation begun on Telegram or Discord is still the same conversation in
 * the dock, and the operator should see WHERE it began without reading a word:
 * the tab strip and the Chats rail lead the name with the platform's own mark,
 * and the thread header's chip wears it too. A word would be repeated in every
 * list and would not survive a narrow tab; the logo says it once, at a glance.
 *
 * Only platforms with a recognisable mark are drawn as one. Everything else
 * Hermes can be reached from (Hermes Desktop, the CLI, an automation, a platform
 * a plugin added later) falls back to the generic share mark beside its name, so
 * a new surface reads as "another surface" instead of wearing the wrong brand.
 *
 * The brand paths are the Simple Icons glyphs (CC0 1.0, simpleicons.org), drawn
 * as a single filled `currentColor` path so the studio's skins colour them like
 * every other icon: muted at rest, the foreground on the active chat, the accent
 * while a turn is live. They are decorative — the chat's name, or the chip's
 * accessible label, is what a screen reader announces.
 */
import type { CSSProperties, ReactElement } from "react";

export type PlatformMarkProps = {
  className?: string;
  style?: CSSProperties;
  /** Rendered box in CSS pixels; the marks keep the 24×24 viewBox either way. */
  size?: number;
};

export type PlatformMarkComponent = (props: PlatformMarkProps) => ReactElement;

/** Simple Icons' 24×24 path for one platform. Always decorative: the chat's
 *  name (or the chip's accessible label) is what names the surface. */
function brandPath(name: string, path: string): PlatformMarkComponent {
  return function PlatformMark({
    className,
    style,
    size = 11,
  }: PlatformMarkProps): ReactElement {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className={className}
        style={style}
        fill="currentColor"
        focusable="false"
        aria-hidden="true"
        data-platform-mark={name}
      >
        <path d={path} />
      </svg>
    );
  };
}

const TELEGRAM_PATH =
  "M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z";

const DISCORD_PATH =
  "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z";

const MARKS: Record<string, PlatformMarkComponent> = {
  telegram: brandPath("telegram", TELEGRAM_PATH),
  discord: brandPath("discord", DISCORD_PATH),
};

/**
 * The mark for a session's surface, or null when this platform has no glyph of
 * its own. `source` is the gateway's own label (`telegram`, `discord`, …).
 */
export function platformMarkFor(
  source: string | null | undefined,
): PlatformMarkComponent | null {
  const key = (source ?? "").trim().toLowerCase();
  if (!key) return null;
  return MARKS[key] ?? null;
}

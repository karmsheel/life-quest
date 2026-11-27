/**
 * The icon a kickoff chat wears at the start of its name, by the kind of work
 * that started it.
 *
 * Two surfaces draw a chat's name — the dock's tab strip and the Chats list's
 * rows — and both must pick the same glyph for the same kind: an origin mark
 * that differs between the tab and the row would be two vocabularies for one
 * fact. The map therefore lives here rather than beside either renderer, and it
 * is the only place a kickoff kind becomes an icon.
 *
 * Each icon is the one the feature that starts the chat already uses in the
 * rail: a task from the Act board, a reviewed book, a goal for a planning
 * session, the automations' sparkle. The mark is `aria-hidden` wherever it is
 * drawn — the chat's name, not the icon, is what a screen reader announces.
 */
import {
  BookOpenCheck,
  Goal,
  ListTodo,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import type { SessionIcon } from "@/state/session-icons";

export const SESSION_ICON: Record<SessionIcon, LucideIcon> = {
  task: ListTodo,
  review: BookOpenCheck,
  plan: Goal,
  automation: WandSparkles,
};

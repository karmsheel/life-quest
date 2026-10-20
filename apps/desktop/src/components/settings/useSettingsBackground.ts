/**
 * Kept as the settings rigs' name for the sheet background.
 *
 * Settings is now one of two sheets — the decisions inbox is the other — so the
 * shared hook lives beside them in `shell/useSheetBackground.ts`. This alias
 * keeps the settings harness reading the same source of truth without knowing
 * about the second sheet.
 */
export {
  useSheetBackground as useSettingsBackground,
  type SheetKind,
} from "@/components/shell/useSheetBackground";

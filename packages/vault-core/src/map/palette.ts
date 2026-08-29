import type { ColorId } from "./types.ts";

export const COLOR_IDS: ColorId[] = [
  "gold",
  "red",
  "blue",
  "green",
  "orange",
  "purple",
  "teal",
  "pink",
];

export const PALETTE: Record<ColorId, string> = {
  gold: "#FFF2CC",
  red: "#F4CCCC",
  blue: "#CFE2F3",
  green: "#B6D7A8",
  orange: "#F9CB9C",
  purple: "#D5A6E6",
  teal: "#A2C4C9",
  pink: "#EAD1DC",
};

export function isColorId(value: string): value is ColorId {
  return (COLOR_IDS as string[]).includes(value);
}

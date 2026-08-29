import { daysInMonth } from "@lifequest/vault-core/map";

export type GridCell = { inMonth: boolean; day?: number };

export function monthGrid(year: number, month: number): GridCell[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const jsDay = first.getUTCDay();
  const leading = jsDay === 0 ? 6 : jsDay - 1;
  const n = daysInMonth(year, month);
  const cells: GridCell[] = [
    ...Array.from({ length: leading }, () => ({ inMonth: false })),
    ...Array.from({ length: n }, (_, i) => ({ inMonth: true, day: i + 1 })),
  ];
  while (cells.length % 7 !== 0) cells.push({ inMonth: false });
  const rows: GridCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

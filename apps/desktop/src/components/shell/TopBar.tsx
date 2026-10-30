import { DomainSwitcher } from "./DomainSwitcher";

/**
 * The sheet's top band.
 *
 * The wing switcher used to share this row; it now lives in the sidebar's own
 * band above the wing's pages. What is left here is the domain lens alone, and
 * the band centres it.
 */
export function TopBar() {
  return (
    <header className="top-bar">
      <DomainSwitcher />
    </header>
  );
}

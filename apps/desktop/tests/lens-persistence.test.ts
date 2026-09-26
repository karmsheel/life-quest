import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { domainLens, overviewLens } from "@lifequest/vault-core/pure";
import {
  resolveRestoredLens,
  shouldClearLensForSnapshot,
  type LensSnapshot,
} from "../src/state/lens-persistence.ts";

function vault(
  id: string,
  domains: { slug: string; archived?: boolean }[],
): LensSnapshot {
  return {
    lifequest: { id },
    domains: domains.map((d) => ({
      slug: d.slug,
      meta: { archivedAt: d.archived ? "2026-09-01T00:00:00.000Z" : null },
    })),
  };
}

describe("resolveRestoredLens", () => {
  const snapshot = vault("vault-b", [{ slug: "health" }, { slug: "money" }]);

  it("restores a live saved slug", () => {
    assert.deepEqual(resolveRestoredLens("money", snapshot), {
      lens: domainLens("money"),
      clearSaved: false,
    });
  });

  it("uses Overview when this vault has no saved lens", () => {
    assert.deepEqual(resolveRestoredLens(null, snapshot), {
      lens: overviewLens(),
      clearSaved: false,
    });
  });

  it("uses Overview and forgets a saved slug that is archived or missing", () => {
    const archived = vault("vault-b", [
      { slug: "health" },
      { slug: "money", archived: true },
    ]);
    assert.deepEqual(resolveRestoredLens("money", archived), {
      lens: overviewLens(),
      clearSaved: true,
    });
    assert.deepEqual(resolveRestoredLens("gone", snapshot), {
      lens: overviewLens(),
      clearSaved: true,
    });
  });
});

describe("shouldClearLensForSnapshot", () => {
  it("does not write Overview onto a different vault", () => {
    const next = vault("vault-b", [{ slug: "money" }]);
    assert.equal(
      shouldClearLensForSnapshot("vault-a", next, domainLens("health")),
      false,
    );
    assert.equal(
      shouldClearLensForSnapshot("vault-a", next, domainLens("money")),
      false,
    );
  });

  it("clears a lens when that domain was archived in the same vault", () => {
    const next = vault("vault-a", [{ slug: "health", archived: true }]);
    assert.equal(
      shouldClearLensForSnapshot("vault-a", next, domainLens("health")),
      true,
    );
  });

  it("leaves a live same-vault lens alone", () => {
    const next = vault("vault-a", [{ slug: "health" }]);
    assert.equal(
      shouldClearLensForSnapshot("vault-a", next, domainLens("health")),
      false,
    );
    assert.equal(
      shouldClearLensForSnapshot("vault-a", next, overviewLens()),
      false,
    );
  });

  it("does not persist a clear when the vault is closing", () => {
    assert.equal(
      shouldClearLensForSnapshot("vault-a", null, domainLens("health")),
      false,
    );
  });
});

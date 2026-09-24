import type { AdapterKind, AdapterTransport, Result, RemotePull } from "@lifequest/vault-core";

// KAR-59 adapter transport — real HTTP lives only here.
// Implements AdapterTransport from vault-core.

export const adapterTransport: AdapterTransport = {
  async pull(input: {
    kind: AdapterKind;
    bindingId: string;
    secret: string;
  }): Promise<Result<RemotePull>> {
    try {
      if (input.kind === "google-sheet") {
        return pullGoogleSheet(input.bindingId, input.secret);
      }
      if (input.kind === "notion") {
        return pullNotion(input.bindingId, input.secret);
      }
      if (input.kind === "url") {
        return pullUrl(input.secret);
      }
      return { ok: false, error: `Unknown adapter kind: ${input.kind}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  async pushRow(input: {
    kind: AdapterKind;
    bindingId: string;
    secret: string;
    externalId: string;
    cells: Record<string, string>;
  }): Promise<Result<true>> {
    try {
      if (input.kind === "google-sheet") {
        return pushGoogleSheet(input.bindingId, input.secret, input.externalId, input.cells);
      }
      if (input.kind === "notion") {
        return pushNotion(input.bindingId, input.secret, input.externalId, input.cells);
      }
      if (input.kind === "url") {
        return pushUrl(input.secret, input.externalId, input.cells);
      }
      return { ok: false, error: `Unknown adapter kind: ${input.kind}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  async deleteRow(input: {
    kind: AdapterKind;
    bindingId: string;
    secret: string;
    externalId: string;
  }): Promise<Result<true>> {
    try {
      if (input.kind === "google-sheet") {
        // Sheets API doesn't have a direct "delete row" — return error per spec
        return { ok: false, error: "Delete not supported for Google Sheets" };
      }
      if (input.kind === "notion") {
        return deleteNotion(input.bindingId, input.secret, input.externalId);
      }
      if (input.kind === "url") {
        return deleteUrl(input.secret, input.externalId);
      }
      return { ok: false, error: `Unknown adapter kind: ${input.kind}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
};

// ─── Google Sheets ───

async function pullGoogleSheet(
  spreadsheetId: string,
  token: string,
): Promise<Result<RemotePull>> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/A1:ZZ`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    return { ok: false, error: `Google Sheets API error: ${res.status}` };
  }
  const data = (await res.json()) as {
    values?: string[][];
  };
  if (!data.values || data.values.length === 0) {
    return { ok: false, error: "Sheet is empty" };
  }

  const [headers, ...rows] = data.values;
  if (!headers || headers.length === 0) {
    return { ok: false, error: "No columns in sheet" };
  }

  const columns = headers.map((h, i) => h || `col_${i + 1}`);
  const outRows = rows.map((row, rowIdx) => {
    const cells: Record<string, string> = {};
    for (let i = 0; i < columns.length; i++) {
      cells[columns[i]!] = row[i] ?? "";
    }
    return {
      externalId: cells["external_id"] || `row:${rowIdx + 1}`,
      cells,
    };
  });

  return { ok: true, value: { columns, rows: outRows } };
}

async function pushGoogleSheet(
  spreadsheetId: string,
  token: string,
  externalId: string,
  cells: Record<string, string>,
): Promise<Result<true>> {
  // Find the row by external_id column, then update it
  const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/A1:ZZ`;
  const readRes = await fetch(readUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!readRes.ok) {
    return { ok: false, error: `Google Sheets read error: ${readRes.status}` };
  }
  const readData = (await readRes.json()) as { values?: string[][] };
  if (!readData.values || readData.values.length === 0) {
    return { ok: false, error: "Sheet is empty" };
  }

  const headers = readData.values[0]!;
  const eidIdx = headers.findIndex((h) => h === "external_id");
  if (eidIdx === -1) {
    return { ok: false, error: "No external_id column in sheet" };
  }

  const rowIdx = readData.values.findIndex(
    (row, i) => i > 0 && row[eidIdx] === externalId,
  );
  if (rowIdx === -1) {
    return { ok: false, error: `Row not found: ${externalId}` };
  }

  // Update the row
  const range = `A${rowIdx + 1}:${String.fromCharCode(65 + headers.length - 1)}${rowIdx + 1}`;
  const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}?valueInputOption=RAW`;
  const body = { values: [headers.map((h) => cells[h] ?? "")] };
  const updateRes = await fetch(updateUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!updateRes.ok) {
    return { ok: false, error: `Google Sheets update error: ${updateRes.status}` };
  }
  return { ok: true, value: true };
}

// ─── Notion ───

async function pullNotion(
  databaseId: string,
  token: string,
): Promise<Result<RemotePull>> {
  const url = `https://api.notion.com/v1/databases/${encodeURIComponent(databaseId)}/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ page_size: 100 }),
  });
  if (!res.ok) {
    return { ok: false, error: `Notion API error: ${res.status}` };
  }
  const data = (await res.json()) as {
    results?: Array<{
      id: string;
      properties: Record<string, { type: string; title?: Array<{ plain_text?: string }>; rich_text?: Array<{ plain_text?: string }>; number?: number | null; select?: { name?: string } | null; date?: { start?: string } | null; checkbox?: boolean }>;
    }>;
    has_more?: boolean;
    next_cursor?: string;
  };

  if (!data.results || data.results.length === 0) {
    return { ok: true, value: { columns: [], rows: [] } };
  }

  // Collect all property names as columns
  const colSet = new Set<string>();
  for (const page of data.results) {
    for (const key of Object.keys(page.properties)) {
      colSet.add(key);
    }
  }
  const columns = Array.from(colSet);

  const outRows = data.results.map((page) => {
    const cells: Record<string, string> = {};
    for (const [key, prop] of Object.entries(page.properties)) {
      if (prop.type === "title" && prop.title?.[0]?.plain_text) {
        cells[key] = prop.title[0].plain_text;
      } else if (prop.type === "rich_text" && prop.rich_text?.[0]?.plain_text) {
        cells[key] = prop.rich_text[0].plain_text;
      } else if (prop.type === "number" && prop.number != null) {
        cells[key] = String(prop.number);
      } else if (prop.type === "select" && prop.select?.name) {
        cells[key] = prop.select.name;
      } else if (prop.type === "date" && prop.date?.start) {
        cells[key] = prop.date.start;
      } else if (prop.type === "checkbox") {
        cells[key] = prop.checkbox ? "true" : "false";
      } else {
        cells[key] = "";
      }
    }
    return { externalId: page.id, cells };
  });

  return { ok: true, value: { columns, rows: outRows } };
}

async function pushNotion(
  databaseId: string,
  token: string,
  externalId: string,
  cells: Record<string, string>,
): Promise<Result<true>> {
  // Find the page by external_id property
  const searchUrl = `https://api.notion.com/v1/databases/${encodeURIComponent(databaseId)}/query`;
  const searchRes = await fetch(searchUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filter: {
        property: "external_id",
        rich_text: { equals: externalId },
      },
    }),
  });
  if (!searchRes.ok) {
    return { ok: false, error: `Notion search error: ${searchRes.status}` };
  }
  const searchData = (await searchRes.json()) as {
    results?: Array<{ id: string }>;
  };
  if (!searchData.results || searchData.results.length === 0) {
    return { ok: false, error: `Page not found: ${externalId}` };
  }
  const pageId = searchData.results[0]!.id;

  // Build properties update
  const properties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(cells)) {
    properties[key] = { rich_text: [{ text: { content: value } }] };
  }

  const updateUrl = `https://api.notion.com/v1/pages/${encodeURIComponent(pageId)}`;
  const updateRes = await fetch(updateUrl, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ properties }),
  });
  if (!updateRes.ok) {
    return { ok: false, error: `Notion update error: ${updateRes.status}` };
  }
  return { ok: true, value: true };
}

async function deleteNotion(
  databaseId: string,
  token: string,
  externalId: string,
): Promise<Result<true>> {
  const searchUrl = `https://api.notion.com/v1/databases/${encodeURIComponent(databaseId)}/query`;
  const searchRes = await fetch(searchUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filter: {
        property: "external_id",
        rich_text: { equals: externalId },
      },
    }),
  });
  if (!searchRes.ok) {
    return { ok: false, error: `Notion search error: ${searchRes.status}` };
  }
  const searchData = (await searchRes.json()) as {
    results?: Array<{ id: string }>;
  };
  if (!searchData.results || searchData.results.length === 0) {
    return { ok: false, error: `Page not found: ${externalId}` };
  }
  const pageId = searchData.results[0]!.id;

  const archiveUrl = `https://api.notion.com/v1/pages/${encodeURIComponent(pageId)}`;
  const archiveRes = await fetch(archiveUrl, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ archived: true }),
  });
  if (!archiveRes.ok) {
    return { ok: false, error: `Notion archive error: ${archiveRes.status}` };
  }
  return { ok: true, value: true };
}

// ─── Operator URL ───

async function pullUrl(url: string): Promise<Result<RemotePull>> {
  const res = await fetch(url);
  if (!res.ok) {
    return { ok: false, error: `URL fetch error: ${res.status}` };
  }
  const data: unknown = await res.json();

  // Handle JSON array of objects → columns from keys
  if (Array.isArray(data)) {
    if (data.length === 0) {
      return { ok: true, value: { columns: [], rows: [] } };
    }
    const obj = data[0] as Record<string, unknown>;
    const columns = Object.keys(obj);
    const rows = data.map((item, idx) => {
      const cells: Record<string, string> = {};
      for (const col of columns) {
        cells[col] = String((item as Record<string, unknown>)[col] ?? "");
      }
      return {
        externalId: cells["external_id"] || `row:${idx + 1}`,
        cells,
      };
    });
    return { ok: true, value: { columns, rows } };
  }

  // Handle object with columns and rows
  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.columns) && Array.isArray(obj.rows)) {
      const columns = obj.columns.map(String);
      const rows = (obj.rows as Array<Record<string, unknown>>).map((row, idx) => {
        const cells: Record<string, string> = {};
        for (const col of columns) {
          cells[col] = String(row[col] ?? "");
        }
        return {
          externalId: cells["external_id"] || `row:${idx + 1}`,
          cells,
        };
      });
      const fx = obj.fx as { usdZarRate?: number; asOf?: string } | undefined;
      return {
        ok: true,
        value: {
          columns,
          rows,
          fx: fx && typeof fx.usdZarRate === "number" && fx.asOf ? fx : null,
        },
      };
    }
  }

  return { ok: false, error: "Unmapped URL shape" };
}

async function pushUrl(
  url: string,
  externalId: string,
  cells: Record<string, string>,
): Promise<Result<true>> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ externalId, cells }),
  });
  if (!res.ok) {
    return { ok: false, error: `URL PUT error: ${res.status}` };
  }
  return { ok: true, value: true };
}

async function deleteUrl(url: string, externalId: string): Promise<Result<true>> {
  const res = await fetch(url, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ externalId }),
  });
  if (!res.ok) {
    return { ok: false, error: `URL DELETE error: ${res.status}` };
  }
  return { ok: true, value: true };
}

# Personnel and agents

Personnel is where you see who works on your vault. It holds three different
things that all answer to the word "agent": the companion Hermes itself, the
external MCP agents you have connected over the pairing doors, and the Hermes
agents you have hired from a scan. It also holds the grant switches — which
domains an agent may reach, whether it may write, and whether it may touch the
Schedule — so the roster is not a list of names but the place authority is given
and taken away. See also [Wiki home](./README.md).

## Where it lives

- Rail: the Home wing, label **Personnel**, people icon. The route is
  `/personnel`.
- It is a page, not a sheet. The domain lens filters the hires section.
- The page's own summary line reads: "The companion, the agents connected over
  MCP, and the Hermes agents you have hired."
- The two **MCP doors** that connected agents arrive through are reported in
  **Settings → Hermes**, under the **MCP doors** heading.
- Pairing approvals happen in [Decisions](./23-decisions.md), not here.

## What it is for

LifeQuest separates two questions that a single "agent" feature usually merges:
*who is doing the work* and *what may they touch*. A hire records who is working
on which domain, for the operator's own roster. A connected agent is a different
roster with a real grant, because an MCP caller from another machine reaches the
vault through a socket and must be named before it is trusted.

The companion sits above both: it is pre-paired, keeps the whole vault, and has
nothing to configure here. The card says **Hermes**, "Full access · this
vault".

## How to use it

### Invite an agent over MCP

1. Choose **Invite an agent** in the **Connected agents** section. A one-time
   code appears in the panel: "Send this code to the agent. It is shown once and
   expires <time>."
2. Give the code to the agent's operator. It is 128 bits, single-use, and
   expires 24 hours after it was minted; unused codes are listed under **Unused
   invites** and can be removed with **Drop**.
3. In that agent's MCP client, add a server that points at the door the agent can
   reach. **Settings → Hermes** under **MCP doors** reports the two loopback
   URLs:
   - **Local** — `http://127.0.0.1:8643/mcp`, for a client on this machine.
   - **Invite** — `http://127.0.0.1:8646/mcp`, the door you forward through a
     tunnel you already trust (Tailscale, WireGuard, SSH).
4. Configure the client with its own bearer token of at least 22 characters, an
   `Authorization: Bearer <token>` header, and an `X-LifeQuest-Name: <name>`
   header. An agent arriving through the invite door also sends
   `X-LifeQuest-Invite: <code>`.
5. The first accepted contact files one pairing Decision titled **Connect
   <name>**. The card appears on this page immediately, reading "Waiting for
   approval", with the name, fingerprint and door, and shows no grant controls.
6. Approve it in [Decisions](./23-decisions.md). The row becomes active,
   read-only, with no domains and Schedule off.
7. Grant what the agent may reach on the card: tick domains under **Domains**,
   turn on **Write**, turn on **Schedule**. The change applies immediately.
8. **Revoke** ends the agent's access. The row keeps its fingerprint so the same
   bearer reconnects as the same agent instead of introducing itself again.

An active card shows `<fingerprint> · <door> door`. The fingerprint is the first
12 characters of the SHA-256 of the agent's bearer; the raw bearer and the raw
invite code are never stored in the vault, the Log, or an error message.

### Work with the roster

- **Refresh** re-reads the connected-agent roster or the hire list.
- **Companion** is fixed. There is no domain editor, no **Write** switch, no
  **Schedule** switch and no revoke: there is nothing to grant the companion
  that it does not already have.
- Hires appear under **Active hires** with their Hermes agent id and, when the
  record carries one, a role label and an assigned domain. **Dismiss** moves the
  hire out of the active roster; the record stays in the vault's history.
- The domain lens filters the hire list, so the Personnel page under the Health
  lens shows the hires assigned to Health. The connected-agent roster is not
  lens-filtered — a grant is a grant.

### Scan and hire a Hermes agent

1. Choose **Scan Hermes agents**. The button reads **Scanning…** while it probes
   and the empty area reads "Probing Hermes…".
2. Scanned agents appear with their name and id. **Hire** adds one to the active
   roster; a hire that already exists reads **Hired** and cannot be hired twice.
3. A successful scan says "Found N agent(s)."; a scan that finds nothing says
   "Scan complete — no agents found."
4. The hire is assigned the domain your lens is on, if any, and shows in **Active
   hires**.

Hiring is one button, not a form: there is no field to rename the agent, no role
picker and no model choice. The hire takes the scanned agent's own name and id,
and its domain is whatever lens you are looking through — **Overview** assigns
none. The product's model is that a hired agent either *advises* or *owns* a
domain, and that the vault records which agent acted; in this build the hire
record carries an optional role label and a domain slug, and the Personnel button
writes the domain from your lens and leaves the role label empty. Role labels are
read and shown when the roster carries one.

## The screen

| Part | What it does |
|---|---|
| Header | **Personnel** and the one-line description of the three kinds of agent. |
| **Companion** | One fixed card: **Hermes**, "Full access · this vault". |
| **Connected agents** | **Invite an agent**, **Refresh**; cards for pending and active MCP callers with **Domains**, **Write**, **Schedule**, **Revoke**; **Unused invites** with **Drop**. |
| **Scan** | **Scan Hermes agents** and the results list with **Hire** / **Hired**. |
| **Active hires** | **Refresh** and the hire cards with **Dismiss**. |
| Error banner | A red message with the reason; when Hermes looks unreachable it adds an **Open Settings →** link and a banner with **Go to Settings**. |

## Rules and behaviour

- **A pending agent has no tools at all.** Until its Decision is approved, its
  `tools/call` answers `PAIRING_PENDING` and its `tools/list` is empty. A
  rejected agent gets `PAIRING_REJECTED`, a revoked one
  `PAIRING_REVOKED`. Approval is what makes the row active; it does not itself
  grant anything.
- **A grant starts empty.** A new agent is read-only, has no domains, and has
  Schedule off. **Domains** accepts live domains only, and an archived domain
  drops out of the effective grant while it stays archived.
- **Reads need a domain.** A read is allowed only while at least one assigned
  domain is live. A record outside the assignment answers `NOT_FOUND`, so an
  agent cannot tell "you may not see this" from "this does not exist".
- **Writes need Write, and the domains they name must be assigned.** With
  **Write** off, every write tool answers `FORBIDDEN`.
- **The capture thread additionally needs Financial assigned**, because
  `capture_transaction`, `undo_capture` and `correct_capture` name no domain of
  their own and write the finance ledger.
- **Some tools stay with the companion.** `create_year`, `delete_year`,
  `set_month_day`, `set_month_objectives`, `set_month_notes` and `set_about_me`
  configure the vault rather than a domain, so a connected agent that calls one
  is refused.
- **An unclassified tool is refused.** Anything not on the lists below is
  `FORBIDDEN` by name; a tool added in a later build does not become writable by
  falling through. `write_review` and `unlock_review` are not offered to
  connected agents at all.
- **Pairing secrets stay outside the vault.** The roster is
  `.lifequest/connected-agents.json` and carries no secrets. The companion token,
  the agents' bearer hashes and the invite-code hashes live in the app's own
  userData (`pairing-secrets/connected-agent-secrets.json`), so a copied vault
  never carries an agent's credential. The hired roster is
  `.lifequest/agents.json`.
- **Matches the companion's write rules.** A connected agent that is allowed to
  write still has the same two shapes the companion has: some writes apply at
  once and others wait in [Decisions](./23-decisions.md). The domain grant only
  decides whether the agent may reach the tool at all.
- **The door is loopback only.** Neither door binds a public or private-network
  address and neither terminates TLS; the invite door is meant to be forwarded
  through a tunnel you trust. A request whose `Host` is not `127.0.0.1` or
  `localhost` is refused before authentication.

### What an approved agent can call

Reads, inside its assigned domains: `get_doctrine`, `list_documents`,
`get_document`, `list_databases`, `get_database`, `list_rows`, `get_row`,
`list_decisions`, `list_goals`, `get_state`, `get_review`, `list_reviews`,
`get_period_pack`, `run_script_block`, `preview_view`, `list_views`,
`get_dashboard`.

With **Schedule** on, additionally: `get_week`.

With **Schedule** and **Write** on, the live week and the task board:
`set_week_day_type`, `set_week_day_items`, `set_week_weekly_items`,
`place_grid_block`, `clear_grid_block`, `reset_week`, `create_task`,
`update_task`, `move_task`, `delete_task`.

With **Schedule** and **Write** on, the day templates — these file a Decision
rather than landing on their own: `create_day_type`, `update_day_type`,
`delete_day_type`, `set_default_weekday_type`, `set_default_weekly_items`.

With **Write** on, the writes that file a Decision: `update_document`,
`create_library_document`, `create_goal`, `update_goal`, `delete_goal`,
`create_project`, `update_project`, `close_project`, `upsert_row`,
`delete_row`, `create_database`, `add_column`, `save_view`,
`arrange_dashboard`.

With **Write** on, the writes that apply immediately: `create_event`,
`update_event`, `delete_event`, `apply_script_block`, `mark_review_done`, and —
with Financial assigned — `capture_transaction`, `undo_capture`,
`correct_capture`.

The companion is not limited by these lists. It keeps its full surface and its
rules: reads are free, and its document and ledger writes go through Decisions
except for Schedule tasks, an unambiguous conversational transaction, and page
script blocks. Those rules are stated in [The Companion](./24-companion.md).

## Tips and edge cases

- **A hire is not a connection.** The **Active hires** roster names Hermes agents
  you have scanned and hired; it does not give any external process access to the
  vault. Access is the **Connected agents** roster and its grant switches.
- **A pairing Decision belongs to no domain**, so it appears under every lens and
  cannot be filtered away — it is the one card that must be answered.
- **The invite code cannot be read back.** It is shown once at the mint; if you
  lose it, **Drop** the unused invite and mint another.
- **The pending cap is 20.** A 21st introduction is refused with "Too many agents
  are waiting for approval" instead of filling the inbox.
- **Revoking does not free the bearer.** The fingerprint stays, so a revoked
  agent that reconnects is the same revoked row, not a new pending one.
- **Scanning is the least certain part of this page.** It calls the legacy Hermes
  scan endpoints (`/v1/agents`, `/agents`, `/v1/profiles`) against the vault's
  `hermesBaseUrl` setting (default `http://localhost:8642`) with a key kept in OS
  secure storage. This build has no Settings field that writes either one — the
  companion's key lives in the Hermes profile's `.env`, not in the app — so a scan
  can report "Hermes is unreachable" and point at a Settings page that no longer
  offers the field. The companion connection itself does not depend on this path.
- **Archived domains and grants.** Unarchive a domain to make it grantable again;
  the grant keeps the slug you assigned all along.

## Related

- [The Companion](./24-companion.md)
- [Decisions](./23-decisions.md)
- [The Vault](./04-the-vault.md)
- [Settings](./28-settings.md)
- [Security](./29-security.md)

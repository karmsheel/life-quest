# Agents

Agents is where you see who works on your vault. It holds three different things
that all answer to the word "agent": the companion that answers in the dock, the
external MCP agents you have connected over the pairing doors, and the Hermes
agents you have hired from a scan. It also holds the grant switches — which areas
a connected agent may reach, whether it may write, and whether it may touch the
Schedule — so the roster is not a list of names but the place authority is given
and taken away. See also [Wiki home](./index.md).

## Where it lives

- Rail: the Home wing, label **Agents**, people icon. The route is `/personnel`.
- It is a page, not a sheet. The area lens filters the **Active hires** list.
- The page's own summary line reads: "The companion, the agents connected over
  MCP, and the Hermes agents you have hired."
- The two **MCP doors** that connected agents arrive through are reported at the
  top of **Settings → Hermes**, under the **MCP doors** heading.
- Pairing approvals happen in [Decisions](./23-decisions.md), not here.
- The agents that can answer in the dock are chosen there too: the dock's **agent
  switcher**, and **Settings → Hermes → Agents by area**.

## What it is for

LifeQuest separates two questions that a single "agent" feature usually merges:
*who is doing the work* and *what may they touch*. The companion — **Pi** or
**Hermes** — is the one that answers a chat, and each chat belongs to it. A hire
records who is working on which area, for the operator's own roster. A connected
agent is a different roster with a real grant, because an MCP caller from another
machine reaches the vault through a socket and must be named before it is trusted.

Only the connected-agent roster carries real permissions. The companion keeps the
whole vault; a hire is a record, not a grant.

## How to use it

### Choose and scope the agent that answers

1. In the dock, the vertical **agent switcher** offers the agents your current
   area allows. Choose one and the dock switches immediately; the studio is not
   taken away while the target boots.
2. **Settings → Hermes → Agents by area** decides where each agent appears.
   **Shown in** is the visibility rule — **All areas**, or a set of unlocked areas.
   An agent scoped to other areas is absent from this area's switcher, not greyed
   out.
3. **Default in** is a subset of what the agent is shown in: entering that area
   selects the agent for the dock.
4. The scopes are stored in the vault's `settings.json` under `agentScopes`, so the
   rule follows the vault folder. With no scopes at all, every agent is offered
   everywhere.

### Invite an agent over MCP

1. Choose **Invite an agent** in the **Connected agents** section. A one-time code
   appears in the panel: "Send this code to the agent. It is shown once and
   expires <time>."
2. Give the code to the agent's operator. It is 128 bits, single-use, and expires
   24 hours after it was minted; unused codes are listed under **Unused invites**
   and can be removed with **Drop**.
3. In that agent's MCP client, add a server that points at the door the agent can
   reach. **Settings → Hermes** under **MCP doors** reports the two loopback URLs:
   - **Local** — `http://127.0.0.1:8643/mcp`, for a client on this machine.
   - **Invite** — `http://127.0.0.1:8646/mcp`, the door you forward through a
     tunnel you already trust (Tailscale, WireGuard, SSH).
4. Configure the client with its own bearer token of at least 22 characters, an
   `Authorization: Bearer <token>` header, and an `X-LifeQuest-Name: <name>`
   header. An agent arriving through the invite door also sends
   `X-LifeQuest-Invite: <code>`.
5. The first accepted contact files one pairing Decision titled **Connect
   <name>**. A card appears on this page immediately, reading **Waiting for
   approval**, with the name, fingerprint and door, and no grant controls.
6. Approve it in [Decisions](./23-decisions.md). The row becomes active,
   read-only, with no areas and Schedule off.
7. Grant what the agent may reach on the card: tick areas under **Areas**, turn
   on **Write**, turn on **Schedule**. The change applies immediately.
8. **Revoke** ends the agent's access. The row keeps its fingerprint so the same
   bearer reconnects as the same agent instead of introducing itself again.

An active card shows `<fingerprint> · <door> door`. The fingerprint is the first
12 characters of the SHA-256 of the agent's bearer; the raw bearer and the raw
invite code are never stored in the vault, the Log, or an error message.

### Work with the roster

- **Refresh** re-reads the connected-agent roster or the hire list.
- **Companion** is a fixed card. It reads **Hermes**, "Full access · this vault",
  and has no area editor, no **Write** switch, no **Schedule** switch and no
  revoke: there is nothing to grant the companion that it does not already have.
  The card names Hermes even when the built-in **Pi** is the companion answering;
  the active companion is set in **Settings → Hermes → Companion**.
- Hires appear under **Active hires** with their Hermes agent id and, when the
  record carries one, a role label and an assigned area. **Dismiss** moves the hire
  out of the active roster; the record stays in the vault's history.
- The area lens filters the hire list, so the Agents page under an area's lens
  shows the hires assigned to that area. The connected-agent roster is not
  lens-filtered — a grant is a grant.

### Scan and hire a Hermes agent

1. Choose **Scan Hermes agents**. The button reads **Scanning…** while it probes
   and the empty area reads "Probing Hermes…".
2. Scanned agents appear with their name and id. **Hire** adds one to the active
   roster; a hire that already exists reads **Hired** and cannot be hired twice.
3. A successful scan says "Found N agent(s)."; a scan that finds nothing says
   "Scan complete — no agents found." With nothing yet scanned the area says "No
   scan results yet. Run a scan to list available agents."
4. The hire is assigned the area your lens is on, if any, and shows in **Active
   hires**.

Hiring is one button, not a form: there is no field to rename the agent, no role
picker and no model choice. The hire takes the scanned agent's own name and id,
and its area is whatever lens you are looking through — the Life lens assigns
none. The product's model is that a hired agent either *advises* or *owns* an
area, and that the vault records which agent acted; in this build the hire record
carries an optional role label and an area slug, and the Agents button writes the
area from your lens and leaves the role label empty. Role labels are read and
shown when the roster carries one.

Pi and Hermes are not hires. They are the harnesses the studio itself offers;
you do not scan for them, hire them or grant them anything. **Pi** is built in,
**Hermes** is the external sidekick, and the **Companion** picker in Settings is
the only place the choice is made.

## The screen

| Part | What it does |
|---|---|
| Header | Wing eyebrow **Agents**, title **Agents**, and the one-line description of the three kinds of agent. |
| **Companion** | One fixed card: **Hermes**, "Full access · this vault". |
| **Connected agents** | **Invite an agent**, **Refresh**; cards for pending and active MCP callers with **Areas**, **Write**, **Schedule**, **Revoke**; **Unused invites** with **Drop**. |
| **Scan** | **Scan Hermes agents** and the results list with **Hire** / **Hired**. |
| **Active hires** | **Refresh** and the hire cards with **Dismiss**. |
| Error banner | A red message with the reason; when Hermes looks unreachable it adds an **Open Settings →** link and a banner with **Go to Settings**. |

## Rules and behaviour

- **A pending agent has no tools at all.** Until its Decision is approved, its
  `tools/call` answers `PAIRING_PENDING` and its `tools/list` is empty. A rejected
  agent gets `PAIRING_REJECTED`, a revoked one `PAIRING_REVOKED`. Approval is what
  makes the row active; it does not itself grant anything.
- **A grant starts empty.** A new agent is read-only, has no areas, and has
  Schedule off. **Areas** accepts unlocked areas only, and a locked or archived
  area drops out of the effective grant while it stays that way.
- **Reads need an area.** A read is allowed only while at least one assigned area
  is live. A record outside the assignment answers `NOT_FOUND`, so an agent cannot
  tell "you may not see this" from "this does not exist".
- **Writes need Write, and the areas they name must be assigned.** With **Write**
  off, every write tool answers `FORBIDDEN`.
- **Adding data applies at once**, for a connected agent exactly as for the
  companion: `create_database` and `insert_rows` write after the chat confirmation,
  and `upsert_row` without an id creates a row. Updating (`upsert_row` with an id),
  deleting and adding a column still file a Decision.
- **The capture thread additionally needs Financial assigned**, because
  `capture_transaction`, `undo_capture` and `correct_capture` name no area of their
  own and write the finance ledger.
- **Some tools stay with the companion.** `create_year`, `delete_year`,
  `set_month_day`, `set_month_objectives`, `set_month_notes`, `set_about_me`,
  `get_companion_brief`, `set_companion_brief` and `propose_onboarding_unlock`
  configure the vault or speak for the studio rather than an area, so a connected
  agent that calls one is refused.
- **An unclassified tool is refused.** Anything not on the lists below is
  `FORBIDDEN` by name; a tool added in a later build does not become writable by
  falling through. `write_review` and `unlock_review` are not offered to connected
  agents at all.
- **Pairing secrets stay outside the vault.** The roster is
  `.lifequest/connected-agents.json` and carries no secrets. The companion token,
  the agents' bearer hashes and the invite-code hashes live in the app's own
  userData (`pairing-secrets/connected-agent-secrets.json`), so a copied vault
  never carries an agent's credential. The hired roster is
  `.lifequest/agents.json`.
- **The door is loopback only.** Neither door binds a public or private-network
  address and neither terminates TLS; the invite door is meant to be forwarded
  through a tunnel you trust. A request whose `Host` is not `127.0.0.1` or
  `localhost` is refused before authentication.

### What an approved agent can call

Reads, inside its assigned areas: `get_doctrine`, `list_documents`,
`get_document`, `list_databases`, `get_database`, `list_rows`, `get_row`,
`list_decisions`, `list_goals`, `get_state`, `get_review`, `list_reviews`,
`get_period_pack`, `run_script_block`, `preview_view`, `list_views`,
`get_dashboard`, `list_projects`, `get_project`, `list_pages`, `get_page`,
`list_signals`, `get_signal`.

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
`create_project`, `update_project`, `close_project`, `upsert_row` (with an id),
`delete_row`, `add_column`, `save_view`, `arrange_dashboard`.

With **Write** on, the writes that apply immediately: `create_database`,
`insert_rows`, `upsert_row` (without an id), `create_event`, `update_event`,
`delete_event`, `apply_script_block`, `create_signal`, `mark_review_done`, and —
with Financial assigned — `capture_transaction`, `undo_capture`,
`correct_capture`.

The companion is not limited by these lists. It keeps its full surface and its
rules: reads are free, and its document and ledger writes go through Decisions
except for adding data, Schedule tasks, an unambiguous conversational transaction,
page script blocks and the companion brief. Those rules are stated in
[Companion](./24-companion.md).

## Tips and edge cases

- **A hire is not a connection.** The **Active hires** roster names Hermes agents
  you have scanned and hired; it does not give any external process access to the
  vault. Access is the **Connected agents** roster and its grant switches.
- **A hire is not the dock's agent either.** The dock's companion is **Pi** or
  **Hermes**, chosen in Settings; a hire is a roster record and does not answer
  chats.
- **A pairing Decision belongs to no area**, so it appears in the global queue,
  carries no area badge, and cannot be filtered away — it is the one card that must
  be answered.
- **The invite code cannot be read back.** It is shown once at the mint; if you
  lose it, **Drop** the unused invite and mint another.
- **The pending cap is 20.** A 21st introduction is refused with "Too many agents
  are waiting for approval" instead of filling the inbox.
- **Revoking does not free the bearer.** The fingerprint stays, so a revoked agent
  that reconnects is the same revoked row, not a new pending one.
- **Scanning is the least certain part of this page.** It calls the legacy Hermes
  scan endpoints (`/v1/agents`, `/agents`, `/v1/profiles`) against the vault's
  `hermesBaseUrl` setting (default `http://localhost:8642`) with a key kept in OS
  secure storage. This build has no Settings field that writes either one — the
  Hermes profile's key lives in its `.env`, not in the app — so a scan can report
  "Hermes is unreachable" and point at a Settings page that no longer offers the
  field. The companion connection itself does not depend on this path.
- **Locked areas are invisible, not refused.** A grant that names an area that is
  later locked stops covering it until it is unlocked again; the slug stays on the
  row.

## Related

- [Companion](./24-companion.md)
- [Decisions](./23-decisions.md)
- [The Vault](./04-the-vault.md)
- [Settings](./28-settings.md)
- [Security](./29-security.md)

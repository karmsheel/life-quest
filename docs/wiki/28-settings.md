# Settings

Settings is one sheet over the app, not a page in the rail. It holds eleven tabs
in a fixed order: from the theme you wear and the keys you move with, through the
areas and the vault, to the companion, the prompt the agent is given, the
Decisions inbox, updates, your own context, and the Developer bench. A search
field above the tab list narrows the list in place, so a setting you can name is
two keystrokes away. [The wiki home](./index.md) has the page index.

## Where it lives

- Press the gear at the trailing end of the window title bar. It is a plain link
  to the settings sheet (*Open settings*), with no popup and no expanded state;
  one press opens the whole sheet over the page you were on. The quick theme
  menu lives under the day/night control beside it.
- The sheet is the route `/settings`, and the tab is the query string:
  `/settings?tab=<view>`. The legacy path `/domains` redirects to
  `/settings?tab=domains`, which is the **Areas** tab.
- Settings is a **sheet**, not a page: the app keeps rendering the page you were
  on behind it, blurred and out of reach, and closing it returns you there. See
  [The studio](./03-the-studio.md) for how sheets differ from pages.
- The chat pane's error banner also links here with **Open Settings** when the
  companion needs configuring.

## What it is for

Some settings belong to a vault (its week start, saved questions, Decisions
inbox, agent scopes); some belong to this installation (the recent-vault list,
the companion, the theme, the keyboard); and some are read-only views of what the
companion is being told. The sheet keeps those scopes apart, one tab each, and
applies every change immediately — there is no Save button for the sheet.

## How to use it

1. Press the gear in the window title bar.
2. Choose a tab in the left column (or the segmented control on a narrow window).
   The address bar becomes `/settings?tab=<id>`, so a tab can be linked or
   revisited. To find one, type in **Search settings** above the tab list: the list
   narrows in place, and if the tab you are on no longer matches, the sheet jumps
   to the first match so the panel and the list cannot disagree.
4. Press **Escape** to clear a search and keep the sheet open; press it again to
   close the sheet. **Clear search** (the small cross in the field) clears it too.
5. Close with the cross at the top right (**Close settings**), a click on the
   dimmed background, or **Escape**; focus returns to the control that opened it.

## The screen

The sheet is a large frame over the app with a narrow left column and a wide
panel. Its only floating chrome is the search pill (*Search settings*), a short
field sitting on the panel's top border, half in and half out, with the section
column starting at the panel's top edge and no title band above it; the close
cross (**Close settings**) floats over the panel's top-right padding. The left
column carries the kicker **App** and the title **Settings**, then the eleven
tabs with their icons, and the panel shows the selected tab, titled by its own
heading and subtitle, in a card of rows: name and description on the leading
edge, control on the trailing edge, a hairline ruling one row off the next.

The search matches tab labels, the words each tab declares for what it holds, and
the names of installed themes. Words are ANDed, so `vault path` is narrower than
either; a tab that matched on a word other than its label shows that word beside
its name. With no match it says *No settings match “…”.* Search does not reach
the values inside a vault.

## Appearance

**Appearance** — *Color mode and themes*.

- **Theme**: a segmented control for **System**, **Light** and **Dark**. The
  description is explicit: *Pick a theme; star the ones you want in the quick
  settings menu. System shows themes with both day and night palettes; Light and
  Dark show only matching skins.*
- The theme grid (**Themes**) shows the skins this mode can wear as tiles. Click a
  tile to wear it; click its star to put it in (or take it out of) the quick
  settings menu. The star summary reads *N of M themes are starred · the quick
  settings menu shows only these*, or explains that none of your starred themes
  fits this colour mode, or that none are starred.

The shipped themes are **Forge** (the startup default), **Nous**, and
**Graphite**. Each ships a day and a night palette; Nous Classic, Midnight, Ember,
Cyberpunk and Mono are retired (their stored names fold onto Forge, Nous or
Graphite on read, and stars survive the rename). A theme with only one palette —
an installed theme, since every shipped one has both — is wearable in the palette
it has; when the switch asks for the palette it does not have, the window hands
itself to the fallback theme, **Nous**, in the requested mode. The day/night
control in the title bar switches the palette; hovering or focusing it opens the
starred-theme quick menu, which is the same list this page curates.

Under the grid, **Install a theme** takes a Forge theme JSON file — *the shape this
app and Hermes Desktop share* — with **Choose file…**. An installed theme arrives
starred, so it is in the quick menu immediately; installed themes are listed under
**Installed** with **Remove**. A file that is not JSON, or not a valid theme, is
refused with the reason naming the field that failed.

Theme, skin, starred list and installed themes are stored in the window's local
storage, not in the vault: they are this installation's look, and they do not
travel with the folder.

## Keyboard

**Keyboard shortcuts** — *Keys for moving around the studio*. The page lists
fourteen movements in four groups; the dock's **Keyboard shortcuts** reference
shows the same table and is the other editor.

- **Wings** — **Go to Home** (`Mod+1`), **Go to Define** (`Mod+2`), **Go to
  Plan** (`Mod+3`), **Go to Execute** (`Mod+4`), **Go to Review** (`Mod+5`),
  **Next wing** (`Mod+PageDown`), **Previous wing** (`Mod+PageUp`).
- **Pages** — **Next page** (`Mod+Shift+PageDown`), **Previous page**
  (`Mod+Shift+PageUp`), **Back** (`Alt+←`), **Forward** (`Alt+→`).
- **Panels** — **Toggle sidebar** (`Mod+B`), **Toggle chat** (`Mod+J`).
- **Surfaces** — **Open settings** (`Mod+,`).

**Change** puts a row into *Press keys…*, and the next combination with a real key
saves at once. Escape cancels; Backspace or Delete clears the movement to
**Unassigned**; a changed row shows its default and a **Reset**; the footer counts
your changes and offers **Restore all defaults**, disabled until something
changes. Refusals print in the alert banner and leave the row recording: a
combination the app or system owns, a key another movement already answers to (the
refusal names it), and a key that cannot be bound at all. The keyboard icon in the
dock's bottom bar opens the same table as a dock surface, with a pencil on each row
that records in place and **Back to chat** to return (a collapsed dock is reopened
from its floating mark first).

`Mod` is Ctrl on Windows and Cmd on a Mac. Only your changes are written, to
`localStorage` under `lifequest-keyboard-shortcuts`; setting a movement back to
its default removes its entry. The bindings are per installation, not inside the
vault, so they do not travel with a copied vault folder.

## Areas

**Areas** — *Activate an area to filter the app. Life shows everything.* This is
where the seeded locked areas are revealed, where areas are created, activated,
renamed, archived and deleted, and where the archive can be restored. The full
procedure, the exact confirmation titles and the lock rules are on
[Areas](./05-areas.md).

## Vault

**Vault** — *Identity and location on disk*.

- A read-only block shows the open vault's **Name**, **Id** and **Path**.
- **Vault folder** — *Point LifeQuest at another vault folder on this computer — a
  second vault, or the one you meant to pick. The new vault's files load in place;
  nothing is moved or deleted.* The button is **Change folder…** (shown as
  **Opening…** while it works).
- **Week starts on** — **Monday** or **Sunday**. It is disabled once weekly review
  or planning files exist, with the reason *Cannot change while weekly review or
  planning files exist.* The choice is a vault setting
  ([LAWS/REVIEWS.md](../../LAWS/REVIEWS.md)).

Below that, **Books** — *Export a git-portable JSON of area tables. Restore
replaces the live SQLite book from books.json.* Each live area gets a row with
**Export books** (writes `data/books.json`, reporting *Exported books for
<area>.*), a **Allow restore** toggle that arms the destructive control, and
**Restore books**, disabled until the toggle is on. A restore disarms itself when
it completes; it is explicit and confirmed, never an automatic Git hook
([LAWS/DATABASES.md](../../LAWS/DATABASES.md)).

Recent vaults are not listed here; they are on the welcome screen and in the
rail's **Switch vault** dialog. See [The vault](./04-the-vault.md).

## Hermes

**Hermes** — *The companion and the agents this vault runs on*. This tab holds
the companion itself and the vault's own agent choice:

- **MCP doors** first, because the two loopback addresses are what you come to the
  page to copy: **Local** (`http://127.0.0.1:8643/mcp` by default) and **Invite**
  (`http://127.0.0.1:8646/mcp`), each with its own bind error. With no vault open
  it says *MCP doors are closed — open a vault to expose the Life Map store.*
- **Connection**: the status line (`Ready · <api url> · started by LifeQuest` or
  `attached`), or the problem — CLI missing, port busy, gateway exited with the
  CLI's own words, Hermes too old, key rejected, disconnected — with any model
  warning under it. When Hermes is ready, one-line facts name the **CLI**,
  **Profile** and **API**. **Recheck** re-runs the connection; **Open profile
  folder** opens the profile (Hermes only). The profile picker that used to live
  here is on the setup screen instead; a vault's Hermes agent is chosen in
  **Agents in this vault**.
- **Agents in this vault**: the vault's own agents. The **Pi** card is always
  there and says it is built in and available in every vault; **Use Pi** makes it
  the answering agent. The **Hermes** card says *This vault has no Hermes agent*
  until one is added, and offers **Create a new agent for this vault** (a fresh
  Hermes profile, seeded on first use, with its own memory) or **Use an existing
  agent…** (an installed profile, with a warning naming the other vaults it works
  on, because memory, skills and knowledge are shared). A bound Hermes agent shows
  its profile name and offers **Use Hermes**, **Change agent** and **Remove from
  this vault** (the vault falls back to Pi; the profile stays on disk). Switching
  is fast and does not take the studio away.
- **Agents by area**: each agent's **Shown in** and **Default in** chips. No areas
  selected means every area; a narrowed agent is absent from the dock's switcher
  outside its areas, not greyed; the default for an area is selected when you enter
  it. The scopes live in the vault's `settings.json` under `agentScopes`.
- **Built-in endpoint** (Pi only): **Endpoint**, **Model**, **Name** and **API
  key**, then **Save and connect**. A local server needs no key; the key is sealed
  by the OS, never written into the vault, and kept for the session only on a
  machine with no keyring.
- **Chat behaviour**: **File implied changes** — *When a chat proposes a doctrine,
  library, goal, or day-template change, file one pending Decision. The vault
  changes only when you approve it.* On by default. **Database writes** is a
  read-only row explaining the split: *A new database, a new row, or a batch of new
  rows is written as soon as you agree to it in the chat. Changing or deleting data
  that already exists still waits for your approval in Decisions.* The old
  **Apply assistant inserts immediately** allowlist is retired.

There is no base-URL field, no API-key field, no **Test connection** button and no
model picker for Hermes: its endpoint is the profile's own gateway, its model the
profile's pinned one, its credential the profile's `.env`, never the vault
([LAWS/SECRETS.md](../../LAWS/SECRETS.md)). See [Companion](./24-companion.md) and
[Agents](./25-agents.md).

## Agent

**Agent** — *The system prompts and skills your companion is given*. This tab is a
read-only answer to "what is my companion being told?", in the order the model
receives it:

- **Re-read** (shown as **Reading…**) fetches it again.
- **System prompt**: the profile's `SOUL.md` with its file path, badged
  **LifeQuest seed** when the app wrote it or **Edited by you** when your own words
  are left alone.
- **Per-turn instructions**: the text appended to every chat turn, with the current
  **Area lens** (Life when no area is chosen), the **Dashboard board** and whether
  it is locked, and whether implied-change filing is on or off.
- **Skills**: the library the companion may read, counted, split into **LifeQuest**
  and **Hermes library**. Each row shows its name, category, use count (*used N×*
  or *not used yet*), **pinned** or **yours** marks where they apply, and its path.
- The profile path is repeated at the foot. The values change with the page and
  lens you are on, so re-read after a switch if you are checking what the companion
  would be told.

## Questions

The tab is labelled **Questions**; its panel is **Chat questions** — *Saved
prompts offered when you start a new chat*.

1. Write the question in **Question or prompt** (up to 600 characters).
2. Choose where it appears in **Show it in**: **Everywhere**, a wing, an unlocked
   area, or a page.
3. Press **Add question**. It now appears in the chat dock's empty thread under
   **Start with a question**, and clicking it sends it as the first turn.

**Saved questions** shows the count and each question with its scope label (for
example *Review wing*, *Health area*, *Dashboard page*), plus **Edit** and
**Delete**. Editing reopens the question and its scope with **Save** and
**Cancel**; an archived area stays selectable for a question already pointed at
it. The list is stored in the vault's settings file, so it follows the vault
between machines. With none it says *No saved questions yet. Add one above to see
it in the chat composer.* The empty prompt is refused with *Write the question and
choose where it should appear.*

## Decisions

**Decisions** — *How the inbox interrupts you*. Two switches, both on by default:

- **Open for a new decision** — *The inbox opens over the page the moment the
  companion files a proposal, so it can be approved without leaving what you were
  doing. Decisions already waiting when the app starts do not open it: they were
  not filed while you were working.*
- **Close after the last decision** — *Answering the last pending proposal closes
  the inbox and hands the page back exactly where you left it, so approving the
  queue does not leave a sheet covering the work you went back to.*

Both are written to the vault's settings file, so the preference follows the
folder rather than one window. See [Decisions](./23-decisions.md).

## Updates

**Updates** — *LifeQuest v0.2.10 · checked from GitHub Releases*. It reports what
the release feed last said: *Checking GitHub for a newer release…* while a check
runs; *LifeQuest X is available (you are on vY).* when a newer release exists,
plus a **Release page** button; *Up to date — vY is the newest release.*; or the
error when the feed could not be read. The app never claims to be up to date when
it could not check.

**Check now** (shown as **Checking…**) re-reads the feed by hand instead of
replaying the session's answer. The app asks at launch and then once an hour while
it is open. The check is anonymous and stores nothing. The version badge in the
dock's bottom bar is the other manual check. See [Updates](./27-updates.md).

## About me

**About me** — *Agents treat this as lifestyle context, not a command surface.*
One field, **Lifestyle context**, with the placeholder *Who you are, constraints,
rhythms, preferences…*. Press **Save**; a **Saved.** note confirms it. The text is
written to `.lifequest/about.md` and reaches the companion as context only.

## Developer

**Developer** — *Switches that show what the app normally waits for*. It holds one
switch, **Preview the update badge**: *Makes the build number in the chat dock's
bottom bar glow, and opens the upgrade popup from it, as if a newer LifeQuest had
been published. Nothing is downloaded: the preview carries no installer, so the
popup offers the release page instead.* The switch persists (it is stored locally)
and is off to begin with. The note under it says which state you are seeing: the
preview alone (a non-existent **v9.9.9**), a preview shadowed by a real release the
feed is offering, or the feed's own answer. **Updates** always reports the real
feed, and a real release outranks the preview.

## Rules and behaviour

- The tab order is fixed (11): **Appearance**, **Keyboard**, **Areas**, **Vault**,
  **Hermes**, **Agent**, **Questions**, **Decisions**, **Updates**, **About me**,
  **Developer**. An unknown or missing `tab` value falls back to Appearance.
- The tab lives in the URL, so a tab is linkable. A tab change rewrites the query
  string in place (`replace`) rather than adding history, so the back button
  leaves the sheet instead of walking back through tabs. The sheet is not a page:
  the route keeps the page behind it mounted, and closing goes back one history
  entry rather than to a fixed route. It locks the page's scroll while open,
  portals itself to the window, keeps focus inside, and hands focus back when it
  closes.
- **Escape** unwinds one step: a settings search is cleared first, only an empty
  sheet closes. A confirmation dialog raised over the sheet takes Escape first.
- Settings that belong to the vault are written to `.lifequest/settings.json`
  (`weekStartDay`, `chatQuestions`, `decisionInbox`, `agentScopes`). **About me**
  is `.lifequest/about.md`. Theme, starred list and keyboard bindings are window
  storage.
- The agent each vault uses is app user data: `vaultAgents` in
  `%APPDATA%\LifeQuest\recent.json` records the vault's Pi/Hermes choice and, for
  Hermes, the profile bound to it. Pi's endpoint, sealed key and transcripts are
  app user data too (`pi-endpoint.json`, `pi-endpoint.key`,
  `pi-sessions\<vault id>\`). None of them is written into the vault.
- API keys never enter the vault ([LAWS/SECRETS.md](../../LAWS/SECRETS.md)). The
  companion's own credential belongs to its profile; secrets the app stores for
  itself live in OS secure storage.
- Week start cannot be changed while weekly review or planning files exist
  ([LAWS/REVIEWS.md](../../LAWS/REVIEWS.md)); restore books is an explicit,
  confirmed action and never a Git hook ([LAWS/DATABASES.md](../../LAWS/DATABASES.md)).

## Tips and edge cases

- The gear is a link, not a menu: it opens the sheet directly. The quick theme
  menu lives under the day/night control in the same strip. An uncurated install
  has every theme starred, so the quick menu opens on the full set until you clear
  a star; if the menu is empty, it explains why and links to **Appearance**.
- `Ctrl+R` reloads the whole app, not the sheet, and returns to the same tab
  because the tab is in the URL. A cold start that opens `/settings` directly has no
  page behind it; closing the sheet falls back to the Dashboard.
- Installing a theme only adds it to this window's list. Uninstalling the one you
  are wearing leaves the app on Forge, the startup default.
- The Settings → Keyboard row for the Act wing is still labelled **Go to Execute**
  while the wing tab reads **Act**; the description names Projects, Daily Schedule
  and Act. The wing id, routes and stored scopes are `execute`, so the label
  follows the id.
- The **Database writes** row contains no control; the retired insert allowlist is
  ignored, not deleted, so an older settings file still opens unrewritten.
- A question scoped to an archived area still renders that area while you edit it,
  so opening Edit and saving does not quietly move the question elsewhere.

## Related

- [The studio](./03-the-studio.md)
- [The vault](./04-the-vault.md)
- [Areas](./05-areas.md)
- [Companion](./24-companion.md)
- [Decisions](./23-decisions.md)
- [Updates](./27-updates.md)
- [Security](./29-security.md)

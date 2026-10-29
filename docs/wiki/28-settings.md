# Settings

Settings is one sheet over the app, not a page in the rail. It holds nine tabs, in
a fixed order: from the theme and skin you use, through the Hermes profile your
companion runs on, to the update preview under **Developer**. A search field above
the tab list narrows the list in place, so a setting you can name is two keystrokes
away. [The wiki home](./README.md) has the full page index.

## Where it lives

- Press the gear at the trailing end of the window title bar (*Open settings*),
  then **All settings** in the popover. The same popover holds the quick theme
  picker.
- The sheet is the route `/settings`, and the tab is the query string:
  `/settings?tab=<view>`. The legacy path `/domains` redirects to
  `/settings?tab=domains`.
- Settings is a **sheet**, not a page: the app keeps rendering the page you were
  on behind it, blurred and out of reach, and closing it returns you there. See
  [The studio](./03-the-studio.md) for how sheets differ from pages.
- The chat pane's error banner also links here with **Open Settings** when the
  companion needs configuring.

## What it is for

Some settings belong to a vault (its week start, its saved questions, which
databases accept assistant inserts); some belong to this installation (the recent
vault list, the chosen Hermes profile, the window's theme); and some are read-only
views of what the companion is being told. The Settings sheet is where those
different scopes are kept apart, with a tab each. Everything it changes is applied
immediately — there is no Save button for the sheet as a whole.

## How to use it

1. Open the gear popover and choose **All settings**.
2. Choose a tab in the left column (or the segmented control on a narrow window).
   The address bar becomes `/settings?tab=<id>`, so a tab can be linked or
   revisited.
3. To find a tab, type in **Search settings** above the tab list. The list narrows
   in place; if the tab you are on no longer matches, the sheet jumps to the first
   match so the panel and the list cannot disagree.
4. Press **Escape** to clear a search and keep the sheet open; press it again to
   close the sheet. **Clear search** (the small cross in the field) clears it too.
5. Close with the cross at the top right (**Close settings**), a click on the dimmed
   background, or **Escape**. Focus returns to the control that opened the sheet.

## The screen

The sheet is a large frame over the app with a narrow left column and a wide
panel:

- Its header carries the search field (*Search settings*) and **Close settings**.
- The left column carries the kicker **App**, the title **Settings**, then the
  tabs.
- The panel shows the selected tab, titled by its own heading.
- The title bar's gear opens a smaller popover before the sheet: **Skin**, the
  starred themes, the colour mode control (**System**, **Light**, **Dark**) and
  **All settings**.

The search matches tab labels, the words each tab declares for what it holds, and
the names of installed themes. Multiple words are ANDed, so `vault path` is
narrower than either word. A tab that matched on a word other than its label shows
that word beside its name. With no match it says *No settings match “…”.* Search
only reaches tabs and themes; it does not search the values inside a vault.

## Appearance

**Appearance** — *Color mode and themes*. Two controls:

- **Theme**: a segmented control for **System**, **Light** and **Dark**. The
  description is explicit: *Pick a theme; star the ones you want in the quick
  settings menu. System shows themes with both day and night palettes; Light and
  Dark show only matching skins.*
- The theme grid (**Themes**) shows the skins this mode can wear as tiles. Click a
  tile to wear it; click its star to put it in (or take it out of) the quick
  settings menu. The star summary reads *N of M themes are starred · the quick
  settings menu shows only these*, or explains that none of your starred themes
  fits this colour mode, or that none are starred.

The shipped themes are **Forge OS** (the default), **Nous**, **Nous Classic**,
**Midnight**, **Ember**, **Mono** and **Cyberpunk**. **System** shows only themes
with both palettes; Light and Dark show the skins that match the mode.

Under the grid, **Install a theme** takes a Forge theme JSON file — *the shape this
app and Hermes Desktop share* — with **Choose file…**. An installed theme arrives
starred, so it is in the quick menu immediately. Installed themes are listed under
**Installed** with **Remove**. A file that is not JSON, or not a valid theme, is
refused with the reason naming the field that failed.

Theme, skin, starred list and installed themes are stored in the window's local
storage, not in the vault: they are this installation's look, and they do not
travel with the folder.

## Domains

**Domains** manages the life areas: create, activate, rename, archive and delete.
It carries the same information as the top-bar lens. The full procedure, the exact
confirmation titles and the archive-versus-delete rule are on
[Domains](./05-domains.md).

Its subtitle is *Activate a domain to filter the app. Overview shows everything.*

## Vault

**Vault** — *Identity and location on disk*.

- A read-only block shows the open vault's **Name**, **Id** and **Path**.
- **Vault folder** — *Point LifeQuest at another vault folder on this computer — a
  second vault, or the one you meant to pick. The new vault's files load in place;
  nothing is moved or deleted.* The button is **Change folder…** (shown as
  **Opening…** while it works). It opens a folder picker and loads that vault.
- **Week starts on** — **Monday** or **Sunday**. It is disabled once weekly review
  or planning files exist, with the reason *Cannot change while weekly review or
  planning files exist.* The choice is a vault setting
  ([LAWS/REVIEWS.md](../../LAWS/REVIEWS.md)).

Below that, **Books** — *Export a git-portable JSON of domain tables. Restore
replaces the live SQLite book from books.json.* Each live domain gets a row with:

- **Export books**, which writes that domain's `data/books.json` and reports
  *Exported books for <domain>.*
- A confirmation checkbox: *Restore replaces the live SQLite book for this domain
  from books.json*.
- **Restore books**, disabled until the checkbox is ticked. Restore is an explicit,
  confirmed action and never an automatic Git hook
  ([LAWS/DATABASES.md](../../LAWS/DATABASES.md)).

Recent vaults are not listed here; they are on the welcome screen. See
[The vault](./04-the-vault.md).

## Hermes

**Hermes** — *LifeQuest companion on the `<profile>` Hermes profile*. This tab is
where the companion is inspected and repaired after first launch:

- A status line across the top. On success it reads *Ready · <api url> · started by
  LifeQuest* or *Ready · <api url> · attached*. Otherwise it states the problem —
  CLI missing, port busy, gateway exited with the CLI's own words, Hermes too old,
  API key rejected, or disconnected. A model warning appears under it if the
  profile's pinned model is not in the host's catalogue.
- When ready, a small block names the **CLI** path, the **Profile** path and the
  **API** URL.
- **Companion profile**: the same picker the setup screen offers. Choose an
  installed profile or **Create the lifequest profile**; the switch re-runs the
  connection against it and is remembered across launches.
- **File implied changes** — *When a chat proposes a doctrine, library, goal, or
  day-template change, file one pending Decision. The vault changes only when you
  approve it.* On by default.
- **Recheck** (shown as **Checking…**) re-runs the connection; **Open profile
  folder** opens the profile's directory on disk.
- **Apply assistant inserts immediately** — *New rows the assistant proposes in a
  checked database are applied immediately. Updates, deletes, and other databases
  still wait in Decisions.* One checkbox per database of each live domain; with
  none it says *No databases in live domains.* This is the vault's
  `autoApproveInserts` setting.
- **MCP doors**: the two loopback URLs, **Local** (`http://127.0.0.1:8643/mcp` by
  default) and **Invite** (`http://127.0.0.1:8646/mcp`), each with its own bind
  error. With no vault open it says *MCP doors are closed — open a vault to expose
  the Life Map store.*

There is no base-URL field, no API-key field, no **Test connection** button and no
model picker on this tab. The endpoint is the profile's own gateway, the model is
the profile's pinned one (the probe only warns when the host cannot route it), and
the companion's credential lives in the Hermes profile's `.env`; it never enters
the vault ([LAWS/SECRETS.md](../../LAWS/SECRETS.md)). See
[Companion](./24-companion.md) for the chat pane and
[Personnel and agents](./25-personnel-and-agents.md) for the roster.

## Agent

**Agent** — *The system prompts and skills your companion is given*. This tab is a
read-only answer to "what is my companion being told?", in the order the model
receives it:

- **Re-read** (shown as **Reading…**) fetches it again.
- **System prompt**: the profile's `SOUL.md` with its file path. A badge says
  **LifeQuest seed** when the app wrote it, or **Edited by you** when your own words
  are left alone.
- **Per-turn instructions**: the text appended to every chat turn, with the current
  **Domain lens**, the **Dashboard board** and whether it is locked, and whether the
  vault is open with implied-change filing on or off.
- **Skills**: the library the companion may read, counted, split into **LifeQuest**
  and **Hermes library**. Each row shows its name, category, use count (*used N×* or
  *not used yet*), **pinned** or **yours** marks where they apply, and its path.
- The profile path is repeated at the foot.

The values shown here change with the page and lens you are on, so re-read after a
switch if you are checking what the companion would be told.

## Questions

The tab is labelled **Questions**; its panel is **Chat questions** — *Saved prompts
offered when you start a new chat*.

1. Write the question in **Question or prompt** (up to 600 characters).
2. Choose where it appears in **Show it in**: **Everywhere**, a wing, a live domain,
   or a page.
3. Press **Add question**. It now appears in the chat dock's empty thread under
   **Start with a question** when you start a new chat there, and clicking it
   sends it as the first turn.

**Saved questions** shows the count and each question with its scope label (for
example *Review wing*, *Health domain*, *Dashboard page*). Each row has **Edit** and
**Delete**. Editing reopens the question and its scope with **Save** and **Cancel**;
an archived domain stays selectable for a question already pointed at it.

The list is stored in the vault's settings file, so it follows the vault between
machines. With none it says *No saved questions yet. Add one above to see it in the
chat composer.* The empty prompt is refused with *Write the question and choose
where it should appear.*

## Updates

**Updates** — *LifeQuest v0.2.0 · checked from GitHub Releases*. It reports what the
release feed last said:

- *Checking GitHub for a newer release…* while a check runs.
- *LifeQuest X is available (you are on vY).* when a newer release exists, plus a
  **Release page** button.
- *Up to date — vY is the newest release.*
- The error when the feed could not be read. The app never claims to be up to date
  when it could not check.

**Check now** (shown as **Checking…**) re-reads the feed by hand instead of
replaying the launch's answer. The check is anonymous and stores nothing. See
[Updates](./27-updates.md) for the version badge and install flow.

## About me

**About me** — *Agents treat this as lifestyle context, not a command surface.* One
field, **Lifestyle context**, with the placeholder *Who you are, constraints,
rhythms, preferences…*. Press **Save**; a **Saved.** note confirms it. The text is
written to `.lifequest/about.md` in the vault and reaches the companion as context,
not as instructions.

## Developer

**Developer** — *Switches that show what the app normally waits for*. It holds one
switch, **Preview the update badge**: *Makes the build number at the foot of the
rail glow, and opens the upgrade popup from it, as if a newer LifeQuest had been
published. Nothing is downloaded: the preview carries no installer, so the popup
offers the release page instead.* The switch persists (it is stored locally) and is
off to begin with.

The paragraph under it tells you which state you are seeing: the preview alone
(showing a non-existent **v9.9.9**), a preview shadowed by a real release the feed
is offering, or the rail showing what the feed says. **Updates** always reports the
real feed, and a real release outranks the preview.

## Rules and behaviour

- The tab order is fixed: **Appearance**, **Domains**, **Vault**, **Hermes**,
  **Agent**, **Questions**, **Updates**, **About me**, **Developer**. An unknown or
  missing `tab` value falls back to Appearance.
- The tab lives in the URL, so a tab is linkable. A tab change rewrites the query
  string in place (`replace`) rather than adding history, so the back button
  leaves the sheet instead of walking back through tabs. The sheet is not a page:
  the route keeps the page behind it mounted, and closing goes back one history
  entry rather than to a fixed route.
- The sheet locks the page's scroll while it is open, portals itself to the window,
  keeps keyboard focus inside, and hands focus back when it closes.
- **Escape** unwinds one step: a settings search is cleared first, only an empty
  sheet closes. A confirmation dialog raised over the sheet takes Escape first.
- Settings that belong to the vault are written to `.lifequest/settings.json`
  (`weekStartDay`, `autoApproveInserts`, `chatQuestions`). **About me** is
  `.lifequest/about.md`. Theme and theme preferences are window storage. The
  chosen Hermes profile and the **File implied changes** preference are app user
  data (`recent.json` and `companion-filing.json`), not vault data; the filing
  preference is app-wide and absent means on.
- API keys never enter the vault ([LAWS/SECRETS.md](../../LAWS/SECRETS.md)). The
  companion's own credential belongs to the Hermes profile; secrets the app stores
  for itself live in OS secure storage.
- Week start cannot be changed while weekly review or planning files exist
  ([LAWS/REVIEWS.md](../../LAWS/REVIEWS.md)).
- Restore books is an explicit, confirmed Settings action and never a Git hook
  ([LAWS/DATABASES.md](../../LAWS/DATABASES.md)).

## Tips and edge cases

- The gear popover is not the sheet. It offers the starred themes and the colour
  mode; everything else is behind **All settings**.
- An uncurated install has every theme starred, so the quick menu opens on the
  full set until you clear a star.
- If the quick menu is empty, the popover explains why and links to **Appearance**
  to star a theme.
- `Ctrl+R` reloads the whole app, not the sheet; a reload returns to the same tab
  because the tab is in the URL.
- A cold start that opens `/settings` directly has no page behind it; closing the
  sheet falls back to the Dashboard.
- Installing a theme only adds it to this window's list. Uninstalling the one you
  are wearing leaves the app on the default theme.
- The **Hermes** tab's "Apply assistant inserts immediately" list contains only
  databases that exist now. A checked entry whose database was deleted shows as a
  stale `domain / database` row so you can uncheck it.

## Related

- [The studio](./03-the-studio.md)
- [The vault](./04-the-vault.md)
- [Domains](./05-domains.md)
- [Companion](./24-companion.md)
- [Updates](./27-updates.md)
- [Security](./29-security.md)

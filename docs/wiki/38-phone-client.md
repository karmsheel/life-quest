# Phone client

The phone client is a small installable web app, served by your own studio, that
does two things and no more: it **queues a draft transaction** while the studio is
closed, and it shows **one metric you pin**. The transaction itself is still
posted by the companion in your chat, after you confirm it there; the phone never
posts money on its own. See also [Wiki home](./index.md).

## Where it lives

- The desktop side is **Settings → Phone**: the access switch, the address your
  phone reaches, the pairing code and its QR, the paired-phone list, and the one
  pinned metric.
- The phone side is the address itself — for example
  `https://<your-machine>.<tailnet>.ts.net/phone/` — opened in the phone's browser
  and added to the Home Screen. There is no app store, no account and no
  LifeQuest-hosted service.
- The door is a loopback listener on `127.0.0.1:8647`, on your own machine. It is
  not on your network and not on the internet; you expose it through the tunnel
  you already trust (Tailscale is the tested one).
- The phone app is built with the desktop (`npm run build` also builds it) and
  shipped inside the app, so it never lags the studio it talks to.

## What it is for

VISION already says what the phone may do: queue a draft while the studio is
quit, show a pinned metric, and stay out of the doctrine, the Finance kit, the
companion and Architecture. This is that surface, and the shape of it follows
from one fact — **the studio has no process while it is closed**. On Windows,
closing the window quits the app, and the vault, the MCP doors and the companion
go with it. There is nothing on the desktop to receive a phone's write.

So the phone holds the draft itself, in its own browser storage, and hands it
over the next time the studio is reachable. That is the whole offline story, and
it is why the queue survives a closed studio without a daemon, a tray app or a
listener nobody can see. The metric is cached the same way and always carries the
time it was read.

## How to use it

### Pair the phone

1. Open **Settings → Phone** and turn **Phone access** on.
2. Set the **Phone address** — the `https://…` address your phone will use. The
   app refuses a plain `http://` address: a phone app over http cannot install to
   the Home Screen and cannot cache its shell.
3. Expose the loopback door through your tunnel. With Tailscale:
   `tailscale serve --bg http://127.0.0.1:8647`. Never `tailscale funnel`, which
   publishes the door to the public internet.
4. Press **Pair a phone**. A one-time code appears with a QR and a five-minute
   countdown. Scan the QR with the phone's camera app (no in-app scanner, no
   camera permission), or open the page and type the code.
5. The phone pairs, and its name appears under **Paired phones** on the desktop.
   **Forget** revokes it; the phone is refused on its next call.

The code is single-use and lives only in the studio's memory. Ten wrong attempts
in five minutes lock pairing for five minutes. The vault stores a hash of each
phone's secret, never the secret itself, so a copied vault does not carry a
working credential.

### Queue a draft

1. On the phone, type what you spent, the way you would say it — `R85 Pick n Pay
   food` — and press **Queue**.
2. Nothing posts. The draft appears under **Waiting**, on this phone and in the
   studio's chat. If the studio is closed the phone says **Waiting for your
   studio**; the draft is safe on the phone and goes over when the studio returns.
3. In the studio's dock, the phone's queue shows above the message box. Its
   **Ask companion** control prefills a confirmation — it does not post.
4. Send it. The companion posts the transaction after that confirmation and
   reports the receipt; the phone shows **Posted** and clears the draft. If the
   words were not enough (*what amount?*, *which account?*), the companion asks in
   chat and the draft stays waiting until you answer.

You can take a draft back on the phone with **Withdraw** before the companion has
posted it.

### Pin the metric

1. On the desktop, choose one of **Net worth**, **Spent this month**, **Received
   this month**, or none, under **Pinned metric**.
2. The phone shows that one number, the period it covers, and **as of … · read N
   min ago**. It cannot open the ledger, list accounts, or switch to a second
   number.

The pin belongs to the vault, not to a phone, so a second paired phone shows the
same figure. Two rules keep the number honest: a total is never summed across
currencies (with no exchange rate set, the phone shows a dash and says why), and
internal transfers are not spend.

## The screen

- **Header**: the vault's name and whether the studio is reachable.
- **Metric card**: the pinned number, its period, and the age of the reading.
- **Queue a transaction**: one text field, 500 characters, and **Queue**.
- **Waiting**: the drafts, each with a state — *On this phone*, *Waiting for the
  companion*, or the resolution — and **Withdraw**.
- **Unpair this phone**: forgets the device on both sides.

On a first visit the page offers to be added to the Home Screen. That is what
lets the shell open with the studio quit; without it the phone still works, it
just needs the studio to be reachable each time.

## Rules and behaviour

- **A phone never posts money.** Only the companion does, from a chat turn, using
  its phone-draft tool. The phone's door has no route that creates a transaction.
- **A draft survives the studio being quit.** It is held on the phone and reaches
  the vault when the studio is reachable again.
- **The door shows the queue and one metric, nothing else.** No ledger rows,
  doctrine, documents, pages, databases or chat messages cross it.
- **The phone never talks to the companion.** It holds no companion token and
  cannot reach the companion's ports.
- **A cached metric says when it was read.** A number without its age is not
  shown.
- A connected agent — one you paired under [Agents](./25-agents.md) — cannot see
  or post phone drafts; the tools are the companion's own.
- A draft resolves exactly once: a second post answers "already posted", so a
  double press cannot produce two transactions.
- The queue holds up to 100 waiting drafts; the phone keeps one locally if the
  queue is full and retries. Resolved drafts are kept for a year so a phone that
  was offline when its draft posted finds the answer instead of sending it again.
- The whole surface is four screens, one metric and a queue. There is no chat on
  the phone, no receipt photo, no notification and no second number.

## Tips and edge cases

- **The phone says "Waiting for your studio" but the app is open.** The door is
  off, the address is wrong, or the tunnel is down. Settings → Phone names its
  own bind error; the address field refuses anything but a bare `https://` origin.
- **The studio was closed while a draft was waiting.** Nothing is lost: the phone
  keeps it, and the dock shows it after the studio opens. It posts only when you
  confirm it in chat.
- **The pair code expired.** Press **Pair a phone** again; the countdown is the
  whole lifetime of a code.
- **A phone was lost.** Press **Forget** beside it in Settings → Phone. The
  drafts it queued stay in the vault for the companion; nothing else is reachable
  without it.
- **A vault switch.** Phones are paired to a vault, so another vault starts with
  none and asks you to pair again. Phone access and the address are settings of
  this machine, not of the vault.
- **The metric is a dash.** Either no rate is set for a mixed-currency total, or
  the Finance kit is not installed in this vault; the phone says which.
- **iOS storage.** A draft that has not reached the studio yet lives in the
  phone's browser storage. Installing to the Home Screen and letting the app sync
  when the studio is open both help; a phone the app has not opened in months may
  lose an unsynced draft. The companion posts what did arrive.

## Related

- [The Companion](./24-companion.md)
- [Finance kit](./20-finance-kit.md)
- [Agents](./25-agents.md)
- [Settings](./28-settings.md)
- [Security](./29-security.md)
- [Phone laws](../../LAWS/PHONE.md)

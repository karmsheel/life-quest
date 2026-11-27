---
cadence: weekly
---
# Weekly review skill

Standing rules for this cadence's review sessions. Edit freely, or ask the
companion to add a rule — the whole file is handed to the review session.

## How to run this review

- Work from the review page the app has open. Read it with `get_review` and the scope you were given before you change anything; a page is written with `write_review(scope, body, baseRev)`.
- Look-back is for what happened, told straight. Keep is for what worked and should stay. Change is for what to do differently. Next-period intent is for what the next period is for.
- Prefer the operator's own words over your summary of them. `get_period_pack` carries the period's daily notes, log, tasks, goals and events — use it rather than asking for facts it already holds.
- Write into the section you were asked about, and leave the other sections, and the other pages, as they are.
- On the overall page, read every area page first and put the areas back together under the four common headings; never rewrite an area's page from there.
- When the report is ready, propose `mark_review_done` rather than marking it done yourself.

- A week is where patterns start to show. Name the one pattern worth changing, not five.
- Compare against the previous week's review when there is one.

## Snapshots

Each fenced block below names a figure the app itself writes into the review
before the interview starts, so the numbers are there whether or not the agent
is running. `window: period` means the block reads exactly the review's own
period; on the Financial page the three figures are gross cash in, gross cash
out (transfers excluded, printed positive) and net cash flow (transfers
included). Marked blocks are refreshed in place on every Start.

```lifequest-snapshot
{
  "id": "finance-in",
  "domain": "financial",
  "section": "Look-back",
  "title": "Cash in this period",
  "window": "period",
  "spec": {
    "databaseId": "finance:transactions",
    "title": "Cash in this period",
    "presentation": "metric",
    "groupBy": null,
    "timeBucket": null,
    "timeColumnId": "date",
    "timeWindow": "all",
    "filters": [
      {
        "columnId": "amount",
        "op": "gt",
        "value": 0
      },
      {
        "columnId": "transfer_id",
        "op": "is-not-set"
      }
    ],
    "measure": "sum",
    "measureColumnId": "amount",
    "per": null,
    "sort": {
      "by": "value",
      "dir": "desc"
    },
    "limit": 12,
    "convertToZar": true,
    "columns": []
  }
}
```

```lifequest-snapshot
{
  "id": "finance-out",
  "domain": "financial",
  "section": "Look-back",
  "title": "Cash out this period",
  "window": "period",
  "magnitude": "abs",
  "spec": {
    "databaseId": "finance:transactions",
    "title": "Cash out this period",
    "presentation": "metric",
    "groupBy": null,
    "timeBucket": null,
    "timeColumnId": "date",
    "timeWindow": "all",
    "filters": [
      {
        "columnId": "amount",
        "op": "lt",
        "value": 0
      },
      {
        "columnId": "transfer_id",
        "op": "is-not-set"
      }
    ],
    "measure": "sum",
    "measureColumnId": "amount",
    "per": null,
    "sort": {
      "by": "value",
      "dir": "desc"
    },
    "limit": 12,
    "convertToZar": true,
    "columns": []
  }
}
```

```lifequest-snapshot
{
  "id": "finance-net",
  "domain": "financial",
  "section": "Look-back",
  "title": "Net cash flow this period (transfers included)",
  "window": "period",
  "spec": {
    "databaseId": "finance:transactions",
    "title": "Net cash flow this period (transfers included)",
    "presentation": "metric",
    "groupBy": null,
    "timeBucket": null,
    "timeColumnId": "date",
    "timeWindow": "all",
    "filters": [],
    "measure": "sum",
    "measureColumnId": "amount",
    "per": null,
    "sort": {
      "by": "value",
      "dir": "desc"
    },
    "limit": 12,
    "convertToZar": true,
    "columns": []
  }
}
```

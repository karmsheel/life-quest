---
cadence: weekly
---
# Weekly review skill

Standing rules for this cadence's review sessions. Edit freely, or ask the
companion to add a rule — the whole file is handed to the review session.

## How to run this review

- Work from the review file the app has open. Read it with `get_review` before you change anything.
- Look-back is for what happened, told straight. Keep is for what worked and should stay. Change is for what to do differently. Next-period intent is for what the next period is for.
- Prefer the operator's own words over your summary of them. `get_period_pack` carries the period's daily notes, log, tasks, goals and events — use it rather than asking for facts it already holds.
- Write into the section you were asked about, and leave the other sections as they are.
- When the report is ready, propose `mark_review_done` rather than marking it done yourself.

- A week is where patterns start to show. Name the one pattern worth changing, not five.
- Compare against the previous week's review when there is one.

## Snapshots

Each fenced block below names a figure the app itself writes into the review
before the interview starts, so the numbers are there whether or not the agent
is running. `window: period` means the block reads exactly the review's own
period. Marked blocks are refreshed in place on every Start.

```lifequest-snapshot
{
  "id": "finance-spend",
  "domain": "financial",
  "section": "Look-back",
  "title": "Spending this period",
  "window": "period",
  "spec": {
    "databaseId": "finance:transactions",
    "title": "Spending this period",
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
    "columns": [],
    "blocks": [
      {
        "id": "total",
        "title": "Spend",
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
        "columns": [],
        "span": 2
      },
      {
        "id": "by-category",
        "title": "By category",
        "presentation": "table",
        "groupBy": "category",
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
        "columns": [],
        "span": 2
      }
    ]
  }
}
```

# Recurring tasks — Laws

A recurring task is a standing record of something that comes round: a title, a
cadence and the next due date. It is a schedule the Dashboard reads, not a card
on the Task Manager board. The five review cadences are built-in recurring items.

## MUST / MUST NOT

- A recurring task MUST be a standing record with a title, a cadence and a next due date.
- A recurring task MUST NOT be a card: it MUST NOT appear in any of the Task Manager's six columns.
- A recurring task's due row MUST be derived from its due date and the local day.
- Opening the app, the Dashboard or the Task Manager MUST NOT create a task, a card or a file for an occurrence.
- The Dashboard's Today & this week card MUST list the operator's recurring tasks that are overdue, due today, or due later in the vault's current week.
- A paused recurring task MUST NOT appear as due anywhere.
- A paused recurring task MUST keep its cadence, next due date and history until it is resumed.
- Completing an occurrence MUST record that occurrence's due date and the local day it was completed.
- Completing an occurrence MUST advance the next due date to the next occurrence.
- Completing an overdue occurrence MUST schedule the next occurrence after the local day of completion, and MUST NOT schedule a chain of past dates.
- A review's recurring row MUST be derived from the vault's review index: a review whose window has opened and whose overall review is not marked done MUST be due on the Dashboard.
- A review's recurring row MUST link to that review's page and MUST NOT carry a tick.
- A review's recurring row MUST clear when the review's overall review is marked done.
- The five reviews MUST NOT be added, paused or deleted as recurring tasks.
- A recurring task's page link MUST be an internal route and MUST NOT be an external address.
- A recurring task MUST be written only by the operator's own surfaces and the companion's recurring-task tools; an agent MUST NOT change one by any other path.

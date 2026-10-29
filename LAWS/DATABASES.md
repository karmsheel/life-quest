# Databases — Laws

Domain databases and pages live in the vault folder. The desktop book is that folder, not a hosted LifeQuest database.

## MUST / MUST NOT

- Domain databases MUST live in the vault folder.
- The product MUST NOT require a LifeQuest-hosted database.
- Adding data to a database — a new database, a new row, a batch of new rows — MUST NOT
  wait in Decisions; the operator's agreement in the chat is the confirmation and the write
  applies at once.
- An agent change to or deletion of data that already exists MUST appear as a pending
  Decision and MUST NOT land until the operator approves it.
- A new or changed ingest mapping MUST go through Decisions.
- Ingest batch rows MUST NOT post until the operator accepts the batch.
- Conversational capture MUST NOT post when the amount or the account is missing.
- Conversational capture MUST name what was logged when it posts.
- A kit install proposed by an agent MUST go through Decisions.
- JSON restore MUST require an explicit confirmed Settings action.
- Home MUST keep goal progress and deadline available as pins.
- Gauges MUST NOT ship as page blocks.

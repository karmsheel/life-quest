\- Never write unit tests after you write code.



\- Highly prefer E2E tests as the sole testing mechanism. Use them to verify complex features work. At the end of E2E tests, produce a verifiable and repeatable artifact.



\- If you must test a system in isolation, first write down all the ways it could fail, then write the code."



\- If a feature change only takes effect after a restart - a rebuilt main process, a changed preload or IPC channel, a dev server serving stale bundles - do the restart yourself at the end of the work, then verify the feature against the restarted process. In `apps/desktop`, `npm run dev` rebundles main and preload and relaunches the app, so that is the whole restart. Alerting the operator is not doing it, and a feature checked against a stale process is not checked. Restart only what the change needs; ask before stopping a process that is the operator's rather than one you started.


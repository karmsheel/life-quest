import { WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { AUTOMATIONS } from "@/lib/automations";

/**
 * The automations shelf.
 *
 * One row per job, grouped by the page that owns its trigger. A row does not run
 * the automation from here: the page holds the material the automation reads, and
 * the trigger belongs beside that material. The row's action is therefore a way
 * back to the page, not a second copy of the button.
 */
export default function AutomationsPage() {
  return (
    <div className="automations-page">
      <header className="automations-page__header">
        <h1 className="stub-page__title">Automations</h1>
        <p className="stub-page__desc muted">
          One-click jobs that read a page and open a chat with the agent.
        </p>
      </header>

      <section
        className="automations-page__group"
        aria-labelledby="automations-daily-note"
      >
        <h2 className="automations-page__group-title" id="automations-daily-note">
          Daily Note
        </h2>
        <ul className="automations-page__list">
          {AUTOMATIONS.map((automation) => (
            <li
              key={automation.id}
              className="automation-row"
              data-testid={`automation-${automation.id}`}
            >
              <span className="automation-row__icon" aria-hidden="true">
                <WandSparkles size={16} />
              </span>
              <div className="automation-row__body">
                <span className="automation-row__name">{automation.name}</span>
                <span className="automation-row__desc">
                  {automation.description}
                </span>
              </div>
              <Button
                variant="ghost"
                to={automation.host.href}
                className="automation-row__open"
              >
                Open {automation.host.label}
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

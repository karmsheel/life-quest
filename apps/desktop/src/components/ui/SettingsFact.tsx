/**
 * One name/value pair in a settings card, on one line.
 *
 * The settings page used to stack the name above its value with
 * `.settings-field`, which turned four short facts into eight rows and left
 * the card looking like an unfinished form. A fact is a definition, not a
 * field: name on the leading edge, value on the trailing one, one baseline.
 */
export function SettingsFact({
  label,
  value,
  error,
  status = false,
}: {
  label: string;
  /** Paths, URLs and ports — always set in the mono face. */
  value: string;
  /** A door that failed to bind keeps its own error under its own row. */
  error?: string | null;
  /** The value is the current state of something, not a static fact. */
  status?: boolean;
}) {
  return (
    <div className="settings-fact">
      <span className="settings-fact__label">{label}</span>
      <span
        className="settings-fact__value"
        role={status ? "status" : undefined}
        title={value}
      >
        {value}
      </span>
      {error ? (
        <p className="settings-fact__error form-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

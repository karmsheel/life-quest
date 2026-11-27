import { MessageSquareText } from "lucide-react";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { useComposerSendKey } from "@/lib/composer-send";

/**
 * Composer: the one page that says which key sends a chat message.
 *
 * There is nothing else here, and there should not be: the message box has one
 * send key, and this page is the whole of the choice. Ctrl/Cmd+Enter always
 * sends; what the operator picks is whether plain Enter sends too, or breaks the
 * line the way a paragraph is written.
 *
 * The choice is one row, not a paragraph with a checkbox under it — label and
 * description on the leading edge, the segmented control on the trailing edge,
 * and the row's own note reporting the state. It applies the moment it is
 * pressed and is remembered on this machine (see `composer-send.ts`), so there
 * is no Save button and nothing to restart.
 *
 * The page names its boundary as well as its setting: Notebox and the signal
 * chain are capture boxes that log with plain Enter, and this preference is not
 * about them.
 */
export function SettingsComposer() {
  const { sendKey, setSendKey } = useComposerSendKey();

  return (
    <SettingsSection
      icon={<MessageSquareText size={16} />}
      title="Composer"
      subtitle="How the message box sends"
    >
      <div
        className="settings-composer"
        data-composer-settings=""
        data-composer-send-key={sendKey}
      >
        <SettingsRow
          label="Send with"
          description="Choose whether plain Enter sends the message or breaks the line. Ctrl/Cmd+Enter always sends, so the default keeps Enter for writing a prompt as a paragraph. The choice applies immediately, is remembered on this machine, and — while a turn is running — the send key steers that turn instead of starting a second one. Notebox and the signal chain keep their own Enter-to-log."
          action={
            <SegmentedControl
              value={sendKey}
              options={[
                { value: "modified", label: "Ctrl/Cmd+Enter" },
                { value: "enter", label: "Enter" },
              ]}
              onChange={setSendKey}
              ariaLabel="Send key"
              size="sm"
            />
          }
          note={
            <p
              className="settings-composer__state"
              role="status"
              data-composer-send-hint={sendKey}
            >
              {sendKey === "enter" ? (
                <>
                  <strong>Enter</strong> sends the message.{" "}
                  <strong>Shift+Enter</strong> breaks the line, and
                  Ctrl/Cmd+Enter sends too — either key steers the turn while one
                  is running.
                </>
              ) : (
                <>
                  <strong>Enter</strong> breaks the line.{" "}
                  <strong>Ctrl/Cmd+Enter</strong> sends the message — and steers
                  the turn while one is running.
                </>
              )}
            </p>
          }
        />
      </div>
    </SettingsSection>
  );
}

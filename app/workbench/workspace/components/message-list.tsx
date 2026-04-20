import { MessageBubble } from "@/app/workbench/workspace/components/message-bubble";
import { formatDividerTime, shouldShowMessageDivider } from "@/app/workbench/workspace/helpers/message-view";
import type { WorkspaceRenderableMessage } from "@/app/workbench/workspace/types";

type Props = {
  messages: WorkspaceRenderableMessage[];
  retryingMessageId: string;
  onRetryMessage: (messageId: string) => void;
};

export function MessageList({ messages, retryingMessageId, onRetryMessage }: Props) {
  return (
    <>
      {messages.map((message, index) => {
        const previousMessage = index > 0 ? messages[index - 1] : null;
        const showDivider = shouldShowMessageDivider(previousMessage, message);
        return (
          <div key={message.id}>
            {showDivider ? (
              <div className="flex justify-center mb-3">
                <div className="text-[11px] text-gray-500 bg-white border border-gray-200 rounded-full px-3 py-1 shadow-sm">
                  {formatDividerTime(message.sentAt)}
                </div>
              </div>
            ) : null}
            <MessageBubble
              message={message}
              retryingMessageId={retryingMessageId}
              onRetryMessage={onRetryMessage}
            />
          </div>
        );
      })}
    </>
  );
}

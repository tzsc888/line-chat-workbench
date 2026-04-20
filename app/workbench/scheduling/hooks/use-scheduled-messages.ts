import { useCallback, useEffect, useState } from "react";

type WorkspaceLike = {
  customer: {
    id: string;
  };
};

export function useScheduledMessages(input: {
  selectedCustomerId: string;
  buildDefaultScheduledInputValue: () => string;
  loadWorkspace: (customerId: string, options?: { preserveUi?: boolean }) => Promise<void>;
  loadCustomers: (options?: { preserveUi?: boolean }) => Promise<void>;
}) {
  const [isSchedulingManual, setIsSchedulingManual] = useState(false);
  const [isSchedulePanelOpen, setIsSchedulePanelOpen] = useState(false);
  const [scheduleAtInput, setScheduleAtInput] = useState(() => input.buildDefaultScheduledInputValue());

  useEffect(() => {
    setIsSchedulePanelOpen(false);
    setScheduleAtInput(input.buildDefaultScheduledInputValue());
  }, [input, input.selectedCustomerId]);

  const toggleSchedulePanel = useCallback((hasWorkspace: boolean) => {
    if (!hasWorkspace) return;
    setIsSchedulePanelOpen((prev) => !prev);
  }, []);

  const closeSchedulePanel = useCallback(() => {
    setIsSchedulePanelOpen(false);
  }, []);

  const handleScheduleManualSend = useCallback(
    async (params: {
      workspace: WorkspaceLike | null;
      pendingImages: Array<unknown>;
      manualReply: string;
      setManualReply: (value: string) => void;
      setPendingImages: (updater: Array<unknown>) => void;
    }) => {
      const { workspace, pendingImages, manualReply, setManualReply, setPendingImages } = params;
      if (!workspace) {
        window.alert("当前没有选中的顾客");
        return;
      }
      if (pendingImages.length > 0) {
        window.alert("定时发送当前只支持文字。图片请直接发送，不要加入定时发送。");
        return;
      }
      if (!manualReply.trim()) {
        window.alert("请先输入要定时发送的文字内容");
        return;
      }
      if (!scheduleAtInput) {
        window.alert("请选择定时发送时间");
        return;
      }
      const scheduledFor = new Date(scheduleAtInput);
      if (!Number.isFinite(scheduledFor.getTime())) {
        window.alert("定时发送时间格式不正确");
        return;
      }
      if (scheduledFor.getTime() - Date.now() < 30 * 60 * 1000) {
        window.alert("定时发送至少要比当前时间晚 30 分钟");
        return;
      }
      const japaneseText = manualReply.replace(/\r\n/g, "\n");
      try {
        setIsSchedulingManual(true);
        const response = await fetch(`/api/customers/${workspace.customer.id}/scheduled-messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            japaneseText,
            imageUrl: "",
            source: "MANUAL",
            type: "TEXT",
            scheduledFor: scheduledFor.toISOString(),
          }),
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data?.error || "创建定时发送失败");
        }
        setManualReply("");
        setPendingImages([]);
        setIsSchedulePanelOpen(false);
        setScheduleAtInput(input.buildDefaultScheduledInputValue());
        await input.loadWorkspace(workspace.customer.id, { preserveUi: true });
        await input.loadCustomers({ preserveUi: true });
      } catch (error) {
        console.error(error);
        window.alert(error instanceof Error ? error.message : "创建定时发送失败");
      } finally {
        setIsSchedulingManual(false);
      }
    },
    [input, scheduleAtInput],
  );

  const handleCancelScheduledMessage = useCallback(
    async (params: {
      workspace: WorkspaceLike | null;
      scheduledMessageId: string;
    }) => {
      const { workspace, scheduledMessageId } = params;
      if (!workspace) return;
      if (!window.confirm("确认取消这条定时发送吗？")) return;
      try {
        const response = await fetch(`/api/scheduled-messages/${scheduledMessageId}`, {
          method: "DELETE",
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data?.error || "取消定时发送失败");
        }
        await input.loadWorkspace(workspace.customer.id, { preserveUi: true });
        await input.loadCustomers({ preserveUi: true });
      } catch (error) {
        console.error(error);
        window.alert(error instanceof Error ? error.message : "取消定时发送失败");
      }
    },
    [input],
  );

  return {
    state: {
      isSchedulingManual,
      isSchedulePanelOpen,
      scheduleAtInput,
    },
    actions: {
      setScheduleAtInput,
      setIsSchedulePanelOpen,
      toggleSchedulePanel,
      closeSchedulePanel,
      handleScheduleManualSend,
      handleCancelScheduledMessage,
    },
  };
}

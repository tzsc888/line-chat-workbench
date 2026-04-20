import { useCallback, useState } from "react";

export type PresetSnippet = {
  id: string;
  title: string;
  content: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export function usePresetMessages(input: {
  onApplySnippet: (content: string) => void;
  onOpenPanel?: () => void;
  onClosePanel?: () => void;
}) {
  const [isPresetPanelOpen, setIsPresetPanelOpen] = useState(false);
  const [presetSnippets, setPresetSnippets] = useState<PresetSnippet[]>([]);
  const [isPresetLoading, setIsPresetLoading] = useState(false);
  const [isPresetSaving, setIsPresetSaving] = useState(false);
  const [editingPresetId, setEditingPresetId] = useState("");
  const [presetTitle, setPresetTitle] = useState("");
  const [presetContent, setPresetContent] = useState("");

  const resetPresetForm = useCallback(() => {
    setEditingPresetId("");
    setPresetTitle("");
    setPresetContent("");
  }, []);

  const loadPresetSnippets = useCallback(async () => {
    try {
      setIsPresetLoading(true);
      const response = await fetch("/api/preset-messages", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data?.error || "读取预设信息失败");
      }
      setPresetSnippets(data.items || []);
    } catch (error) {
      console.error(error);
      window.alert("读取预设信息失败，请看终端报错");
    } finally {
      setIsPresetLoading(false);
    }
  }, []);

  const openPresetPanel = useCallback(() => {
    input.onOpenPanel?.();
    setIsPresetPanelOpen(true);
    resetPresetForm();
    void loadPresetSnippets();
  }, [input, loadPresetSnippets, resetPresetForm]);

  const closePresetPanel = useCallback(() => {
    input.onClosePanel?.();
    setIsPresetPanelOpen(false);
    resetPresetForm();
  }, [input, resetPresetForm]);

  const applyPresetSnippet = useCallback(
    (item: PresetSnippet) => {
      input.onApplySnippet(item.content);
      setIsPresetPanelOpen(false);
    },
    [input],
  );

  const startEditPreset = useCallback((item: PresetSnippet) => {
    setEditingPresetId(item.id);
    setPresetTitle(item.title);
    setPresetContent(item.content);
  }, []);

  const handleSavePreset = useCallback(async () => {
    if (!presetTitle.trim()) {
      window.alert("预设名称不能为空");
      return;
    }
    if (!presetContent.trim()) {
      window.alert("预设内容不能为空");
      return;
    }
    try {
      setIsPresetSaving(true);
      const response = await fetch(
        editingPresetId ? `/api/preset-messages/${editingPresetId}` : "/api/preset-messages",
        {
          method: editingPresetId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: presetTitle,
            content: presetContent,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data?.error || "保存预设信息失败");
      }
      resetPresetForm();
      await loadPresetSnippets();
    } catch (error) {
      console.error(error);
      window.alert("保存预设信息失败，请看终端报错");
    } finally {
      setIsPresetSaving(false);
    }
  }, [editingPresetId, loadPresetSnippets, presetContent, presetTitle, resetPresetForm]);

  const handleDeletePreset = useCallback(
    async (id: string) => {
      if (!window.confirm("确认删除这条预设信息吗？")) return;
      try {
        const response = await fetch(`/api/preset-messages/${id}`, {
          method: "DELETE",
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data?.error || "删除预设信息失败");
        }
        if (editingPresetId === id) {
          resetPresetForm();
        }
        await loadPresetSnippets();
      } catch (error) {
        console.error(error);
        window.alert("删除预设信息失败，请看终端报错");
      }
    },
    [editingPresetId, loadPresetSnippets, resetPresetForm],
  );

  return {
    state: {
      isPresetPanelOpen,
      presetSnippets,
      isPresetLoading,
      isPresetSaving,
      editingPresetId,
      presetTitle,
      presetContent,
    },
    actions: {
      setPresetTitle,
      setPresetContent,
      loadPresetSnippets,
      openPresetPanel,
      closePresetPanel,
      applyPresetSnippet,
      startEditPreset,
      resetPresetForm,
      handleSavePreset,
      handleDeletePreset,
    },
  };
}

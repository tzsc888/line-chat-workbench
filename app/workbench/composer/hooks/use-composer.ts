import { useCallback, useEffect, useState, type ChangeEvent, type DragEvent, type KeyboardEvent, type RefObject } from "react";
import { MessageSource } from "@prisma/client";

export type PendingUploadImage = {
  url: string;
  originalName: string;
  size: number;
  contentType: string | null;
};

type WorkspaceLike = {
  customer: {
    id: string;
  };
};

type SubmitOutboundMessageInput = {
  customerId: string;
  japaneseText: string;
  chineseText?: string | null;
  imageUrl?: string | null;
  stickerPackageId?: string | null;
  stickerId?: string | null;
  type: "TEXT" | "IMAGE" | "STICKER";
  source: MessageSource;
  replyDraftSetId?: string;
  suggestionVariant?: "STABLE" | "ADVANCING";
  optimisticMessageId?: string;
};

export function useComposer(input: {
  workspace: WorkspaceLike | null;
  imageInputRef: RefObject<HTMLInputElement | null>;
  manualReplyTextareaRef?: RefObject<HTMLTextAreaElement | null>;
  closeSchedulePanel: () => void;
  submitOutboundMessage: (params: SubmitOutboundMessageInput) => Promise<{ ok: boolean }>;
}) {
  const [manualReply, setManualReply] = useState("");
  const [pendingImages, setPendingImages] = useState<PendingUploadImage[]>([]);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isComposerDragOver, setIsComposerDragOver] = useState(false);
  const [isComposerMenuOpen, setIsComposerMenuOpen] = useState(false);

  const uploadImageFiles = useCallback(async (files: File[]) => {
    const validFiles = files.filter((file) => file.type.startsWith("image/"));
    if (!validFiles.length) {
      window.alert("只能上传图片文件");
      return;
    }
    if (validFiles.length !== files.length) {
      window.alert("已自动忽略非图片文件");
    }

    try {
      setIsUploadingImage(true);
      const uploaded: PendingUploadImage[] = [];
      for (const file of validFiles) {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch("/api/uploads/images", {
          method: "POST",
          body: formData,
        });
        const data = await response.json();
        if (!response.ok || !data.ok || !data.image?.url) {
          throw new Error(data?.error || `上传图片失败：${file.name}`);
        }
        uploaded.push({
          url: data.image.url,
          originalName: data.image.originalName || file.name,
          size: Number(data.image.size || file.size || 0),
          contentType: typeof data.image.contentType === "string" ? data.image.contentType : file.type,
        });
      }
      setPendingImages((current) => [...current, ...uploaded]);
      setIsComposerMenuOpen(false);
    } catch (error) {
      console.error(error);
      window.alert("上传图片失败，请检查 Blob 配置或终端报错");
    } finally {
      setIsUploadingImage(false);
    }
  }, []);

  const handleAddImage = useCallback(() => {
    setIsComposerMenuOpen(false);
    input.closeSchedulePanel();
    input.imageInputRef.current?.click();
  }, [input]);

  const handleImageInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    void uploadImageFiles(files);
    event.target.value = "";
  }, [uploadImageFiles]);

  const removePendingImage = useCallback((targetUrl: string) => {
    setPendingImages((current) => current.filter((item) => item.url !== targetUrl));
  }, []);

  const clearPendingImages = useCallback(() => {
    setPendingImages([]);
  }, []);

  const handleComposerDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsComposerDragOver(true);
  }, []);

  const handleComposerDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsComposerDragOver(false);
  }, []);

  const handleComposerDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsComposerDragOver(false);
    const files = Array.from(event.dataTransfer.files || []);
    if (!files.length) return;
    void uploadImageFiles(files);
  }, [uploadImageFiles]);

  const handleManualSend = useCallback(async () => {
    if (!input.workspace) {
      window.alert("当前没有选中的顾客");
      return;
    }
    if (!manualReply.trim() && pendingImages.length === 0) {
      window.alert("请先输入文本或选择图片");
      return;
    }
    const japaneseText = manualReply.replace(/\r\n/g, "\n").trim();
    const nextImages = [...pendingImages];
    setManualReply("");
    setPendingImages([]);

    if (nextImages.length > 0) {
      for (let index = 0; index < nextImages.length; index += 1) {
        const imageItem = nextImages[index];
        const imageResult = await input.submitOutboundMessage({
          customerId: input.workspace.customer.id,
          japaneseText: "",
          imageUrl: imageItem.url,
          source: "MANUAL",
          type: "IMAGE",
        });
        if (!imageResult.ok) {
          const remainingImages = nextImages.slice(index);
          if (japaneseText) {
            setManualReply(japaneseText);
          }
          setPendingImages(remainingImages);
          window.alert(remainingImages.length > 1 ? "部分图片发送失败，剩余图片已保留，请重试" : "图片发送失败，请重试");
          return;
        }
      }

      if (japaneseText) {
        const textResult = await input.submitOutboundMessage({
          customerId: input.workspace.customer.id,
          japaneseText,
          source: "MANUAL",
          type: "TEXT",
        });
        if (!textResult.ok) {
          setManualReply(japaneseText);
          window.alert("图片已排队发送，但补充文字发送失败，请重试文字消息");
        }
      }
      return;
    }

    void input.submitOutboundMessage({
      customerId: input.workspace.customer.id,
      japaneseText,
      source: "MANUAL",
      type: "TEXT",
    });
  }, [input, manualReply, pendingImages]);

  const handleManualReplyKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    if (event.shiftKey) return;
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (isUploadingImage || !input.workspace) return;
    if (!manualReply.trim() && pendingImages.length === 0) return;
    void handleManualSend();
  }, [handleManualSend, input.workspace, isUploadingImage, manualReply, pendingImages.length]);

  const handleSendSticker = useCallback(async () => {
    if (!input.workspace) {
      window.alert("当前没有选中的顾客");
      return;
    }

    const packageIdInput = window.prompt("请输入 LINE 贴图 packageId", "11537");
    if (packageIdInput === null) return;
    const stickerIdInput = window.prompt("请输入 LINE 贴图 stickerId", "52002734");
    if (stickerIdInput === null) return;

    const stickerPackageId = packageIdInput.trim();
    const stickerId = stickerIdInput.trim();

    if (!stickerPackageId || !stickerId) {
      window.alert("packageId 和 stickerId 都不能为空");
      return;
    }

    setIsComposerMenuOpen(false);
    const result = await input.submitOutboundMessage({
      customerId: input.workspace.customer.id,
      japaneseText: "[贴图]",
      source: "MANUAL",
      type: "STICKER",
      stickerPackageId,
      stickerId,
    });

    if (!result.ok) {
      window.alert("贴图发送失败，请重试");
    }
  }, [input]);

  const resetComposer = useCallback(() => {
    setManualReply("");
    setPendingImages([]);
  }, []);

  useEffect(() => {
    const textarea = input.manualReplyTextareaRef?.current;
    if (!textarea) return;
    const minHeight = 44;
    const maxHeight = 176;
    textarea.style.height = "auto";
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [input.manualReplyTextareaRef, manualReply]);

  return {
    state: {
      manualReply,
      pendingImages,
      isUploadingImage,
      isComposerDragOver,
      isComposerMenuOpen,
    },
    actions: {
      setManualReply,
      setPendingImages,
      setIsComposerMenuOpen,
      handleAddImage,
      handleImageInputChange,
      removePendingImage,
      clearPendingImages,
      handleComposerDragOver,
      handleComposerDragLeave,
      handleComposerDrop,
      handleManualReplyKeyDown,
      handleManualSend,
      handleSendSticker,
      resetComposer,
    },
  };
}

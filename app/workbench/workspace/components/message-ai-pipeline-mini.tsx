import type { MessagePipeline, MessagePipelineStep } from "@/app/workbench/workspace/types";

type Props = {
  pipeline: MessagePipeline | null | undefined;
};

const STEP_LABEL: Record<MessagePipelineStep["step"], string> = {
  translation: "翻译",
  generation: "生成",
};

function getStatusMeta(step: MessagePipelineStep) {
  if (step.status === "reused" || step.reason_code === "reused_existing_draft") {
    return {
      label: "复用草稿",
      className: "border-amber-200 bg-amber-50 text-amber-700",
    };
  }
  if (step.status === "succeeded") {
    return {
      label: "完成",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    };
  }
  if (step.status === "failed") {
    return {
      label: "失败",
      className: "border-red-200 bg-red-50 text-red-600",
    };
  }
  if (step.status === "pending") {
    return {
      label: "处理中",
      className: "border-slate-200 bg-slate-50 text-slate-600",
    };
  }
  return {
    label: "跳过",
    className: "border-gray-200 bg-gray-50 text-gray-600",
  };
}

export function MessageAiPipelineMini({ pipeline }: Props) {
  if (!pipeline?.steps?.length) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
      {pipeline.steps.map((step) => {
        const meta = getStatusMeta(step);
        return (
          <span
            key={step.step}
            title={`${STEP_LABEL[step.step]}: ${step.reason_label || "-"}`}
            className={`inline-flex items-center rounded-full border px-2 py-0.5 ${meta.className}`}
          >
            {STEP_LABEL[step.step]} {meta.label}
          </span>
        );
      })}
    </div>
  );
}


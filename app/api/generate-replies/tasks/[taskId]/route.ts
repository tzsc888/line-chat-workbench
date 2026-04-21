import { NextResponse } from "next/server";
import { getGenerationTaskByScope } from "@/lib/generation-tasks";

type Props = {
  params: Promise<{ taskId: string }>;
};

export async function GET(request: Request, { params }: Props) {
  try {
    const { taskId } = await params;
    const requestUrl = new URL(request.url);
    const customerId = requestUrl.searchParams.get("customerId") || "";
    if (!customerId.trim()) {
      return NextResponse.json({ ok: false, error: "missing customerId" }, { status: 400 });
    }

    const task = await getGenerationTaskByScope({ taskId, customerId });

    if (!task) {
      return NextResponse.json({ ok: false, error: "task_not_found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      task,
    });
  } catch (error) {
    console.error("GET /api/generate-replies/tasks/[taskId] error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

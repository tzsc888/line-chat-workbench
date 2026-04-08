import { NextResponse } from "next/server";
import { put } from "@vercel/blob";

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
]);
const MAX_UPLOAD_SIZE_BYTES = 1024 * 1024;

function sanitizeFilename(name: string) {
  return name
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

export async function POST(req: Request) {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json(
        { ok: false, error: "未配置 Vercel Blob（缺少 BLOB_READ_WRITE_TOKEN）" },
        { status: 500 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "没有收到图片文件" }, { status: 400 });
    }

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      return NextResponse.json(
        { ok: false, error: "仅支持 JPG、PNG 图片" },
        { status: 400 }
      );
    }

    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      return NextResponse.json(
        { ok: false, error: "图片过大，请控制在 1MB 以内（便于直接发送到 LINE）" },
        { status: 400 }
      );
    }

    const safeName = sanitizeFilename(file.name || "image");
    const blob = await put(`chat-images/${Date.now()}-${safeName}`, file, {
      access: "public",
      addRandomSuffix: true,
      contentType: file.type,
    });

    return NextResponse.json({
      ok: true,
      image: {
        url: blob.url,
        pathname: blob.pathname,
        contentType: blob.contentType,
        size: file.size,
        originalName: file.name,
      },
    });
  } catch (error) {
    console.error("POST /api/uploads/images error:", error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
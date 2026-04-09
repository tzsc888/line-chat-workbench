"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

type Bucket = "UNCONVERTED" | "VIP";
type Tier = "A" | "B" | "C";
type State = "ACTIVE" | "DONE" | "PAUSED";

type FollowupItem = {
  id: string;
  lineUserId: string | null;
  remarkName: string | null;
  originalName: string;
  stage: string;
  isVip: boolean;
  bucket: Bucket;
  tier: Tier;
  state: State;
  reason: string;
  nextFollowupAt: string | null;
  lastFollowupHandledAt: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  isOverdue: boolean;
  latestMessage: {
    id: string;
    role: "CUSTOMER" | "OPERATOR";
    type: "TEXT" | "IMAGE";
    sentAt: string;
    previewText: string;
  } | null;
};

type Counts = {
  UNCONVERTED: Record<Tier, number>;
  VIP: Record<Tier, number>;
  overdue: number;
};

function getDisplayName(item: Pick<FollowupItem, "remarkName" | "originalName"> | null) {
  if (!item) return "未选择顾客";
  return item.remarkName?.trim() || item.originalName || "未命名顾客";
}

function formatDateTime(value: string | null) {
  if (!value) return "未设置";
  const date = new Date(value);
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatForInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function FollowupsPageContent() {
  const searchParams = useSearchParams();
  const requestedCustomerId = searchParams.get("customerId") || "";
  const [bucket, setBucket] = useState<Bucket>("UNCONVERTED");
  const [tier, setTier] = useState<Tier>("A");
  const [items, setItems] = useState<FollowupItem[]>([]);
  const [counts, setCounts] = useState<Counts>({
    UNCONVERTED: { A: 0, B: 0, C: 0 },
    VIP: { A: 0, B: 0, C: 0 },
    overdue: 0,
  });
  const [selectedId, setSelectedId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) || items[0] || null,
    [items, selectedId]
  );

  const [editBucket, setEditBucket] = useState<Bucket>("UNCONVERTED");
  const [editTier, setEditTier] = useState<Tier>("A");
  const [editReason, setEditReason] = useState("");
  const [editNextFollowupAt, setEditNextFollowupAt] = useState("");
  const [editState, setEditState] = useState<State>("ACTIVE");

  useEffect(() => {
    if (!requestedCustomerId) return;
    if (!items.some((item) => item.id === requestedCustomerId)) return;
    if (selectedId === requestedCustomerId) return;
    setSelectedId(requestedCustomerId);
  }, [requestedCustomerId, items, selectedId]);

  const loadItems = useCallback(async () => {
    try {
      setIsLoading(true);
      setError("");
      const response = await fetch(`/api/followups?bucket=${bucket}&tier=${tier}`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data?.error || "读取跟进列表失败");
      }
      const nextItems: FollowupItem[] = data.items || [];
      setItems(nextItems);
      setCounts(data.counts);
      setSelectedId((prev) => (prev && nextItems.some((item) => item.id === prev) ? prev : nextItems[0]?.id || ""));
    } catch (err) {
      console.error(err);
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }, [bucket, tier]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (!selectedItem) return;
    setEditBucket(selectedItem.bucket);
    setEditTier(selectedItem.tier);
    setEditReason(selectedItem.reason || "");
    setEditNextFollowupAt(formatForInput(selectedItem.nextFollowupAt));
    setEditState(selectedItem.state);
  }, [selectedItem]);

  async function saveChanges(extra?: Record<string, unknown>) {
    if (!selectedItem) return;
    try {
      setIsSaving(true);
      const response = await fetch(`/api/followups/${selectedItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bucket: editBucket,
          tier: editTier,
          reason: editReason,
          nextFollowupAt: editNextFollowupAt || null,
          state: editState,
          ...extra,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data?.error || "保存失败");
      }
      await loadItems();
    } catch (err) {
      console.error(err);
      window.alert("保存跟进信息失败，请看终端报错");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
          <div>
            <div className="text-xl font-bold text-gray-900">跟进中心</div>
            <div className="text-sm text-gray-500">未成交 / VIP 已成交 · A/B/C 分层管理</div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="rounded-full bg-red-50 px-3 py-1 text-red-600">到期 {counts.overdue}</div>
            <Link href="/" className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
              返回工作台
            </Link>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {[
            { key: "UNCONVERTED", label: "未成交" },
            { key: "VIP", label: "VIP 已成交" },
          ].map((item) => {
            const active = bucket === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setBucket(item.key as Bucket)}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                  active ? "bg-green-600 text-white" : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2">
          {(["A", "B", "C"] as Tier[]).map((value) => {
            const active = tier === value;
            return (
              <button
                key={value}
                onClick={() => setTier(value)}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                  active ? "bg-gray-900 text-white" : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
                }`}
              >
                {value} 类（{counts[bucket][value]}）
              </button>
            );
          })}
        </div>

        <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-4 py-3 text-sm font-medium text-gray-700">
              跟进列表
            </div>
            <div className="max-h-[72vh] overflow-y-auto p-3 space-y-2">
              {error ? <div className="text-sm text-red-500">{error}</div> : null}
              {isLoading ? <div className="text-sm text-gray-500">加载中...</div> : null}
              {!isLoading && items.length === 0 ? <div className="text-sm text-gray-500">这个池子里暂时没有顾客</div> : null}
              {items.map((item) => {
                const active = selectedItem?.id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                      active ? "border-green-200 bg-green-50" : "border-gray-200 bg-white hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-gray-900">{getDisplayName(item)}</div>
                        <div className="mt-1 text-xs text-gray-500">{item.stage}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {item.isOverdue ? <span className="h-2.5 w-2.5 rounded-full bg-red-500" /> : null}
                        {item.unreadCount > 0 ? (
                          <span className="min-w-[20px] rounded-full bg-green-600 px-1.5 py-0.5 text-center text-[11px] text-white">
                            {item.unreadCount}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-2 line-clamp-2 text-xs text-gray-600">{item.latestMessage?.previewText || "暂无消息"}</div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-gray-500">
                      <span>{formatDateTime(item.nextFollowupAt)}</span>
                      <span>{item.tier} 类</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-base font-semibold text-gray-900">{selectedItem ? getDisplayName(selectedItem) : "未选择顾客"}</div>
                  <div className="mt-1 text-sm text-gray-500">{selectedItem?.latestMessage?.previewText || "请从左侧选择顾客"}</div>
                </div>
                {selectedItem ? (
                  <Link
                    href={`/?customerId=${selectedItem.id}`}
                    className="shrink-0 rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    打开聊天
                  </Link>
                ) : null}
              </div>
            </div>
            {selectedItem ? (
              <div className="grid gap-4 p-5 md:grid-cols-2">
                <label className="space-y-2">
                  <div className="text-sm font-medium text-gray-700">所属池子</div>
                  <select
                    value={editBucket}
                    onChange={(e) => setEditBucket(e.target.value as Bucket)}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-green-300"
                  >
                    <option value="UNCONVERTED">未成交</option>
                    <option value="VIP">VIP 已成交</option>
                  </select>
                </label>

                <label className="space-y-2">
                  <div className="text-sm font-medium text-gray-700">等级</div>
                  <select
                    value={editTier}
                    onChange={(e) => setEditTier(e.target.value as Tier)}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-green-300"
                  >
                    <option value="A">A 类</option>
                    <option value="B">B 类</option>
                    <option value="C">C 类</option>
                  </select>
                </label>

                <label className="space-y-2 md:col-span-2">
                  <div className="text-sm font-medium text-gray-700">下次跟进时间</div>
                  <input
                    type="datetime-local"
                    value={editNextFollowupAt}
                    onChange={(e) => setEditNextFollowupAt(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-green-300"
                  />
                </label>

                <label className="space-y-2 md:col-span-2">
                  <div className="text-sm font-medium text-gray-700">跟进原因</div>
                  <textarea
                    value={editReason}
                    onChange={(e) => setEditReason(e.target.value)}
                    rows={4}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-green-300"
                    placeholder="例如：已问下一步怎么办 / 首单后有反馈 / 接近成交"
                  />
                </label>

                <label className="space-y-2 md:col-span-2">
                  <div className="text-sm font-medium text-gray-700">状态</div>
                  <select
                    value={editState}
                    onChange={(e) => setEditState(e.target.value as State)}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-green-300"
                  >
                    <option value="ACTIVE">待跟进</option>
                    <option value="PAUSED">暂停</option>
                    <option value="DONE">已处理</option>
                  </select>
                </label>

                <div className="md:col-span-2 flex flex-wrap items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => saveChanges()}
                    disabled={isSaving}
                    className="rounded-xl bg-green-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {isSaving ? "保存中..." : "保存跟进信息"}
                  </button>

                  <button
                    type="button"
                    onClick={() => saveChanges({ markHandled: true })}
                    disabled={isSaving}
                    className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    标记已处理
                  </button>

                  <button
                    type="button"
                    onClick={() => saveChanges({ reactivate: true, state: "ACTIVE" })}
                    disabled={isSaving}
                    className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    重新激活
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-5 text-sm text-gray-500">请先从左侧选择一个顾客。</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FollowupsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-100 p-4 md:p-6">
          <div className="mx-auto max-w-7xl rounded-2xl border border-gray-200 bg-white px-5 py-6 text-sm text-gray-500 shadow-sm">
            跟进页面加载中...
          </div>
        </div>
      }
    >
      <FollowupsPageContent />
    </Suspense>
  );
}

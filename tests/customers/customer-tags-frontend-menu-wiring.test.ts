import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function read(filePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

test("page should load all tags via GET /api/tags", () => {
  const page = read("app/page.tsx");
  assert.match(page, /const \[allTags, setAllTags\] = useState/);
  assert.match(page, /const loadAllTags = useCallback/);
  assert.match(page, /fetch\("\/api\/tags"/);
  assert.match(page, /void loadAllTags\(\)/);
});

test("customer context menu should include tag submenu entry and add-tag action", () => {
  const page = read("app/page.tsx");
  assert.match(page, /setIsTagSubmenuOpen\(true\)/);
  assert.match(page, /handleOpenTagCreateDialog\(\)/);
  assert.match(page, /allTags\.length === 0/);
});

test("tag submenu should wire create, attach and detach APIs", () => {
  const page = read("app/page.tsx");
  assert.match(page, /fetch\("\/api\/tags", \{/);
  assert.match(page, /`\/api\/customers\/\$\{targetCustomerId\}\/tags`/);
  assert.match(page, /`\/api\/customers\/\$\{customer\.id\}\/tags\/\$\{tag\.id\}`/);
  assert.match(page, /refreshCustomerSummary\(customer\.id, \{ preserveUi: true \}\)/);
});

test("tag submenu should provide global delete entry per tag and stop propagation", () => {
  const page = read("app/page.tsx");
  assert.match(page, /aria-label=\{`删除标签 \$\{tag\.name\}`\}/);
  assert.match(page, /event\.stopPropagation\(\)/);
  assert.match(page, /handleOpenTagDeleteDialog\(tag\)/);
  assert.match(page, /void handleToggleCustomerTag\(contextMenuCustomer, tag\)/);
});

test("tag create error mapping and no inbound sound reason change", () => {
  const page = read("app/page.tsx");
  assert.match(page, /tag_limit_reached/);
  assert.match(page, /tag_name_exists/);
  assert.match(page, /invalid_tag_name/);
  assert.match(page, /setTagCreateError\(/);
  assert.equal(page.includes("\"customer-tags-updated\""), false);
  assert.equal(page.includes("\"tags-updated\""), true);
  assert.match(page, /new Set\(\["inbound-message", "bridge-inbound-message", "inbound-message-created"\]\)/);
});

test("tags-updated realtime should prune local tag state and reload allTags", () => {
  const page = read("app/page.tsx");
  assert.match(page, /if \(reason === "tags-updated"\)/);
  assert.match(page, /setAllTags\(\(prev\) => prev\.filter\(\(item\) => item\.id !== tagId\)\)/);
  assert.match(page, /setCustomers\(\(prev\) =>[\s\S]*tags: customer\.tags\.filter\(\(item\) => item\.id !== tagId\)/);
  assert.match(page, /setWorkspace\(\(prev\) =>[\s\S]*tags: prev\.customer\.tags\.filter\(\(item\) => item\.id !== tagId\)/);
  assert.match(page, /void loadAllTags\(\);/);
  assert.match(page, /void runRealtimeRefresh\(null\);/);
});

test("customer-tags-updated path should keep summary refresh behavior without forcing loadAllTags", () => {
  const page = read("app/page.tsx");
  assert.match(page, /customerSummaryPreferredReasonsRef/);
  assert.match(page, /void refreshCustomerSummary\(targetCustomerId, \{ preserveUi: true \}\)/);
  assert.doesNotMatch(page, /reason === "customer-tags-updated"[\s\S]*loadAllTags\(/);
});

test("tag submenu hover handoff should use close timer buffer and cancel on enter", () => {
  const page = read("app/page.tsx");
  assert.match(page, /const tagSubmenuCloseTimerRef = useRef<number \| null>\(null\)/);
  assert.match(page, /const scheduleTagSubmenuClose = useCallback/);
  assert.match(page, /window\.setTimeout\(\(\) => \{\s*setIsTagSubmenuOpen\(false\);[\s\S]*\}, 120\)/);
  assert.match(page, /onMouseEnter=\{cancelTagSubmenuClose\}/);
  assert.match(page, /onMouseLeave=\{scheduleTagSubmenuClose\}/);
});

test("tag create dialog should keep stable target customer id and clean state", () => {
  const page = read("app/page.tsx");
  assert.match(page, /const \[tagDialogTargetCustomerId, setTagDialogTargetCustomerId\] = useState\(""\)/);
  assert.match(page, /setTagDialogTargetCustomerId\(customerId\)/);
  assert.match(page, /closeCustomerTagMenus\(\);\s*setIsTagCreateDialogOpen\(true\)/);
  assert.match(page, /const targetCustomerId = tagDialogTargetCustomerId\.trim\(\)/);
  assert.match(page, /setTagCreateError\("标签已创建，但添加到顾客失败"\)/);
  assert.match(page, /setTagDialogTargetCustomerId\(""\)/);
  assert.match(page, /setNewTagName\(""\)/);
  assert.match(page, /setTagCreateError\(""\)/);
});

test("tag delete confirm dialog should call DELETE /api/tags/[tagId] and cleanup state", () => {
  const page = read("app/page.tsx");
  assert.match(page, /const \[isTagDeleteDialogOpen, setIsTagDeleteDialogOpen\] = useState\(false\)/);
  assert.match(page, /const \[tagDeleteTarget, setTagDeleteTarget\] = useState<CustomerTagItem \| null>\(null\)/);
  assert.match(page, /const \[tagDeleteTargetCustomerId, setTagDeleteTargetCustomerId\] = useState\(""\)/);
  assert.match(page, /const \[isDeletingTag, setIsDeletingTag\] = useState\(false\)/);
  assert.match(page, /const \[tagDeleteError, setTagDeleteError\] = useState\(""\)/);
  assert.match(page, /fetch\(`\/api\/tags\/\$\{targetTagId\}`,\s*\{\s*method:\s*"DELETE"/);
  assert.match(page, /setAllTags\(\(prev\) => prev\.filter\(\(item\) => item\.id !== targetTagId\)\)/);
  assert.match(page, /refreshCustomerSummary\(tagDeleteTargetCustomerId, \{ preserveUi: true \}\)/);
  assert.match(page, /resetTagDeleteDialogState\(\)/);
});

test("customer card should replace followup tier badge with custom tag badges", () => {
  const page = read("app/page.tsx");
  assert.match(page, /customer\.tags\.length > 0/);
  assert.match(page, /customer\.tags\.slice\(0, 2\)\.map/);
  assert.match(page, /\+\\?\{customer\.tags\.length - 2\}/);
  assert.match(page, /backgroundColor: tag\.color \|\| "#94A3B8"/);
  assert.match(page, /max-w-\[56px\] truncate/);
  assert.match(page, /max-w-\[140px\].*overflow-hidden.*whitespace-nowrap/);
  assert.doesNotMatch(
    page,
    /\{customer\.followup \? \(\s*<span className="shrink-0 rounded-full bg-slate-100 px-2 py-0\.5 text-\[10px\] font-medium text-slate-600 border border-slate-200">\s*\{getFollowupTierLabel\(customer\.followup\.tier\)\}/
  );
});

test("avatar tier tone and non-tier badges should remain", () => {
  const page = read("app/page.tsx");
  assert.match(page, /getAvatarTone\(customer\.followup\?\.tier\)/);
  assert.match(page, /customer\.isVip \?/);
  assert.match(page, /getRelationshipBadge\(customer\.lineRelationshipStatus\)/);
});

test("tag delete flow should not wire sound or stats refresh", () => {
  const page = read("app/page.tsx");
  assert.doesNotMatch(page, /async function handleDeleteTagGlobally\(\)[\s\S]*loadCustomerStats\(/);
  assert.doesNotMatch(page, /async function handleDeleteTagGlobally\(\)[\s\S]*playDingDongSound\(/);
});

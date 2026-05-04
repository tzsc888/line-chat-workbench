-- Improve customer list cursor/order performance
CREATE INDEX IF NOT EXISTS "Customer_lastMessageAt_id_idx"
ON "Customer" ("lastMessageAt" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "Customer_pinnedAt_id_idx"
ON "Customer" ("pinnedAt" DESC, "id" DESC);

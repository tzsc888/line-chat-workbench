-- One-time data fix: clear mistaken refollow timestamps for bridge-linked customers.
-- Scope: customers where bridgeThreadId is not null.
UPDATE "Customer"
SET "lineRefollowedAt" = NULL
WHERE "bridgeThreadId" IS NOT NULL;

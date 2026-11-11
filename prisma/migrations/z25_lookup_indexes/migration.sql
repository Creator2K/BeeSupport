-- Deleting an account clears these references (ON DELETE SET NULL). Without an
-- index every such delete scans the whole table.
CREATE INDEX "Message_authorId_idx" ON "Message"("authorId");
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- Audit lists and exports filter by tenant and page by time.
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

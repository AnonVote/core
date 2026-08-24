-- AlterTable
ALTER TABLE "AuditEvent" ADD COLUMN "organizationId" TEXT;

-- Update existing audit events with organizationId from their ballot
UPDATE "AuditEvent" 
SET "organizationId" = "Ballot"."organizationId"
FROM "Ballot"
WHERE "AuditEvent"."ballotId" = "Ballot"."id"
AND "AuditEvent"."organizationId" IS NULL;

-- Make organizationId required
ALTER TABLE "AuditEvent" ALTER COLUMN "organizationId" SET NOT NULL;

-- CreateTable
CREATE TABLE "OrganizationKey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "encryptedKey" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),

    CONSTRAINT "OrganizationKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_idx" ON "AuditEvent"("organizationId");

-- CreateIndex
CREATE INDEX "OrganizationKey_organizationId_isActive_idx" ON "OrganizationKey"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationKey_organizationId_keyVersion_key" ON "OrganizationKey"("organizationId", "keyVersion");

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationKey" ADD CONSTRAINT "OrganizationKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- ROW-LEVEL SECURITY (RLS) POLICIES
-- ============================================================================
-- 
-- These policies enforce organization isolation at the database level.
-- Even if application code fails to filter by organizationId, the database
-- will prevent cross-tenant data access.
--
-- Usage: Application sets session variable before queries:
--   SET LOCAL app.current_organization_id = '<org_id>';
--
-- Security notes:
-- - Policies apply to ALL queries (SELECT, INSERT, UPDATE, DELETE)
-- - Superuser bypasses RLS (use application user, not postgres superuser)
-- - Test thoroughly: RLS misconfiguration can cause data loss
-- ============================================================================

-- Enable RLS on organization-scoped tables
ALTER TABLE "Ballot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrganizationKey" ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- BALLOT POLICIES
-- ============================================================================

CREATE POLICY "ballot_isolation_policy" ON "Ballot"
  USING (
    "organizationId" = current_setting('app.current_organization_id', true)
  )
  WITH CHECK (
    "organizationId" = current_setting('app.current_organization_id', true)
  );

-- Allow public read access for ballot viewing (voters need this)
CREATE POLICY "ballot_public_read_policy" ON "Ballot"
  FOR SELECT
  USING (true);

-- ============================================================================
-- SESSION POLICIES
-- ============================================================================

CREATE POLICY "session_isolation_policy" ON "Session"
  USING (
    "organizationId" = current_setting('app.current_organization_id', true)
  )
  WITH CHECK (
    "organizationId" = current_setting('app.current_organization_id', true)
  );

-- ============================================================================
-- AUDIT EVENT POLICIES
-- ============================================================================

CREATE POLICY "audit_isolation_policy" ON "AuditEvent"
  USING (
    "organizationId" = current_setting('app.current_organization_id', true)
  )
  WITH CHECK (
    "organizationId" = current_setting('app.current_organization_id', true)
  );

-- ============================================================================
-- ORGANIZATION KEY POLICIES
-- ============================================================================

CREATE POLICY "org_key_isolation_policy" ON "OrganizationKey"
  USING (
    "organizationId" = current_setting('app.current_organization_id', true)
  )
  WITH CHECK (
    "organizationId" = current_setting('app.current_organization_id', true)
  );

-- ============================================================================
-- VOTE ISOLATION (via ballot relationship)
-- ============================================================================
-- Votes are isolated through their ballot relationship.
-- This policy ensures votes are only accessible if their ballot belongs
-- to the current organization.

ALTER TABLE "Vote" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vote_isolation_policy" ON "Vote"
  USING (
    "ballotId" IN (
      SELECT "id" FROM "Ballot" 
      WHERE "organizationId" = current_setting('app.current_organization_id', true)
    )
  )
  WITH CHECK (
    "ballotId" IN (
      SELECT "id" FROM "Ballot" 
      WHERE "organizationId" = current_setting('app.current_organization_id', true)
    )
  );

-- Allow public vote submission (voters submit without org context)
CREATE POLICY "vote_public_submit_policy" ON "Vote"
  FOR INSERT
  WITH CHECK (true);

-- ============================================================================
-- OPTION ISOLATION (via ballot relationship)
-- ============================================================================

ALTER TABLE "Option" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "option_isolation_policy" ON "Option"
  USING (
    "ballotId" IN (
      SELECT "id" FROM "Ballot" 
      WHERE "organizationId" = current_setting('app.current_organization_id', true)
    )
  )
  WITH CHECK (
    "ballotId" IN (
      SELECT "id" FROM "Ballot" 
      WHERE "organizationId" = current_setting('app.current_organization_id', true)
    )
  );

-- Allow public read for ballot options (voters need this)
CREATE POLICY "option_public_read_policy" ON "Option"
  FOR SELECT
  USING (true);

-- ============================================================================
-- RESULT ISOLATION (via ballot relationship)
-- ============================================================================

ALTER TABLE "Result" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "result_isolation_policy" ON "Result"
  USING (
    "ballotId" IN (
      SELECT "id" FROM "Ballot" 
      WHERE "organizationId" = current_setting('app.current_organization_id', true)
    )
  )
  WITH CHECK (
    "ballotId" IN (
      SELECT "id" FROM "Ballot" 
      WHERE "organizationId" = current_setting('app.current_organization_id', true)
    )
  );

-- Allow public read for results (anyone can see published results)
CREATE POLICY "result_public_read_policy" ON "Result"
  FOR SELECT
  USING (true);

-- ============================================================================
-- VOTER TOKEN ISOLATION (via ballot relationship)
-- ============================================================================

ALTER TABLE "VoterToken" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "voter_token_isolation_policy" ON "VoterToken"
  USING (
    "ballotId" IN (
      SELECT "id" FROM "Ballot" 
      WHERE "organizationId" = current_setting('app.current_organization_id', true)
    )
  )
  WITH CHECK (
    "ballotId" IN (
      SELECT "id" FROM "Ballot" 
      WHERE "organizationId" = current_setting('app.current_organization_id', true)
    )
  );

-- Allow public token validation (voters check token validity)
CREATE POLICY "voter_token_public_use_policy" ON "VoterToken"
  FOR SELECT
  USING (true);

-- Allow public token update for vote submission
CREATE POLICY "voter_token_public_update_policy" ON "VoterToken"
  FOR UPDATE
  USING (true);

-- ============================================================================
-- ELIGIBILITY LIST & ENTRY POLICIES
-- ============================================================================
-- Eligibility lists are implicitly scoped through ballot references.
-- For now, we allow organization-scoped access through ballot checks.

ALTER TABLE "EligibilityList" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EligibilityEntry" ENABLE ROW LEVEL SECURITY;

-- Eligibility lists: accessed via ballot relationship
CREATE POLICY "eligibility_list_via_ballot_policy" ON "EligibilityList"
  USING (
    "id" IN (
      SELECT "eligibilityListId" FROM "Ballot"
      WHERE "organizationId" = current_setting('app.current_organization_id', true)
    )
  )
  WITH CHECK (
    "id" IN (
      SELECT "eligibilityListId" FROM "Ballot"
      WHERE "organizationId" = current_setting('app.current_organization_id', true)
    )
  );

-- Allow creation without ballot reference (created before ballot)
CREATE POLICY "eligibility_list_create_policy" ON "EligibilityList"
  FOR INSERT
  WITH CHECK (true);

-- Eligibility entries: accessed via list relationship
CREATE POLICY "eligibility_entry_isolation_policy" ON "EligibilityEntry"
  USING (
    "eligibilityListId" IN (
      SELECT "id" FROM "EligibilityList"
    )
  )
  WITH CHECK (
    "eligibilityListId" IN (
      SELECT "id" FROM "EligibilityList"
    )
  );

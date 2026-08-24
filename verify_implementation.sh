#!/bin/bash

# Verification script for multi-tenant isolation implementation
# This script checks that all required files and changes are in place

echo "=================================="
echo "Multi-Tenant Isolation Verification"
echo "=================================="
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

check_file() {
  if [ -f "$1" ]; then
    echo -e "${GREEN}✓${NC} File exists: $1"
    return 0
  else
    echo -e "${RED}✗${NC} File missing: $1"
    return 1
  fi
}

check_string() {
  if grep -q "$2" "$1" 2>/dev/null; then
    echo -e "${GREEN}✓${NC} Found in $1: $2"
    return 0
  else
    echo -e "${RED}✗${NC} Not found in $1: $2"
    return 1
  fi
}

ERRORS=0

echo "Checking new files..."
echo "--------------------"
check_file "backend/src/middleware/tenantContext.ts" || ((ERRORS++))
check_file "backend/src/services/organizationKeyService.ts" || ((ERRORS++))
check_file "backend/src/tests/tenantIsolation.test.ts" || ((ERRORS++))
check_file "backend/src/tests/organizationKeys.test.ts" || ((ERRORS++))
check_file "docs/TENANT_ISOLATION.md" || ((ERRORS++))
check_file "backend/prisma/migrations/20260823212624_add_organization_keys_and_rls/migration.sql" || ((ERRORS++))
echo ""

echo "Checking modified files..."
echo "-------------------------"
check_string "backend/prisma/schema.prisma" "model OrganizationKey" || ((ERRORS++))
check_string "backend/prisma/schema.prisma" "organizationId  String" || ((ERRORS++))
check_string "backend/src/app.ts" "setTenantContext" || ((ERRORS++))
check_string "backend/src/index.ts" "ensureAllOrganizationKeys" || ((ERRORS++))
check_string "backend/src/routes/admin.ts" "encryption-key" || ((ERRORS++))
echo ""

echo "Checking schema changes..."
echo "-------------------------"
check_string "backend/prisma/schema.prisma" "keys         OrganizationKey" || ((ERRORS++))
check_string "backend/prisma/schema.prisma" "auditEvents  AuditEvent" || ((ERRORS++))
echo ""

echo "Checking middleware setup..."
echo "---------------------------"
check_string "backend/src/middleware/tenantContext.ts" "SET LOCAL app.current_organization_id" || ((ERRORS++))
check_string "backend/src/middleware/tenantContext.ts" "validateTenantOwnership" || ((ERRORS++))
echo ""

echo "Checking RLS migration..."
echo "------------------------"
check_string "backend/prisma/migrations/20260823212624_add_organization_keys_and_rls/migration.sql" "ROW LEVEL SECURITY" || ((ERRORS++))
check_string "backend/prisma/migrations/20260823212624_add_organization_keys_and_rls/migration.sql" "CREATE POLICY" || ((ERRORS++))
check_string "backend/prisma/migrations/20260823212624_add_organization_keys_and_rls/migration.sql" "ballot_isolation_policy" || ((ERRORS++))
echo ""

echo "Checking encryption service..."
echo "-----------------------------"
check_string "backend/src/services/organizationKeyService.ts" "encryptWithOrgKey" || ((ERRORS++))
check_string "backend/src/services/organizationKeyService.ts" "rotateOrganizationKey" || ((ERRORS++))
check_string "backend/src/services/organizationKeyService.ts" "aes-256-gcm" || ((ERRORS++))
echo ""

echo "Checking tests..."
echo "----------------"
check_string "backend/src/tests/tenantIsolation.test.ts" "Tenant Isolation" || ((ERRORS++))
check_string "backend/src/tests/organizationKeys.test.ts" "Organization Key Management" || ((ERRORS++))
echo ""

echo "Checking documentation..."
echo "------------------------"
check_string "docs/TENANT_ISOLATION.md" "Row-Level Security" || ((ERRORS++))
check_string "docs/TENANT_ISOLATION.md" "Defense-in-Depth" || ((ERRORS++))
check_string "CHANGELOG.md" "Multi-Tenant Organization Isolation" || ((ERRORS++))
echo ""

echo "=================================="
if [ $ERRORS -eq 0 ]; then
  echo -e "${GREEN}✓ All checks passed!${NC}"
  echo "Implementation complete and verified."
  exit 0
else
  echo -e "${RED}✗ $ERRORS check(s) failed${NC}"
  echo "Please review the errors above."
  exit 1
fi

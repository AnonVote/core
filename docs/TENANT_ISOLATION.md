# Multi-Tenant Organization Isolation

## Overview

AnonVote implements comprehensive multi-tenant isolation to ensure strict organizational boundaries and prevent cross-organization data leaks. This document explains the architecture, security measures, and usage of the tenant isolation system.

## Security Architecture

### Defense-in-Depth Strategy

The system employs multiple layers of security to ensure tenant isolation:

1. **Database-Level Row-Level Security (RLS)** - PostgreSQL policies enforce isolation at the database level
2. **Application-Level Filtering** - All queries include organizationId filters
3. **Tenant Context Middleware** - Sets PostgreSQL session variables per request
4. **Per-Organization Encryption Keys** - Each organization has isolated encryption keys
5. **Audit Trail Segregation** - Audit logs are scoped and isolated by organization

### Why Defense-in-Depth?

Even if application code has a bug (e.g., forgotten `WHERE organizationId = ?` clause), the database-level RLS policies will prevent cross-tenant access. This architectural approach provides multiple failure points that must all be bypassed for a security breach to occur.

## Components

### 1. Row-Level Security (RLS) Policies

PostgreSQL RLS policies automatically filter rows based on the current tenant context:

```sql
-- Example: Ballot isolation policy
CREATE POLICY "ballot_isolation_policy" ON "Ballot"
  USING (
    "organizationId" = current_setting('app.current_organization_id', true)
  );
```

**Tables Protected by RLS:**
- `Ballot` - Organization's voting ballots
- `Session` - Authentication sessions
- `AuditEvent` - Audit trail events
- `OrganizationKey` - Encryption keys
- `Vote` - Votes (isolated via ballot relationship)
- `Option` - Ballot options (isolated via ballot relationship)
- `Result` - Ballot results (isolated via ballot relationship)
- `VoterToken` - Voter tokens (isolated via ballot relationship)
- `EligibilityList` - Voter eligibility lists
- `EligibilityEntry` - Individual eligibility entries

### 2. Tenant Context Middleware

Located in `backend/src/middleware/tenantContext.ts`, this middleware:

- Runs after authentication middleware
- Extracts `organizationId` from authenticated session
- Sets PostgreSQL session variable: `SET LOCAL app.current_organization_id = '<org_id>'`
- Stores `organizationId` in request object for application use

**Usage in app.ts:**
```typescript
app.use(cookieParser());
app.use(setTenantContext); // Must run after cookieParser
```

**Security Note:** The middleware uses `SET LOCAL` which scopes the variable to the current transaction, preventing context bleed between requests.

### 3. Per-Organization Encryption Keys

Each organization has its own encryption key for vote data:

**Architecture:**
- Master key (from `BALLOT_ENCRYPTION_KEY` env var) wraps organization keys
- Organization keys stored encrypted in `OrganizationKey` table
- Key versioning supports rotation without data loss
- Historical keys preserved for decrypting old votes
- HKDF used for fast, secure key derivation from master key

**Key Format:**
```
Encrypted Key: salt:iv:authTag:ciphertext (all hex)
Vote Ciphertext: iv:authTag:encryptedData (all hex)
```

**Key Operations:**
```typescript
import {
  createOrganizationKey,
  getOrganizationKey,
  rotateOrganizationKey,
  encryptWithOrgKey,
  decryptWithOrgKey,
} from './services/organizationKeyService';

// Create initial key
await createOrganizationKey(organizationId);

// Encrypt vote data
const encrypted = await encryptWithOrgKey(organizationId, voteData);

// Decrypt vote data
const plaintext = await decryptWithOrgKey(organizationId, encrypted);

// Rotate key (creates new version, deactivates old)
await rotateOrganizationKey(organizationId);
```

### 4. Audit Trail Segregation

Audit events include `organizationId` and are protected by RLS:

```typescript
// Audit events automatically scoped by organization
await prisma.auditEvent.create({
  data: {
    ballotId,
    organizationId, // Required field
    eventType: 'VOTE_CAST',
  },
});
```

Organizations can only view their own audit logs, ensuring compliance with data isolation requirements.

## API Endpoints

### Encryption Key Management

**Create Organization Key:**
```http
POST /api/admin/organizations/:id/encryption-key
Authorization: Cookie (session)

Response: 201 Created
{
  "message": "Encryption key created successfully",
  "data": { "organizationId": "..." }
}
```

**Rotate Encryption Key:**
```http
POST /api/admin/organizations/:id/rotate-keys
Authorization: Cookie (session)

Response: 200 OK
{
  "message": "Encryption key rotated successfully",
  "data": { "organizationId": "..." }
}
```

**List Encryption Keys:**
```http
GET /api/admin/organizations/:id/encryption-keys
Authorization: Cookie (session)

Response: 200 OK
{
  "data": [
    {
      "id": "...",
      "keyVersion": 2,
      "isActive": true,
      "createdAt": "...",
      "rotatedAt": null
    },
    {
      "id": "...",
      "keyVersion": 1,
      "isActive": false,
      "createdAt": "...",
      "rotatedAt": "..."
    }
  ]
}
```

**Security Note:** Organizations can only manage their own keys. Attempting to access another organization's keys returns `400 Bad Request`.

## Testing

### Test Suite Location
- `backend/src/tests/tenantIsolation.test.ts` - Comprehensive isolation tests
- `backend/src/tests/organizationKeys.test.ts` - Encryption key tests

### Test Coverage

**Tenant Isolation Tests:**
- ✅ Cross-organization ballot access prevention
- ✅ Cross-organization voter list access prevention
- ✅ Cross-organization audit log isolation
- ✅ RLS enforcement with direct SQL queries
- ✅ Session isolation
- ✅ Defense-in-depth verification (app + DB layers)
- ✅ Cross-organization join prevention

**Encryption Key Tests:**
- ✅ Key generation and storage
- ✅ Key rotation with versioning
- ✅ Encryption/decryption correctness
- ✅ Key isolation between organizations
- ✅ Master key wrapping
- ✅ IV randomization
- ✅ Authentication tag verification
- ✅ Error handling for corrupted data

### Running Tests

```bash
cd backend
npm test -- tenantIsolation
npm test -- organizationKeys
```

## Migration

### Database Migration

Migration file: `backend/prisma/migrations/20260823212624_add_organization_keys_and_rls/migration.sql`

This migration:
1. Adds `organizationId` to `AuditEvent` table
2. Creates `OrganizationKey` table
3. Enables RLS on all organization-scoped tables
4. Creates RLS policies for tenant isolation
5. Adds public read policies where needed (for voter access)

**Running Migration:**
```bash
cd backend
npx prisma migrate deploy
```

### Data Migration

Existing organizations need encryption keys:

```typescript
import { ensureAllOrganizationKeys } from './services/organizationKeyService';

// Run once during deployment
await ensureAllOrganizationKeys();
```

This is automatically called on server startup in `backend/src/index.ts`.

## Security Best Practices

### For Developers

1. **Always filter by organizationId** - Even though RLS provides protection, include `organizationId` in WHERE clauses
2. **Validate ownership** - Before operations, verify the resource belongs to the authenticated organization
3. **Use tenant context helper** - Import `validateTenantOwnership` from `middleware/tenantContext.ts`
4. **Test isolation** - Add tests for any new multi-tenant features
5. **Review joins** - Ensure joins don't accidentally cross organizational boundaries

**Example:**
```typescript
import { validateTenantOwnership } from '../middleware/tenantContext';

// Validate ballot ownership before deletion
const ballot = await prisma.ballot.findUnique({
  where: { id: ballotId },
});

if (!ballot) {
  throw notFound('Ballot not found');
}

validateTenantOwnership(
  ballot.organizationId,
  req.organization!.id,
  'ballot'
);

// Proceed with deletion
await prisma.ballot.delete({ where: { id: ballotId } });
```

### For Operations

1. **Database user permissions** - Application should NOT use PostgreSQL superuser (superuser bypasses RLS)
2. **Environment security** - Protect `BALLOT_ENCRYPTION_KEY` env var (master key)
3. **Key rotation schedule** - Rotate organization keys periodically (recommend annually)
4. **Backup encryption** - Ensure database backups are encrypted at rest
5. **Audit review** - Regularly review audit logs for anomalies
6. **Monitor RLS** - Ensure RLS is enabled: `SELECT * FROM pg_tables WHERE tablename = 'Ballot' AND rowsecurity = true;`

### Incident Response

If a cross-tenant data leak is suspected:

1. **Immediately investigate** - Check audit logs for unauthorized access
2. **Review RLS policies** - Verify policies are active: `\d+ tablename` in psql
3. **Check application logs** - Look for `[TenantContext]` errors
4. **Rotate affected keys** - Use `/api/admin/organizations/:id/rotate-keys`
5. **Notify affected organizations** - If confirmed breach
6. **Perform security audit** - Review all tenant isolation code paths

## Compliance

This implementation supports compliance with:

- **GDPR** - Organizational data boundaries, audit trails, encryption
- **HIPAA** - Audit logging, encryption, access controls
- **SOC 2** - Data segregation, encryption, audit trails
- **ISO 27001** - Information security controls, data protection

### Data Residency

Current implementation stores all data in single PostgreSQL instance. For geographic data residency requirements:

1. Deploy separate instances per region
2. Route organizations to appropriate region
3. Use DNS/load balancer for routing
4. Maintain separate `DATABASE_URL` per region

## Limitations

1. **Public Vote Submission** - Voters can submit votes without tenant context (by design, for anonymity)
2. **Public Ballot Read** - Ballots are readable by anyone with ballot ID (for voter access)
3. **Single Database** - All organizations in same PostgreSQL instance (mitigated by RLS)
4. **Master Key** - Single master key encrypts all org keys (key compromise affects all orgs)

## Future Enhancements

Potential improvements:

- [ ] Hardware Security Module (HSM) for master key storage
- [ ] Per-region deployment for data residency
- [ ] Automated key rotation schedule
- [ ] Real-time cross-tenant access alerts
- [ ] Column-level encryption for additional PII fields
- [ ] Tenant-specific database schemas (full logical separation)

## Troubleshooting

### RLS Blocking Legitimate Access

**Symptom:** Queries return empty results or permission denied errors.

**Cause:** Tenant context not set properly.

**Solution:**
1. Verify middleware order in `app.ts` (setTenantContext after cookieParser)
2. Check authentication is working (req.organization populated)
3. Review application logs for `[TenantContext]` errors

### Key Decryption Failures

**Symptom:** "Invalid ciphertext format" or authentication errors.

**Cause:** Wrong organization key or corrupted data.

**Solution:**
1. Verify `organizationId` matches original encryption
2. Check `BALLOT_ENCRYPTION_KEY` hasn't changed
3. Review key rotation timing (ensure historical keys available)

### Test Failures

**Symptom:** Isolation tests failing.

**Solution:**
1. Ensure test database has RLS enabled
2. Verify migrations ran successfully: `npx prisma migrate status`
3. Check test database user is not superuser
4. Clear test data: `npx prisma migrate reset` (caution: deletes all data)

## References

- [PostgreSQL Row-Level Security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Prisma Middleware](https://www.prisma.io/docs/concepts/components/prisma-client/middleware)
- [Node.js Crypto Module](https://nodejs.org/api/crypto.html)
- [NIST Encryption Standards](https://csrc.nist.gov/projects/cryptographic-standards-and-guidelines)

---

**Last Updated:** 2026-08-23  
**Security Review Required:** Annually or after significant changes

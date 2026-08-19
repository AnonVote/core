# Issue: Replace hardcoded CORS origin with environment variable

## Status

**ALREADY IMPLEMENTED** ✓

This issue has already been completed. The CORS origin is correctly configured as an environment variable.

## Implementation Details

- Environment variable: `FRONTEND_ORIGIN`
- Location: `core/backend/src/config.ts` (line 54)
- Default fallback: `http://localhost:5173` (development URL)
- Usage: `core/backend/src/app.ts` (lines 20-25)

## Code Reference

```typescript
// config.ts
export const config = {
  frontendOrigin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
  // ... other config
};

// app.ts
app.use(
  cors({
    origin: config.frontendOrigin,
    credentials: true,
  }),
);
```

## Environment Configuration

The CORS origin can be set via:

```bash
export FRONTEND_ORIGIN=https://your-frontend.com
```

## Verification

To verify this is working correctly:

1. Set `FRONTEND_ORIGIN` environment variable
2. Restart backend service
3. CORS requests from that origin should be allowed
4. Requests from other origins should be blocked

## Related Documentation

- See `core/backend/.env.example` for environment setup

## Note for Contributors

This issue is already complete. The CORS origin is correctly configured using the `FRONTEND_ORIGIN` environment variable with a sensible localhost default. No implementation work required. Use this as a reference when implementing similar environment-based configurations in other parts of the codebase.

# Issue: Add request logging middleware with no PII leakage

## Summary

The core backend application lacks centralized request logging middleware. While an error handler middleware exists, there is no comprehensive HTTP request logging for debugging, monitoring, and audit purposes. A production-grade logging middleware must be implemented with strict PII (Personally Identifiable Information) filtering to prevent sensitive data from being logged. All requests and responses must be logged with request IDs for correlation, performance metrics, and error tracing without exposing user data, tokens, or sensitive information.

## Background

The `core/backend` Express application handles authentication, voting, ballot management, and administrative operations. Currently:

- No centralized request logging exists
- Silent error handlers (`.catch(() => {})`) suppress errors across multiple files
- Difficult to debug production issues without request context
- No audit trail of API access patterns
- Cannot correlate errors with specific requests
- No performance metrics on endpoints

Critical files with silent error handlers:

- `src/engine/privacyEngine.ts` (line 71)
- `src/engine/ballotEngine.ts` (lines 447-448)
- `src/routes/votes.ts` (line 60)
- `src/worker/stellarRetryWorker.ts` (lines 25, 86, 91)
- `src/service/identityManager.ts` (lines 143-144, 151)

## Scope

### Request Logging Middleware

- Create centralized request/response logging middleware
- Capture request method, path, query parameters (PII-redacted)
- Generate unique request ID for tracing
- Record response status code and response time
- Use structured logging format (JSON)

### PII Filtering and Redaction

Do NOT log:

- Authorization headers, Bearer tokens, API keys
- User email addresses or phone numbers from query/body
- User authentication credentials or session tokens
- Vote data or ballot contents from request bodies
- Personally identifiable information from any field
- Sensitive headers (Cookie, X-API-Key, etc.)

DO log:

- Request method (GET, POST, PUT, DELETE, PATCH)
- Request path (with PII-sensitive query params redacted)
- Query parameter names only (not values if sensitive)
- Response status code (200, 404, 500, etc.)
- Response time / duration in milliseconds
- Request ID for correlation
- User ID if authenticated (anonymized/hashed)
- Endpoint name or route pattern

### Implementation Strategy

- Add request logging middleware early in app setup (before other middleware)
- Use Winston or Pino for structured logging
- Create custom sanitizer/redactor for PII fields
- Add request ID generation via UUID or similar
- Correlate subsequent logs with request ID
- Store logs in JSON format for aggregation/analysis

### Configuration

- Logging level configurable (DEBUG, INFO, WARN, ERROR)
- Option to send logs to external service (Sentry, DataDog, etc.)
- Performance: logging should not significantly impact request time
- Skip logging for health check endpoints (optional)

## Files Involved

- `core/backend/src/middleware/requestLogger.ts` (to be created)
- `core/backend/src/app.ts` (register middleware early)
- `core/backend/src/config.ts` (add logging configuration)
- `core/backend/src/utils/sanitizer.ts` (PII redaction helpers)

## Implementation Details

### Request Logger Middleware

```typescript
// middleware/requestLogger.ts
import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  req.id = uuidv4();
  req.startTime = Date.now();

  const sanitizedPath = sanitizePath(req.path, req.query);
  const sanitizedHeaders = sanitizeHeaders(req.headers);

  res.on("finish", () => {
    const duration = Date.now() - req.startTime;
    const logEntry = {
      timestamp: new Date().toISOString(),
      requestId: req.id,
      method: req.method,
      path: sanitizedPath,
      statusCode: res.statusCode,
      duration: duration,
      userAgent: req.get("user-agent"),
    };

    console.log(JSON.stringify(logEntry));
    // Send to external service if configured
  });

  next();
}
```

### PII Redaction Examples

```typescript
// Redact email from query: ?email=user@example.com → ?email=REDACTED
// Redact token from body: { token: "abc123" } → { token: "REDACTED" }
// Skip logging: Authorization: Bearer token → Authorization: REDACTED
```

## Testing

- Request logging captures method, path, status, duration
- Sensitive fields are redacted (email, tokens, passwords)
- Request ID is generated and consistent
- All requests are logged (success and error responses)
- Logging does not impact request performance significantly
- Logs are valid JSON and parseable

## Relevant Files

- `core/backend/src/middleware/requestLogger.ts` (to create)
- `core/backend/src/app.ts` (register middleware)
- `core/backend/src/config.ts` (configuration)
- `core/backend/.env.example` (logging env vars)

## Acceptance Criteria

- Request logging middleware created
- All HTTP requests logged (method, path, status, duration)
- Sensitive fields redacted (tokens, emails, passwords)
- Request IDs generated and unique
- Structured JSON logging format
- Logs correlate with error traces
- No authentication required for logging
- Silent `.catch()` handlers replaced with error logging
- Zero PII in logs
- Logging configurable via environment
- Performance impact < 5ms per request
- No compilation warnings
- Unit tests pass for sanitization

## Out of Scope

- Sending logs to external services (may add later)
- Log aggregation/analysis dashboards
- Real-time log streaming
- Metrics collection (separate concern)
- Request body logging (security risk)

## Security Considerations

- Never log Authorization headers or tokens
- Redact email addresses from query parameters
- Redact vote contents from request bodies
- Consider GDPR/privacy regulations when logging user data
- Use structured logging with clear field names
- Ensure logs are not exposed publicly

## Note for Contributors

This is a middleware implementation task requiring production-grade logging. Create a request logging middleware that captures HTTP metadata (method, path, status, duration) while strictly filtering PII (tokens, emails, passwords, vote data). Use Winston or Pino for structured JSON logging. Generate unique request IDs via UUID for correlation. Also identify and replace all silent `.catch(() => {})` error handlers across the codebase with proper error logging. Register the middleware early in app setup before auth middleware. This is a larger task requiring careful attention to security — plan for 3-4 hours including testing and documentation.

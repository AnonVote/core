# Issue: Add database connection health check endpoint at GET /api/health

## Description

The core backend application lacks a health check endpoint. Production deployments require a `/api/health` or `/health` endpoint to verify that the application and its critical dependencies (especially the database) are operational. This endpoint is essential for load balancers, Kubernetes readiness probes, and monitoring systems.

## Problem

- Load balancers cannot determine if an instance is healthy
- Kubernetes cannot run readiness/liveness probes
- Monitoring systems have no standard way to check application status
- Deployments cannot gracefully handle unhealthy instances
- No visibility into database connectivity issues

## Requirements

The health check endpoint should:

1. **Database Connectivity** - Attempt a simple query to verify database is responsive
2. **Response Status** - Return HTTP 200 if healthy, 503 if unhealthy
3. **Response Format** - Return JSON with structured health status
4. **Performance** - Execute quickly (< 100ms typically)
5. **No Authentication** - Should be accessible without credentials for monitoring systems

## Expected Response (Healthy)

```json
{
  "status": "ok",
  "timestamp": "2026-08-19T12:34:56Z",
  "uptime": 3600,
  "database": "ok",
  "checks": {
    "database": {
      "status": "ok",
      "responseTime": "5ms"
    }
  }
}
```

## Expected Response (Unhealthy)

```json
{
  "status": "error",
  "timestamp": "2026-08-19T12:34:56Z",
  "uptime": 3600,
  "database": "error",
  "checks": {
    "database": {
      "status": "error",
      "error": "Connection timeout",
      "responseTime": "1000ms"
    }
  }
}
```

## Solution

Create a health check endpoint that:

1. Pings the database with a simple query: `SELECT 1`
2. Records response time
3. Returns appropriate HTTP status and response body
4. Handles connection errors gracefully
5. Logs health check failures

## Files Involved

- `core/backend/src/routes/health.ts` (new file)
- `core/backend/src/app.ts` - Register route
- `core/backend/src/middleware/` - May need to exempt from auth middleware

## Implementation Considerations

- Should not require authentication
- Should be fast and not use resources
- Consider adding optional extended health checks (Redis, external services)
- May need to skip logging middleware for frequent health check requests

## Priority

High - Essential for production deployments

## Usage Examples

```bash
# Check if app is healthy
curl http://localhost:3000/api/health

# Kubernetes liveness probe
curl -f http://localhost:3000/api/health || exit 1

# Load balancer health check endpoint
GET /api/health HTTP/1.1
Host: api.example.com
```

## Note for Contributors

This is an endpoint implementation task. Create a new `GET /api/health` endpoint that checks database connectivity by executing a simple query (SELECT 1). Return HTTP 200 with JSON response when healthy, HTTP 503 when database unavailable. Include response time measurements and structured status information. Register the route before authentication middleware so it's publicly accessible to monitoring systems. This is straightforward but important for production operations — plan for 1-2 hours including tests and verification.

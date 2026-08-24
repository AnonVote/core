import { Request, Response, NextFunction } from "express";
import { prisma } from "../prisma/client";

/**
 * Tenant Context Middleware
 * 
 * Sets PostgreSQL session variable for Row-Level Security (RLS).
 * This provides defense-in-depth: even if application code forgets
 * to filter by organizationId, the database will enforce isolation.
 * 
 * SECURITY: This must run AFTER requireAuth middleware to ensure
 * req.organization is populated.
 */
export async function setTenantContext(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Only set context if organization is authenticated
    if (req.organization?.id) {
      // Set PostgreSQL session variable for RLS
      await prisma.$executeRawUnsafe(
        `SET LOCAL app.current_organization_id = '${req.organization.id}';`
      );
      
      // Store in request for application-level checks (defense-in-depth)
      req.organizationId = req.organization.id;
    }
    
    next();
  } catch (err) {
    console.error("[TenantContext] Failed to set tenant context:", err);
    // Fail securely: if we can't set tenant context, reject the request
    res.status(500).json({ 
      error: "Internal Server Error",
      message: "Failed to establish tenant context" 
    });
  }
}

/**
 * Validates that a resource belongs to the current tenant.
 * Use this for additional validation before operations.
 */
export function validateTenantOwnership(
  resourceOrgId: string,
  currentOrgId: string,
  resourceType: string = "resource"
): void {
  if (resourceOrgId !== currentOrgId) {
    throw new Error(
      `Cross-tenant access denied: ${resourceType} belongs to different organization`
    );
  }
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      organizationId?: string;
    }
  }
}

/**
 * Lightweight validation middleware factory.
 *
 * Usage:
 *   router.post("/", validate(mySchema), handler)
 *
 * A schema is a plain object whose keys match request body fields.
 * Each value is a FieldRule describing how to validate that field.
 */
import { Request, Response, NextFunction } from "express";

export interface FieldRule {
  /** Field must be present and non-empty */
  required?: boolean;
  /** Expected JS typeof */
  type?: "string" | "number" | "boolean" | "array";
  /** Minimum string length / numeric value / array length */
  min?: number;
  /** Maximum string length / numeric value / array length */
  max?: number;
  /** Regex pattern (strings only) */
  pattern?: RegExp;
  /** Human-readable description used in the error message */
  label?: string;
  /** Custom validator — return an error string, or null if valid */
  custom?: (value: unknown) => string | null;
}

export type ValidationSchema = Record<string, FieldRule>;

interface ValidationError {
  field: string;
  message: string;
}

function validateField(
  field: string,
  value: unknown,
  rule: FieldRule,
): string | null {
  const label = rule.label ?? field;

  // Required check
  if (rule.required) {
    if (value === undefined || value === null || value === "") {
      return `${label} is required`;
    }
    if (rule.type === "array" && Array.isArray(value) && value.length === 0) {
      return `${label} must not be empty`;
    }
  }

  // If not required and absent, skip remaining checks
  if (value === undefined || value === null) return null;

  // Type check
  if (rule.type) {
    if (rule.type === "array") {
      if (!Array.isArray(value)) return `${label} must be an array`;
    } else if (typeof value !== rule.type) {
      return `${label} must be a ${rule.type}`;
    }
  }

  // String-specific checks
  if (typeof value === "string") {
    if (rule.min !== undefined && value.trim().length < rule.min) {
      return `${label} must be at least ${rule.min} character(s)`;
    }
    if (rule.max !== undefined && value.trim().length > rule.max) {
      return `${label} must be at most ${rule.max} characters`;
    }
    if (rule.pattern && !rule.pattern.test(value)) {
      return `${label} has an invalid format`;
    }
  }

  // Number-specific checks
  if (typeof value === "number") {
    if (rule.min !== undefined && value < rule.min) {
      return `${label} must be at least ${rule.min}`;
    }
    if (rule.max !== undefined && value > rule.max) {
      return `${label} must be at most ${rule.max}`;
    }
  }

  // Array-specific checks
  if (Array.isArray(value)) {
    if (rule.min !== undefined && value.length < rule.min) {
      return `${label} must contain at least ${rule.min} item(s)`;
    }
    if (rule.max !== undefined && value.length > rule.max) {
      return `${label} must contain at most ${rule.max} items`;
    }
  }

  // Custom validator
  if (rule.custom) {
    return rule.custom(value);
  }

  return null;
}

/**
 * Returns a validation middleware for the given schema.
 * On any validation failure it responds immediately with:
 *   { error: "ValidationError", message: "...", fields: [...] }
 */
export function validate(schema: ValidationSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors: ValidationError[] = [];

    for (const [field, rule] of Object.entries(schema)) {
      const value = (req.body as Record<string, unknown>)[field];
      const message = validateField(field, value, rule);
      if (message) {
        errors.push({ field, message });
      }
    }

    if (errors.length > 0) {
      // Use the first error message as the top-level message for compatibility
      // with existing tests that check res.body.message
      res.status(400).json({
        error: "ValidationError",
        message: errors[0].message,
        fields: errors,
      });
      return;
    }

    next();
  };
}

import { createHash } from "crypto";
import type { IncomingHttpHeaders } from "http";
import type { ParsedQs } from "qs";

export const REDACTED = "[REDACTED]";

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
  "x-api-secret",
  "x-auth-token",
  "x-access-token",
  "x-session-token",
  "x-csrf-token",
  "csrf-token",
  "x-real-ip",
  "x-forwarded-for",
]);

const SENSITIVE_QUERY_KEYS = new Set([
  "email",
  "e-mail",
  "mail",
  "emailaddress",
  "phone",
  "phone_number",
  "phonenumber",
  "mobile",
  "token",
  "votertoken",
  "voter_token",
  "access_token",
  "access-token",
  "refresh_token",
  "refresh-token",
  "id_token",
  "api_key",
  "api-key",
  "apikey",
  "password",
  "passwd",
  "secret",
  "key",
  "credential",
  "session",
  "sessiontoken",
  "session_token",
  "auth",
  "jwt",
  "identifier",
  "voteridentifier",
  "voter_identifier",
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function isEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}

export function redactValue(value: string): string {
  if (EMAIL_RE.test(value) || JWT_RE.test(value)) {
    return REDACTED;
  }
  return value;
}

export function sanitizeQuery(query: ParsedQs): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }

    const lowerKey = key.toLowerCase();
    const values = Array.isArray(value) ? value : [value];
    const sanitized = values.map((entry) => {
      if (typeof entry !== "string") {
        return REDACTED;
      }
      if (SENSITIVE_QUERY_KEYS.has(lowerKey)) {
        return REDACTED;
      }
      return redactValue(entry);
    });

    result[key] =
      sanitized.length === 1 ? sanitized[0] : JSON.stringify(sanitized);
  }

  return result;
}

export function sanitizeHeaders(
  headers: IncomingHttpHeaders,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }

    const lowerName = name.toLowerCase();
    const raw = Array.isArray(value) ? value.join(", ") : String(value);
    result[lowerName] = SENSITIVE_HEADER_NAMES.has(lowerName)
      ? REDACTED
      : redactValue(raw);
  }

  return result;
}

export function sanitizePath(
  path: string,
  query: Record<string, string>,
): string {
  const entries = Object.entries(query);
  if (entries.length === 0) {
    return path;
  }

  const queryString = entries
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join("&");

  return `${path}?${queryString}`;
}

export function anonymize(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

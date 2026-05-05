/**
 * Runtime rate limit configuration.
 * Stored in memory — resets on server restart.
 * Can be updated via the admin API without restarting.
 */

export type RateLimitPreset = "off" | "relaxed" | "standard" | "strict";

export interface RateLimitSettings {
  preset: RateLimitPreset;
  maxAttempts: number; // max failed attempts
  windowMinutes: number; // rolling window in minutes
}

export const PRESETS: Record<RateLimitPreset, RateLimitSettings> = {
  off: {
    preset: "off",
    maxAttempts: 10000,
    windowMinutes: 1,
  },
  relaxed: {
    preset: "relaxed",
    maxAttempts: 20,
    windowMinutes: 15,
  },
  standard: {
    preset: "standard",
    maxAttempts: 10,
    windowMinutes: 15,
  },
  strict: {
    preset: "strict",
    maxAttempts: 5,
    windowMinutes: 30,
  },
};

// Active settings — default to standard
let current: RateLimitSettings = { ...PRESETS.standard };

export function getRateLimitSettings(): RateLimitSettings {
  return current;
}

export function setRateLimitSettings(
  preset: RateLimitPreset,
): RateLimitSettings {
  current = { ...PRESETS[preset] };
  console.log(`[RateLimit] Updated to preset "${preset}":`, current);
  return current;
}

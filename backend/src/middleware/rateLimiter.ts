import rateLimit from "express-rate-limit";
import { getRateLimitSettings } from "../config/rateLimitConfig";

export const rateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  skipSuccessfulRequests: false,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: "TooManyRequests",
      message: "Too many requests, please try again later",
    });
  },
});

// Dynamic strict limiter — reads config at request time
export const strictRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // max window, overridden dynamically below
  max: (req, _res) => {
    // Read live config on every request
    const settings = getRateLimitSettings();
    // Attach window to request for use in windowMs
    (req as any).__rateLimitWindow = settings.windowMinutes * 60 * 1000;
    return settings.maxAttempts;
  },
  // express-rate-limit doesn't support dynamic windowMs natively,
  // so we use the max window and rely on maxAttempts being the main control
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    const settings = getRateLimitSettings();
    res.status(429).json({
      error: "TooManyRequests",
      message: `Too many attempts. Please wait ${settings.windowMinutes} minutes before trying again.`,
    });
  },
});

import rateLimit from "express-rate-limit";

export const rateLimiter = rateLimit({
  windowMs: 60 * 1000, // 60 seconds
  max: 10,
  skipSuccessfulRequests: false,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: "TooManyRequests",
      message: "Too many attempts, please try again later",
    });
  },
});

// Stricter limiter for sensitive endpoints (token requests, vote submission)
export const strictRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  skipSuccessfulRequests: false,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: "TooManyRequests",
      message: "Too many attempts. Access blocked for 5 minutes.",
    });
  },
  skipFailedRequests: false,
});

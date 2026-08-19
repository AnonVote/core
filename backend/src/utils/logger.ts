import { config } from "../config";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const VALID_LEVELS = new Set(Object.keys(LEVEL_ORDER));

function resolveLevel(): LogLevel {
  const value = String(config.logLevel || "info").toLowerCase();
  return VALID_LEVELS.has(value) ? (value as LogLevel) : "info";
}

function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return { message: value.message, stack: value.stack };
  }
  return value;
}

function emit(
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>,
): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[resolveLevel()]) {
    return;
  }

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };

  const line = JSON.stringify(entry, replacer);

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) =>
    emit("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) =>
    emit("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) =>
    emit("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) =>
    emit("error", message, meta),
};

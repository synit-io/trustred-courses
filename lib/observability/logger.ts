export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const configuredLevel = (Deno.env.get("LOG_LEVEL") ?? "info")
  .trim()
  .toLowerCase();
const activeLevel: LogLevel = (configuredLevel === "debug" ||
    configuredLevel === "info" ||
    configuredLevel === "warn" ||
    configuredLevel === "error")
  ? configuredLevel
  : "info";

const format = (Deno.env.get("LOG_FORMAT") ?? "json").trim().toLowerCase();
const useJson = format !== "pretty";

export interface RequestTraceContext {
  traceId?: string;
  spanId?: string;
  requestId?: string;
}

export function extractRequestTraceContext(
  headers: Headers,
): RequestTraceContext {
  const traceparent = headers.get("traceparent") ?? undefined;
  let traceId: string | undefined;
  let spanId: string | undefined;

  if (traceparent) {
    const parts = traceparent.split("-");
    if (parts.length >= 4) {
      traceId = parts[1];
      spanId = parts[2];
    }
  }

  const requestId = headers.get("x-request-id") ??
    headers.get("cf-ray") ??
    headers.get("fly-request-id") ??
    undefined;

  return {
    traceId,
    spanId,
    requestId,
  };
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[activeLevel];
}

function serializeError(value: unknown): Record<string, unknown> | unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  return value;
}

function emit(
  level: LogLevel,
  message: string,
  fields: Record<string, unknown> = {},
): void {
  if (!shouldLog(level)) return;

  const normalizedFields = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, serializeError(value)]),
  );

  if (useJson) {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level,
        message,
        ...normalizedFields,
      }),
    );
    return;
  }

  const suffix = Object.keys(normalizedFields).length > 0
    ? ` ${JSON.stringify(normalizedFields)}`
    : "";
  console.log(
    `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}${suffix}`,
  );
}

export const logger = {
  debug(message: string, fields: Record<string, unknown> = {}) {
    emit("debug", message, fields);
  },
  info(message: string, fields: Record<string, unknown> = {}) {
    emit("info", message, fields);
  },
  warn(message: string, fields: Record<string, unknown> = {}) {
    emit("warn", message, fields);
  },
  error(message: string, fields: Record<string, unknown> = {}) {
    emit("error", message, fields);
  },
};

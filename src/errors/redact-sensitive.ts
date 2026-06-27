export function redactSensitive(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g, "Bearer [REDACTED]")
    .replace(/sk-[A-Za-z0-9._-]+/g, "sk-[REDACTED]")
    .replace(
      /(authorization["'\s:=]+)(?!Bearer\b|\[REDACTED\])[^"',\s}]+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /(api[_-]?key["'\s:=]+)(?!sk-\[REDACTED\]|\[REDACTED\])[^"',\s}]+/gi,
      "$1[REDACTED]",
    );
}

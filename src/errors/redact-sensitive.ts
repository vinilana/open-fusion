const DEFAULT_REDACTION_KEYS = ["authorization", "apiKey", "api_key", "token"];

export function redactSensitive(
  value: string,
  keys: string[] = DEFAULT_REDACTION_KEYS,
): string {
  return expandRedactionKeys(keys).reduce(
    (redacted, key) => redactKeyValue(redacted, key),
    value
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g, "Bearer [REDACTED]")
      .replace(/sk-[A-Za-z0-9._-]+/g, "sk-[REDACTED]"),
  );
}

function expandRedactionKeys(keys: string[]): string[] {
  const expanded = new Set<string>();

  keys.forEach((key) => {
    if (key === "") {
      return;
    }
    expanded.add(key);
    if (!key.toLowerCase().endsWith("env")) {
      expanded.add(`${key}Env`);
    }
  });

  return [...expanded];
}

function redactKeyValue(value: string, key: string): string {
  const escapedKey = escapeRegExp(key);
  return value.replace(
    new RegExp(
      `(${escapedKey}["'\\s:=]+)(?!Bearer\\b|sk-\\[REDACTED\\]|\\[REDACTED\\])[^"',\\s}]+`,
      "gi",
    ),
    "$1[REDACTED]",
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

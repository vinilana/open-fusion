export const CANONICAL_ROUTING_CAPABILITIES = [
  "plan",
  "code",
  "review",
  "design",
  "general",
] as const;

export type CanonicalRoutingCapability =
  (typeof CANONICAL_ROUTING_CAPABILITIES)[number];

export const SPECIALIZED_ROUTING_CAPABILITY_PRIORITY = [
  "code",
  "review",
  "design",
  "plan",
] as const satisfies ReadonlyArray<
  Exclude<CanonicalRoutingCapability, "general">
>;

export function isCanonicalRoutingCapability(
  capability: string,
): capability is CanonicalRoutingCapability {
  return CANONICAL_ROUTING_CAPABILITIES.includes(
    capability as CanonicalRoutingCapability,
  );
}

export function hasCanonicalRoutingCapability(capabilities: string[]): boolean {
  return capabilities.some((capability) =>
    isCanonicalRoutingCapability(capability),
  );
}

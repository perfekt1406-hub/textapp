/**
 * @fileoverview Shared UDP discovery wire constants for Textr LAN signaling.
 * @module @textr/signaling/discovery-protocol
 */

/** UDP port for discovery (HTTP signaling uses PORT, default 8787). */
export const DEFAULT_DISCOVERY_PORT = 8788;

/** Client probe; must match exactly including newline for v1. */
export const TEXTR_DISCOVER_V1 = "TEXTR_DISCOVER_V1\n";

/** Prefix of host reply before JSON metadata line. */
export const TEXTR_SIGNALING_V1_PREFIX = "TEXTR_SIGNALING_V1\n";

/** JSON shape after the prefix (HTTP port only; IP comes from UDP rinfo). */
export type DiscoveryReplyMeta = {
  httpPort: number;
};

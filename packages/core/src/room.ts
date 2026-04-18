/**
 * @fileoverview Room code validation helpers: exactly five decimal digits (00000–99999).
 * Used by signaling and clients for consistent LAN-oriented room identity.
 * @module @textapp/core/room
 */

/**
 * Returns true if the string is exactly five ASCII digits (0–9).
 *
 * @param room - Candidate room code from user input or API.
 */
export function isValidRoomCode(room: string): boolean {
  return /^\d{5}$/.test(room);
}

/**
 * Normalizes user input by trimming whitespace. Does not validate length.
 *
 * @param input - Raw line from terminal or form.
 */
export function normalizeRoomInput(input: string): string {
  return input.trim();
}

/**
 * Validates normalized room input; returns the code or an error message.
 *
 * @param normalized - Trimmed room string.
 * @returns The same string if valid, or an Error with a human-readable reason.
 */
export function parseRoomCodeOrError(normalized: string): string | Error {
  if (!isValidRoomCode(normalized)) {
    return new Error("Room code must be exactly 5 digits (0-9), e.g. 00420.");
  }
  return normalized;
}

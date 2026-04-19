/**
 * @fileoverview HTML escaping helpers for inserting user and peer-generated text into the DOM.
 * @module apps/web/lib/escape-html
 */

/**
 * Escapes a string so it is safe to embed in HTML text positions (not inside raw attributes
 * with untrusted quote contexts — use for `textContent` / template text nodes only).
 *
 * @param text - Raw user or wire payload string.
 * @returns Escaped string for use with `innerHTML` fragments composed only of trusted markup.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

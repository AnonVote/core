/**
 * Helper utility functions.
 */

/**
 * Converts a Uint8Array byte array to an RFC 4648 URL-safe base64 string without padding.
 *
 * Replaces `+` with `-`, `/` with `_`, and strips trailing `=` padding characters.
 *
 * @param bytes - The byte array to encode
 * @returns RFC 4648 URL-safe base64 string without padding
 */
export function bytesToBase64Url(bytes: Uint8Array): string {
  const base64 = Buffer.from(bytes).toString("base64");
  // Replace + with -, / with _, remove trailing =
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Reads the HTTP status from a rejected request without trusting its shape.
 *
 * Axios rejects with an untyped error, so narrow it at runtime instead of
 * asserting a response shape we never validated.
 */
export function httpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("response" in error)) {
    return undefined;
  }

  const { response } = error;
  if (!response || typeof response !== "object" || !("status" in response)) {
    return undefined;
  }

  const { status } = response;
  return typeof status === "number" ? status : undefined;
}

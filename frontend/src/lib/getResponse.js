/**
 * Offline / API-failure fallback — short, human message only (no structured report).
 */
export async function getResponse() {
  return (
    "I'm having trouble connecting right now.\n" +
    "Could you try again in a moment?"
  );
}

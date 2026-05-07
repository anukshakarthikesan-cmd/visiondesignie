/**
 * Best-effort parse of plot / floors / FSI from assistant text (frontend only).
 */
export function extractDesignMetrics(text) {
  if (!text || typeof text !== "string") return {};

  const out = {};

  const plotMatches = [
    ...text.matchAll(/(\d{1,6}(?:[.,]\d+)?)\s*(sq\.?\s*ft\.?|sqft)/gi),
  ];
  if (plotMatches.length > 0) {
    const m = plotMatches[plotMatches.length - 1];
    out.plot = `${m[1]} ${m[2]}`.replace(/\s+/g, " ").trim();
  }

  const gAll = [...text.matchAll(/\bG\s*\+\s*(\d+)\b/gi)];
  if (gAll.length > 0) {
    out.floors = `G+${gAll[gAll.length - 1][1]}`;
  } else {
    const st = text.match(/\b(\d+)\s+(floors?|storeys?|stories)\b/i);
    if (st) out.floors = `${st[1]} ${st[2].toLowerCase()}`;
  }

  const fsiAll = [...text.matchAll(/\bFSI\s*[:\s]+\s*(\d+(?:\.\d+)?)\b/gi)];
  if (fsiAll.length > 0) {
    out.fsi = fsiAll[fsiAll.length - 1][1];
  }

  return out;
}

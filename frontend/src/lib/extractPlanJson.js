/**
 * Strip trailing PLAN_JSON blocks from assistant message text (display / titles only).
 * The product no longer renders 2D layouts; legacy messages may still contain PLAN_JSON.
 */

/**
 * @param {string} text
 * @returns {{
 *   displayText: string,
 *   plan: null,
 *   rawJson: string | null,
 *   status: 'none',
 *   logDetail?: string
 * }}
 */
export function splitPlanJsonFromMessage(text) {
  const absent = (displayText) => ({
    displayText: displayText ?? "",
    plan: null,
    rawJson: null,
    status: /** @type {const} */ ("none"),
  });

  try {
    if (!text || typeof text !== "string") {
      return absent(text || "");
    }

    const matches = [...text.matchAll(/^\s*PLAN_JSON:\s*/gim)];
    if (!matches.length) {
      return absent(text);
    }

    const last = matches[matches.length - 1];
    const idx = last.index;
    const prefix = text.slice(0, idx).replace(/\s+$/u, "");
    const afterLabel = text.slice(idx + last[0].length).trimStart();

    if (!afterLabel.startsWith("{")) {
      return absent(prefix);
    }

    let depth = 0;
    let end = -1;
    for (let i = 0; i < afterLabel.length; i++) {
      const c = afterLabel[i];
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end < 0) {
      return absent(prefix);
    }

    const rawJson = afterLabel.slice(0, end).trim();
    return {
      displayText: prefix,
      plan: null,
      rawJson,
      status: "none",
    };
  } catch (e) {
    return {
      displayText: typeof text === "string" ? text : "",
      plan: null,
      rawJson: null,
      status: "none",
      logDetail: e?.message ?? String(e),
    };
  }
}

/** VisionDesignie FastAPI origin (same host as POST /chat). */
const DEV_FALLBACK = "http://127.0.0.1:8000";
const PROD_FALLBACK = "https://visiondesignie.onrender.com";

function resolveChatApiBase() {
  if (
    typeof import.meta !== "undefined" &&
    import.meta.env &&
    typeof import.meta.env.VITE_CHAT_API_BASE === "string" &&
    import.meta.env.VITE_CHAT_API_BASE.trim() !== ""
  ) {
    return import.meta.env.VITE_CHAT_API_BASE.trim().replace(/\/$/, "");
  }
  if (typeof import.meta !== "undefined" && import.meta.env?.PROD) {
    return PROD_FALLBACK;
  }
  return DEV_FALLBACK;
}

export const CHAT_API_BASE = resolveChatApiBase();

/**
 * Best-effort parse of FastAPI error bodies (and plain text) after a non-OK /chat response.
 * @param {Response} res
 * @returns {Promise<string>}
 */
export async function readChatApiFailureMessage(res) {
  const status = res.status;
  let detail = "";
  try {
    const text = await res.text();
    if (text) {
      try {
        const j = JSON.parse(text);
        const d = j.detail;
        if (typeof d === "string") {
          detail = d;
        } else if (Array.isArray(d)) {
          detail = d
            .map((x) =>
              x && typeof x === "object" && typeof x.msg === "string"
                ? x.msg
                : String(x)
            )
            .join("; ");
        } else if (d != null) {
          detail = String(d);
        }
      } catch {
        detail = text.trim().slice(0, 800);
      }
    }
  } catch {
    /* ignore */
  }
  const tail = detail ? `\n\n${detail}` : "";
  return `The chat API returned HTTP ${status}.${tail}`;
}

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

/** VisionDesignie FastAPI origin (same host as POST /chat). */
export const CHAT_API_BASE =
  typeof import.meta !== "undefined" &&
  import.meta.env &&
  typeof import.meta.env.VITE_CHAT_API_BASE === "string" &&
  import.meta.env.VITE_CHAT_API_BASE.trim() !== ""
    ? import.meta.env.VITE_CHAT_API_BASE.trim().replace(/\/$/, "")
    : "http://127.0.0.1:8000";

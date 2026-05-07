/** Max size for attached .txt files (bytes). */
export const MAX_TEXT_FILE_BYTES = 512 * 1024;

/** Assistant bubbles that are UI-only (not real model output for FSM / excerpts). */
export function isAssistantChromeMessage(m) {
  return Boolean(m?.personaSwitchNotice || m?.chatInitGreeting);
}

export function messageCountsTowardAssistantPresence(m) {
  return (
    m?.role === "assistant" &&
    !isAssistantChromeMessage(m) &&
    String(m?.content ?? "").trim() !== ""
  );
}

export function lastSubstantiveAssistantContent(messages) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (messageCountsTowardAssistantPresence(m)) return m.content;
  }
  return "";
}

export function getSpeechRecognitionCtor() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export const tempAssistantId = () => `tmp-${crypto.randomUUID()}`;

export function formatMessageTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

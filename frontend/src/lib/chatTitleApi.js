import { CHAT_API_BASE } from "./chatApiBase";
import { splitPlanJsonFromMessage } from "./extractPlanJson";

const CHAT_TITLE_URL = `${CHAT_API_BASE}/chat/title`;

/**
 * Build a compact transcript for the title model from messages before this turn plus the latest pair.
 * @param {Array<{ role: string, content?: string, personaSwitchNotice?: boolean, chatInitGreeting?: boolean }>} baseMessages
 * @param {string} userText latest user line (may be empty for chained streams)
 * @param {string} assistantText latest assistant body
 */
export function transcriptForChatTitle(baseMessages, userText, assistantText) {
  const clip = (s, n = 520) =>
    String(s || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, n);
  const stripPlan = (s) => {
    const { displayText } = splitPlanJsonFromMessage(String(s || ""));
    return String(displayText || "").trim();
  };
  const rows = [];
  for (const m of baseMessages || []) {
    if (!m || m.personaSwitchNotice || m.chatInitGreeting) continue;
    if (m.role !== "user" && m.role !== "assistant") continue;
    const c = clip(stripPlan(m.content));
    if (!c) continue;
    rows.push({ role: m.role, content: c });
  }
  const ut = clip(stripPlan(userText));
  const at = clip(stripPlan(assistantText));
  if (ut) {
    const last = rows[rows.length - 1];
    if (!last || last.role !== "user" || last.content !== ut) {
      rows.push({ role: "user", content: ut });
    }
  }
  if (at) {
    const last = rows[rows.length - 1];
    if (!last || last.role !== "assistant" || last.content !== at) {
      rows.push({ role: "assistant", content: at });
    }
  }
  return rows.slice(-14);
}

/**
 * @param {Array<{ role: string, content: string }>} messages
 * @param {string | null | undefined} chatType legacy field (optional); server ignores mode splits
 * @returns {Promise<string | null>}
 */
export async function fetchChatTitleFromApi(messages, chatType) {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const res = await fetch(CHAT_TITLE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      chat_type: chatType || null,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const t = typeof data?.title === "string" ? data.title.trim() : "";
  return t || null;
}

/**
 * Persists LLM title and refreshes sidebar list.
 */
export async function updateChatTitleWithLlm({
  supabase,
  chatId,
  messages,
  chatType,
  refreshChats,
}) {
  if (!supabase || !chatId || !Array.isArray(messages) || messages.length === 0) {
    return;
  }
  try {
    const title = await fetchChatTitleFromApi(messages, chatType);
    if (!title) return;
    const safe = title.slice(0, 120);
    const { error } = await supabase.from("chats").update({ title: safe }).eq("id", chatId);
    if (error) {
      console.warn("chat title update", error);
      return;
    }
    refreshChats?.();
  } catch (e) {
    console.warn("updateChatTitleWithLlm", e);
  }
}

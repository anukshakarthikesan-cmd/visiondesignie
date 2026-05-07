/**
 * Core text sent to POST /chat as `message`.
 * Conversation continuity is handled by the backend using `chat_id` + in-memory history
 * (see rag_pipeline). We no longer wrap with "Previous conversation:" / "Current request:"
 * so the model sees a clean user line; optional hints stay in {@link buildRagMessageWithMemoryHint}.
 */
export function buildApiMessageWithRecentHistory(_recentMessages, coreMessage) {
  return String(coreMessage ?? "").trim();
}

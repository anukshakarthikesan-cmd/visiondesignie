/**
 * Persist assistant completion metrics to Supabase `chat_metrics` (RLS-scoped).
 */

export function assistantLooksStructured(text) {
  if (!text || typeof text !== "string") return false;
  return (
    /📐\s*Site Analysis/i.test(text) &&
    /📊\s*Regulations/i.test(text) &&
    /🏡\s*Suggested Plan/i.test(text) &&
    /❓\s*Next Step/i.test(text)
  );
}

/** Maps consultation stream phase to DB `stage` enum-style text. */
export function stageForMetric(phase) {
  if (phase === "analyzing") return "analysis";
  if (phase === "planning") return "planning";
  return "general";
}

/** User reply that should mark the latest assistant completion as approved. */
export function userMessageSignalsApproval(text) {
  const t = (text || "").trim().toLowerCase();
  if (!t) return false;
  return /\b(yes|proceed|continue)\b/i.test(t);
}

/** Stage for locally generated assistant replies (no stream phase). */
export function localMetricStage(nextState) {
  const s = nextState?.stage;
  if (s === "analyzing") return "analysis";
  if (s === "planning") return "planning";
  return "general";
}

export async function insertChatMetric(supabase, row) {
  const {
    chatId,
    userId,
    stage,
    responseTimeMs,
    structured,
    userInputPreview,
    assistantMessageId,
  } = row;
  if (!supabase || !chatId || !userId) return { error: new Error("missing supabase/chat/user") };
  return supabase.from("chat_metrics").insert({
    chat_id: chatId,
    user_id: userId,
    stage,
    response_time_ms: Math.max(0, Math.round(Number(responseTimeMs) || 0)),
    structured: !!structured,
    approved: false,
    user_input_preview: String(userInputPreview || "").slice(0, 500),
    assistant_message_id: assistantMessageId || null,
  });
}

export async function markLastAssistantMetricApproved(supabase, chatId, userId) {
  if (!supabase || !chatId || !userId) return;
  const { data, error } = await supabase
    .from("chat_metrics")
    .select("id")
    .eq("chat_id", chatId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.id) return;
  await supabase.from("chat_metrics").update({ approved: true }).eq("id", data.id);
}

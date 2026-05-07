import supabase from "./supabaseClient";

/**
 * Inserts a row into `messages`. Returns the row so callers can use `id` / `created_at` in UI.
 */
export async function saveMessage({ chat_id, role, content }) {
  const { data, error } = await supabase
    .from("messages")
    .insert([{ chat_id, role, content }])
    .select()
    .single();

  if (error) {
    console.error("Save message error:", error);
  }

  return { data, error };
}

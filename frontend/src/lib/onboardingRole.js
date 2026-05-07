/**
 * Maps profiles.onboarding_role (slug or custom "Other" text) to a friendly label for UI / LLM.
 */

const SLUG_LABELS = {
  home_builder: "First-time Home Builder",
  student: "Architecture Student",
  investor: "Plot Buyer / Investor",
  contractor: "Small Contractor / Builders",
  professional: "Working Professional",
};

/**
 * @param {string | null | undefined} onboardingRole raw value from Supabase profiles.onboarding_role
 * @returns {string} Human-readable role for prompts and copy, or "" if missing
 */
export function formatOnboardingRoleLabel(onboardingRole) {
  const raw = (onboardingRole || "").trim();
  if (!raw) return "";
  return SLUG_LABELS[raw] || raw;
}

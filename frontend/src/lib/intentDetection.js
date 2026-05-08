/** Aligned with backend `SMALL_TALK` in rag_pipeline (last-line match after trim). */
const SMALL_TALK_UTTERANCES = new Set([
  "hi",
  "hello",
  "hey",
  "hey there",
  "hey hii",
  "hey hi",
  "hey hello",
  "how are you",
]);

/**
 * True when the user’s real utterance is a short greeting (handles multi-line paste; tail line wins).
 * @param {string} message
 */
export function isSmallTalkMessage(message) {
  const raw = String(message || "").trim();
  if (!raw) return false;
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const tail = lines.length ? lines[lines.length - 1] : "";
  const t = tail.toLowerCase().replace(/[!.?…]+$/u, "").trim();
  return SMALL_TALK_UTTERANCES.has(t);
}

/**
 * Lightweight opener / filler turns that should get a short route hint first.
 * Keeps first turns like "hi", "ok", "hmm", "hello buddy" from jumping into
 * deep requirement questions before the user states intent.
 * @param {string} message
 * @param {Record<string, unknown>} [requirements]
 */
export function isLightOpenerMessage(message, requirements) {
  const raw = String(message || "").trim();
  if (!raw) return false;
  if (hasStructuredFromMerged(requirements)) return false;
  if (isSmallTalkMessage(raw)) return true;

  const t = raw.toLowerCase().replace(/\s+/g, " ").trim();
  if (/\d/.test(t)) return false;
  if (/[?,:]/.test(t)) return false;
  if (
    /\b(plot|site|plan|planning|layout|fsi|setback|bhk|vastu|modern|traditional|compact)\b/.test(
      t
    )
  ) {
    return false;
  }
  return /^(ok|okay|hmm|hmmm|hmm+|yo|hello buddy|hello bro|hey buddy|hi buddy|start|go on|continue)$/i.test(
    t
  );
}

/**
 * Weighted signals — less brittle than single boolean cues.
 * Consultation patterns overlap words like "build" in "what can I build"; knowledge
 * patterns (especially "what can I") carry higher weight so exploratory questions win.
 */
function scoreKnowledge(t) {
  let s = 0;
  if (/\bwhat\s+(is|are)\b/.test(t)) s += 4;
  if (/\bwhat\s+can\s+i\b/.test(t)) s += 5;
  if (/\bwhat\s+should\b/.test(t)) s += 3;
  if (/\bwhat\s+do\s+i\b/.test(t)) s += 3;
  if (/\bhow\s+(does|do|can|much|many)\b/.test(t)) s += 3;
  if (/\bexplain\b/.test(t)) s += 2;
  if (/\bwhy\b/.test(t)) s += 2;
  if (/\brules?\b/.test(t)) s += 2;
  if (/\bregulation/.test(t)) s += 3;
  if (/\bbylaw\b/.test(t)) s += 3;
  if (/\bfsi\b/.test(t)) s += 3;
  if (/\bsetbacks?\b/.test(t)) s += 3;
  return s;
}

function scoreConsultation(t, raw) {
  let s = 0;
  if (/\b(plan|planning)\b/.test(t)) s += 3;
  if (/\b(build|building|built)\b/.test(t)) s += 1;
  if (/\bdesign\b/.test(t)) s += 3;
  if (
    /\b(layout|floor\s*plan|garage|parking|stilt|ground\s*floor|first\s*floor|second\s*floor|master\s*bedroom)\b/.test(
      t
    )
  ) {
    s += 5;
  }
  if (/\b(best|suggested)\s+layout\b/.test(t)) s += 4;
  if (/\b\d\s*bhk\b/.test(t) || /\bbhk\b/i.test(raw)) s += 4;
  if (/\b\d\s*bedroom\b/.test(t)) s += 3;
  if (
    /\bplot\b/.test(t) &&
    /\b(my|size|sizes|dimension|ft|feet|m\b|meter|metres?|×|x\s*\d|\d\s*x\s*\d|house|home|layout|ground|floor|site|land|brief|chennai|road|width)\b/i.test(
      raw
    )
  ) {
    s += 4;
  }
  return s;
}

function hasStructuredFromMerged(requirements) {
  if (!requirements || typeof requirements !== "object") return false;
  return Boolean(
    requirements.plot_size ||
      requirements.plot ||
      requirements.location ||
      requirements.bhk
  );
}

function looksLikeExplanatoryQuestion(t) {
  if (!/\?$/.test(t) && !/^(why|what|how|explain|define)\b/.test(t)) return false;
  const hasQuestionLead = /^(why|what|how|explain|define)\b/.test(t);
  const asksReason =
    /\b(why|what|how|needed|need|required|require|mean|means|difference)\b/.test(t);
  const architectureTopic =
    /\b(layout|floor\s*plan|fsi|far|setback|vastu|zoning|coa|elevation|circulation|ventilation)\b/.test(
      t
    );
  return (hasQuestionLead || asksReason) && architectureTopic;
}

/**
 * For devtools only — mirrors the scores used in {@link detectIntent}.
 * @param {string} message
 * @param {Record<string, unknown>} [requirements] merged design state from {@link mergeRequirementsFromMessage}
 */
export function getIntentScores(message, requirements) {
  const raw = (message || "").trim();
  if (!raw) {
    return { knowledgeScore: 0, consultationScore: 0, hasStructuredInputs: false };
  }
  const t = raw.toLowerCase();
  const hasStructuredInputs = hasStructuredFromMerged(requirements);
  return {
    knowledgeScore: scoreKnowledge(t),
    consultationScore: scoreConsultation(t, raw),
    hasStructuredInputs,
  };
}

/**
 * Route user text between step-by-step consultation (FSM) and direct LLM (RAG) answers.
 *
 * @param {string} message
 * @param {Record<string, unknown>} [requirements] merged design state from {@link mergeRequirementsFromMessage}
 * @returns {"consultation" | "knowledge" | "hybrid"}
 */
export function detectIntent(message, requirements) {
  const raw = (message || "").trim();
  if (!raw) return "consultation";

  if (isSmallTalkMessage(raw)) return "consultation";

  const t = raw.toLowerCase();
  const normalized = t.replace(/\s+/g, " ").trim();
  const knowledgeScore = scoreKnowledge(t);
  const consultationScore = scoreConsultation(t, raw);

  const hasStructuredInputs = hasStructuredFromMerged(requirements);

  if (looksLikeExplanatoryQuestion(normalized)) {
    return "knowledge";
  }

  // Definition/explanation prompts should stay in knowledge mode unless the
  // user already shared concrete project facts for planning.
  const isDefinitionLike =
    /^(what\s+is|what\s+are|define|definition\s+of|explain)\b/.test(t) &&
    /\b(floor\s*plan|setback|fsi|far|bylaw|regulation|elevation|section|ventilation|circulation|plot|zoning)\b/.test(
      t
    );
  if (isDefinitionLike && !hasStructuredInputs) return "knowledge";

  /* RAG + handoff only when we parsed site fields and the utterance reads as a knowledge-style question. */
  if (
    hasStructuredInputs &&
    knowledgeScore > 0 &&
    knowledgeScore >= consultationScore
  ) {
    return "hybrid";
  }

  if (knowledgeScore > consultationScore) return "knowledge";

  if (consultationScore > knowledgeScore) return "consultation";

  /* Tie: exploratory wording without structured data → answer-only (e.g. "what can I build on my plot?"). */
  if (!hasStructuredInputs) return "knowledge";

  return "consultation";
}

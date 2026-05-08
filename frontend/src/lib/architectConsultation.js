/**
 * VisionDesignie — one architect assistant: gather site needs → plan → refine (see server `rag_pipeline`).
 *
 * This module: extraction, merge, planning trigger, minimal planning wrappers (stage markers + format only).
 * {@link mergeRequirementsFromMessage} + {@link hasEnoughForLayoutProfile} triggers planning (structured layout prose); gathering uses
 * short local questions until plot + city + BHK, then LLM planning → approval.
 */

import { stripAssistantPromptLeakage } from "./sanitizeAssistantReply.js";

/** Identity line for wrapped API messages (conduct: server THREAD BEHAVIOR). */
const VISIONDESIGNIE_SYSTEM_IDENTITY =
  "You are the architect assistant in VisionDesignie. The person messaging you is the CLIENT.\n";

/** Format-only — behavior is defined on the server (rag_pipeline). */
const WRAPPER_FORMAT_HINT =
  "Follow the required output format for this stage. Do not include internal notes.\n";

/** One line for wrapped consultation turns (four-section structure). */
const CONSULTATION_FORMAT_HINT =
  "Use the four emoji sections (📐📊🏡❓) once—lean bullets; one clear question in ❓. Do not echo bracket headers.\n";

/** Canonical keys for client-side requirement checks (plot uses stored `plot_size`). */
export const REQUIREMENTS = Object.freeze({
  plot: null,
  location: null,
  bhk: null,
  facing: null,
  parking: null,
});

/** Allowed `layout_style` values for the client layout engine. */
export const LAYOUT_STYLE_VALUES = Object.freeze([
  "modern",
  "traditional",
  "compact",
]);

const LAYOUT_STYLE_SET = new Set(LAYOUT_STYLE_VALUES);

export const INITIAL_DESIGN_STATE = {
  plot_size: null,
  location: null,
  road_width: null,
  road_info: null,
  building_type: null,
  bhk: null,
  floors: null,
  vastu_preference: null,
  /** @type {'modern'|'traditional'|'compact'|null} */
  layout_style: null,
  special_requirements: [],
  facing: null,
  parking: null,
  stage: "gathering",
};

const DESIGN_STAGE_WHITELIST = new Set([
  "gathering",
  "collecting",
  "collecting_type",
  "collecting_plot",
  "collecting_location",
  "collecting_road",
  "plot_size",
  "location",
  "road_width",
  "building_type",
  "confirm",
  "analyzing",
  "planning",
  "approval",
  "complete",
]);

/**
 * Safe hydrate from Supabase `chats.design_state` (jsonb). Returns null if unusable.
 * Ignores `last_updated` and any other extra keys (debug/analytics only in DB).
 */
export function normalizeDesignStateFromDb(raw) {
  if (raw == null || typeof raw !== "object") return null;
  let stage =
    typeof raw.stage === "string" && DESIGN_STAGE_WHITELIST.has(raw.stage)
      ? raw.stage
      : INITIAL_DESIGN_STATE.stage;
  if (
    stage === "collecting" ||
    /^collecting_/.test(stage) ||
    stage === "confirm" ||
    stage === "analyzing"
  ) {
    stage = "gathering";
  }
  const spec = raw.special_requirements;
  const special_requirements = Array.isArray(spec)
    ? spec.map((s) => String(s).trim()).filter(Boolean)
    : [];
  return {
    plot_size: raw.plot_size ?? null,
    location: raw.location ?? null,
    road_width: raw.road_width ?? null,
    road_info: raw.road_info ?? null,
    building_type: raw.building_type ?? null,
    bhk: typeof raw.bhk === "number" && !Number.isNaN(raw.bhk) ? raw.bhk : null,
    floors:
      typeof raw.floors === "number" && !Number.isNaN(raw.floors)
        ? raw.floors
        : null,
    vastu_preference:
      raw.vastu_preference === true || raw.vastu_preference === false
        ? raw.vastu_preference
        : null,
    layout_style: (() => {
      if (
        typeof raw.layout_style === "string" &&
        LAYOUT_STYLE_SET.has(String(raw.layout_style).toLowerCase())
      ) {
        return String(raw.layout_style).toLowerCase();
      }
      /* Older rows: had plot + BHK + Vastu but no style key — default so the client sketch still runs. */
      if (
        raw.plot_size &&
        String(raw.plot_size).trim() !== "" &&
        raw.location &&
        String(raw.location).trim() !== "" &&
        typeof raw.bhk === "number" &&
        !Number.isNaN(raw.bhk) &&
        raw.bhk > 0 &&
        (raw.vastu_preference === true || raw.vastu_preference === false)
      ) {
        return "modern";
      }
      return null;
    })(),
    special_requirements,
    facing: raw.facing != null ? String(raw.facing).trim() || null : null,
    parking: raw.parking != null ? String(raw.parking).trim() || null : null,
    stage,
  };
}

/** Legacy one-liner (no longer injected as a separate bubble — planning opens with the streamed reply). */
export const MSG_PLANNING_TRANSITION =
  "Here’s a layout direction for your site — sketching it in the next message.";

/** Legacy single-line bridge copy (optional UI / docs). */
export const PLANNING_TRANSITION =
  "With your plot, location, and bedrooms clear, I’ll sketch the floor layout next.";

/** @deprecated Prefer streaming only — was two stacked lines; kept for compatibility. */
export const PLANNING_GATHERING_PREAMBLE = PLANNING_TRANSITION;

/** @deprecated Use {@link PLANNING_TRANSITION} */
export const MSG_GATHERING_TO_PLANNING_BRIDGE = PLANNING_TRANSITION;

/** Reference copy for proceed/change (LLM ❓ Next Step is the single UI decision point). */
export const MSG_APPROVAL_FOLLOWUP =
  "This direction looks workable from what you've shared.\n\nShall we lock it in and move forward, or tweak something first?";

/** Synthetic user line between analysis and planning streams. */
export const PLANNING_BRIDGE_USER_TEXT =
  "Next, I'd like a suggested spatial layout for this site in our chat.";

/** One-line sample users can send to unlock site-specific advice (shown in UI + echoed in local copy). */
export const EXAMPLE_FULL_PROJECT_MESSAGE =
  "40 ft × 30 ft plot in Chennai, 24 ft front road, 2BHK independent house";

/**
 * Quick-reply chips in Chat — concrete example inputs alongside short intents.
 */
export const CHAT_STARTER_EXAMPLES = [
  { label: "🏠 Plan my 2BHK", text: "Plan my 2BHK" },
  {
    label: "📋 Use example brief",
    text: EXAMPLE_FULL_PROJECT_MESSAGE,
  },
  { label: "📐 What can I build?", text: "What can I build on my plot?" },
  {
    label: "📊 Setbacks & FSI",
    text: "Explain setbacks and FSI in simple terms for a small residential plot.",
  },
  { label: "❓ What should I type?", text: "What should I tell you about my plot? Give me an example message I can paste." },
];

/** Appended to the same assistant bubble as the hybrid RAG reply (single message UX). */
export const MSG_HYBRID_BRIDGE =
  "I can continue either way - refine your plan for this site, or answer architecture questions. Your call.";

/**
 * True when the user pasted a brief-like message even if {@link extractInputs} misses a field.
 */
export function messageLooksSiteRich(text) {
  const t = String(text || "");
  if (!t.trim()) return false;
  if (/\b\d{1,4}\s*[x×X*]\s*\d{1,4}\b/.test(t)) return true;
  if (/\b\d{1,4}\s+['′]\s+\d{1,4}\s*['′]\b/i.test(t)) return true;
  if (/\b\d{2,4}\s+\d{2,4}\b/.test(t) && /\b(?:plot|site|bhk|house|chennai|ft|feet)\b/i.test(t))
    return true;
  if (
    /\b\d{3,6}\s*(?:sq\.?\s*ft\.?|sqft|sqrft|sqr\.?\s*ft|\bsq\s+ft\b|\bsft\b|square\s*feet|squa?re\s*feet|sqa?uare\s*feet)\b/i.test(
      t
    )
  )
    return true;
  if (/\b(?:plot|road)\s*(?:size|width)?\b/i.test(t) && /\b\d{1,3}\s*(?:ft|feet|m)\b/i.test(t))
    return true;
  if (
    /\b(?:garage|parking|stilt|bedroom|floor\s*plan|layout)\b/i.test(t) &&
    /\b\d{1,3}\s*(?:ft|feet|')\b/i.test(t)
  )
    return true;
  return false;
}

/**
 * Remove leaked RAG dataset lines and "--- User Query ---" echoes before save/display.
 * @param {string} content
 */
export function sanitizeAssistantRagEcho(content) {
  if (!content || typeof content !== "string") return content;
  const lines = content.split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const s = line.trim();
    if (/^---\s*User\s+Query\s*---\s*$/i.test(s) || /^-+\s*User\s+Query\s*-+\s*$/i.test(s)) {
      i += 1;
      while (i < lines.length && lines[i].trim() !== "") i += 1;
      continue;
    }
    if (/VISIONDESIGNIE\s*[-—–]/i.test(line)) {
      i += 1;
      continue;
    }
    if (
      /^\s*\d+\s*:\s*/i.test(line) &&
      /(BEDROOM|SQ\.?\s*FT|SQFT|PLOT|FLOOR\s*PLAN|GARAGE|PARKING|MASTER)/i.test(line)
    ) {
      i += 1;
      continue;
    }
    if (/^FAISS\s+RAG\s+SNIPPETS\s*$/i.test(s)) {
      i += 1;
      while (
        i < lines.length &&
        (lines[i].trim().startsWith("-") || lines[i].trim() === "")
      ) {
        i += 1;
      }
      continue;
    }
    if (/^3D\s+MODELS?:/i.test(s)) {
      i += 1;
      continue;
    }
    out.push(line);
    i += 1;
  }
  let joined = out.join("\n").trim();
  const paras = joined.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paras.length < 2) {
    return stripAssistantPromptLeakage(joined);
  }
  const deduped = [];
  let prevKey = null;
  for (const p of paras) {
    const key = p.slice(0, 240);
    if (key === prevKey) continue;
    deduped.push(p);
    prevKey = key;
  }
  return stripAssistantPromptLeakage(deduped.join("\n\n"));
}

/**
 * Persist/DB cleanup: run {@link sanitizeAssistantRagEcho}, then if that over-aggressively
 * blanks a non-empty stream (planning replies can match strip patterns), fall back.
 */
export function safePersistAssistantContent(content) {
  if (content == null || typeof content !== "string") return "";
  const raw = content.trim();
  if (!raw) return "";
  const aggressive = sanitizeAssistantRagEcho(raw);
  if (aggressive.trim()) return aggressive.trim();
  const light = stripAssistantPromptLeakage(raw);
  if (light.trim()) return light.trim();
  return raw;
}

/**
 * Soft handoff after knowledge-only RAG — varies when the user already sounds site-specific.
 * @param {string} rawMessage
 * @param {Record<string, unknown>} extracted from {@link extractInputs}
 */
export function buildKnowledgeSoftInvite(rawMessage, extracted) {
  const hasStructuredInputs = Object.values(extracted || {}).some(
    (v) => v != null && String(v).trim() !== ""
  );
  if (hasStructuredInputs || messageLooksSiteRich(rawMessage)) {
    return "Tell me what you want next - refine this plan, or ask a focused architecture question.";
  }
  return "If you want planning, share plot size + location + BHK. Or continue with any architecture question.";
}

const MEMORY_SNIPPET_MAX = 320;

/**
 * Prepended to RAG / hybrid API payloads only (not the saved user line).
 */
export const RAG_BUILDER_PERSONA_PREFIX =
  "[VisionDesignie — architect assistant]\n" +
  `${VISIONDESIGNIE_SYSTEM_IDENTITY}` +
  `${WRAPPER_FORMAT_HINT}` +
  "Reply in natural language unless this message is a consultation-stage wrapper (then follow MODE). " +
  "Use any “Saved:” facts silently; do not paste scaffold labels.\n\n";

/**
 * Strip trailing PLAN_JSON from saved assistant text when the turn should stay prose-only.
 * @param {string} text
 */
export function stripTrailingPlanJson(text) {
  if (!text || typeof text !== "string") return text;
  const m = text.match(/^\s*PLAN_JSON:\s*\{/im);
  if (!m || m.index == null) return text;
  return text.slice(0, m.index).replace(/\s+$/u, "");
}

/**
 * Augments the user message sent to `/chat` only (not persisted). Helps follow-ups like "what about parking?"
 * use {@link INITIAL_DESIGN_STATE} fields and the latest assistant reply.
 *
 * @param {string} userText
 * @param {object} designState
 * @param {Array<{ role: string, content?: string }>} priorMessages messages before this turn
 */
export function buildRagMessageWithMemoryHint(userText, designState, priorMessages) {
  const text = (userText || "").trim();
  if (!text) return text;

  const ok = (v) => v != null && String(v).trim() !== "";
  const bits = [];
  if (ok(designState?.plot_size)) bits.push(`plot/size: ${designState.plot_size}`);
  if (ok(designState?.location)) bits.push(`location: ${designState.location}`);
  if (ok(designState?.road_width)) bits.push(`front road: ${designState.road_width}`);
  if (ok(designState?.road_info)) bits.push(`road access: ${designState.road_info}`);
  if (designState?.bhk != null && Number(designState.bhk) > 0)
    bits.push(`BHK: ${designState.bhk}`);
  if (ok(designState?.facing)) bits.push(`facing: ${designState.facing}`);
  if (ok(designState?.parking)) bits.push(`parking: ${designState.parking}`);
  if (designState?.floors != null && Number(designState.floors) > 0)
    bits.push(`floors: ${designState.floors}`);
  if (ok(designState?.building_type)) bits.push(`building: ${designState.building_type}`);
  if (designState?.vastu_preference === true) bits.push(`Vastu: yes`);
  if (designState?.vastu_preference === false) bits.push(`Vastu: not required`);
  if (
    designState?.layout_style &&
    LAYOUT_STYLE_SET.has(String(designState.layout_style).toLowerCase())
  ) {
    bits.push(`layout style: ${String(designState.layout_style).toLowerCase()}`);
  }
  if (
    Array.isArray(designState?.special_requirements) &&
    designState.special_requirements.length
  ) {
    bits.push(`notes: ${designState.special_requirements.join(", ")}`);
  }

  let recent = "";
  if (Array.isArray(priorMessages) && priorMessages.length > 0) {
    const lastAsst = [...priorMessages]
      .reverse()
      .find((m) => m.role === "assistant" && m.content?.trim());
    if (lastAsst?.content) {
      const flat = lastAsst.content.replace(/\s+/g, " ").trim();
      const clip =
        flat.length > MEMORY_SNIPPET_MAX
          ? `${flat.slice(0, MEMORY_SNIPPET_MAX)}…`
          : flat;
      recent = `Prior reply (continuity): ${clip}`;
    }
  }

  if (bits.length === 0 && !recent) return text;

  const pre = [
    "Use only if relevant; never quote this block verbatim as a labeled block in your reply.",
    bits.length
      ? `Saved: ${bits.join("; ")}. Anchor your answer to these facts when deciding (e.g. “Based on your plot in …”).`
      : null,
    recent || null,
  ]
    .filter(Boolean)
    .join("\n");

  return `${pre}\n\n${text}`;
}

/**
 * Short welcome when the user opens a new empty chat (client-only bubble; not saved to DB).
 * @param {string} [username]
 */
export function getNewChatWelcomeMessage(username = "") {
  void username;
  return "Hi I'm VisionDesignie - Architect Planner & Consultant.";
}

/**
 * Longer optional copy for tooling/tests. UI uses {@link getNewChatWelcomeMessage} on new chats.
 * @param {string} [username]
 * @param {string} [onboardingRoleLabel] from formatOnboardingRoleLabel(profiles.onboarding_role)
 */
export function getChatBotInitiationMessage(
  username = "",
  onboardingRoleLabel = ""
) {
  const name = (username || "").trim();
  const lead = name ? `Hi, ${name}! ` : "Hi! ";
  const roleDisplay = (onboardingRoleLabel || "").trim();
  const roleLine = roleDisplay
    ? `\n\nI'll keep your onboarding choice in mind (${roleDisplay}) — answers will match that lens where it helps.`
    : "";
  return (
    `${lead}I'm your architect assistant—ask about building rules, what fits your plot, or how to describe your site. I use your indexed documents when they apply, plus clear reasoning.` +
    roleLine +
    `\n\nTip — you can paste a full brief in one go, for example:\n"${EXAMPLE_FULL_PROJECT_MESSAGE}"\n\n` +
    `Or tap a starter below to begin.`
  );
}

const TYPE_PATTERNS = [
  [/(\d)\s*bhk/i, (m) => `${m[1]}BHK`],
  [/(\d)\s*bedroom/i, (m) => `${m[1]} bedroom house`],
  [/\b(apartment|flat|villa|duplex|townhouse|row\s*house)\b/i, (m) =>
    m[1].replace(/\s+/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
  ],
  [/\b(single[-\s]?family|independent)\s+house\b/i, () => "House"],
  [/\bhouse\b/i, () => "House"],
  [/\bcommercial\b/i, () => "Commercial"],
  [/\bresidential\b/i, () => "Residential"],
];

export function extractPlot(text) {
  if (!text || typeof text !== "string") return null;
  const t = text.trim();
  if (!t) return null;

  const _plotContext =
    /\b(?:plot|site|size|dimension|land|measur|ft|feet|ground|layout|sq|bedroom|bhk|house|garage|road|parking|floor|chennai|bengaluru|bangalore|mumbai|delhi|hyderabad|kolkata|pune|coimbatore|madurai|goa|kochi)\b/i;

  // 30' 40' / 30′ 40′ (feet marks; optional ft after second number)
  const dimPrimeSpaced = t.match(
    /\b(\d{1,4})\s*['′]\s+(\d{1,4})\s*['′](?:\s*(?:ft|feet))?\b/i
  );
  if (dimPrimeSpaced) {
    return `${dimPrimeSpaced[1]} ft × ${dimPrimeSpaced[2]} ft`;
  }

  const dimFt =
    t.match(
      /\b(\d{1,4})\s*[x×X]\s*(\d{1,4})\s*(?:ft|feet|')?\b/i
    ) ||
    t.match(/\b(\d{1,4})\s*ft\s*[x×X]\s*(\d{1,4})\s*ft\b/i) ||
    t.match(
      /\b(\d{1,4})\s*\*\s*(\d{1,4})\s*(?:ft|feet|')?\b/i
    ) ||
    t.match(
      /\b(\d{1,4})\s*['′]\s*(\d{1,4})\s*(?:['′]|(?:ft|feet))?\b/i
    );
  if (dimFt) {
    return `${dimFt[1]} ft × ${dimFt[2]} ft`;
  }

  const dimBare = t.match(/\b(\d{1,4})\s*[x×X*]\s*(\d{1,4})\b/);
  if (dimBare && _plotContext.test(t)) {
    return `${dimBare[1]} ft × ${dimBare[2]} ft`;
  }

  // "30 40", "30  40" as length × width in feet (avoid "12 15 bhk" style false positives)
  const dimSpaced = t.match(/\b(\d{1,4})\s+(\d{1,4})\b/);
  if (dimSpaced) {
    const a = parseInt(dimSpaced[1], 10);
    const b = parseInt(dimSpaced[2], 10);
    const explicitPlotOrDim =
      /\b(?:plot|site|dimension|size|land|measur)\b/i.test(t);
    const plausible =
      (a >= 8 && a <= 600 && b >= 8 && b <= 600) || _plotContext.test(t);
    const tinyPairNoContext =
      a <= 12 && b <= 12 && !_plotContext.test(t);
    const bhkNearby =
      /\b\d{1,2}\s*bhk\b/i.test(t) &&
      !explicitPlotOrDim &&
      a <= 25 &&
      b <= 25;
    if (
      Number.isFinite(a) &&
      Number.isFinite(b) &&
      plausible &&
      !tinyPairNoContext &&
      !bhkNearby
    ) {
      return `${dimSpaced[1]} ft × ${dimSpaced[2]} ft`;
    }
  }

  // Area: sqft / common typos (sqrft, sqaure feet), optional space before unit
  const sq = t.match(
    /(\d{1,6}(?:[.,]\d+)?)\s*(sq\.?\s*ft\.?|sq\.?\s*feet|sqft|sqrft|sqr\.?\s*ft|sq\.?\s*r\.?\s*ft|sq\.?\s*m\.?|sqm|\bsq\s+ft\b|\bsft\b|square\s*feet|squa?re\s*feet|sqa?uare\s*feet|sqaure\s*feet|squre\s*feet)\b/i
  );
  if (sq) {
    const rawNum = sq[1].replace(",", ".");
    const n = parseFloat(rawNum);
    const unitRaw = sq[2].replace(/\s+/g, " ").trim();
    const unitLower = unitRaw.toLowerCase();
    let out = `${rawNum} ${unitRaw}`;
    const hasDims =
      /\b\d{1,4}\s*[x×X*]\s*\d{1,4}\b/.test(t) ||
      /\b\d{1,4}\s+['′]\s+\d{1,4}\s*['′]\b/i.test(t) ||
      /\b\d{2,4}\s+\d{2,4}\b/.test(t);
    if (Number.isFinite(n) && n > 0 && !hasDims) {
      const isSqft =
        /sq.*ft|sqft|sq\.\s*feet/i.test(unitLower) && !/^sq\.?\s*m/.test(unitLower);
      const isSqm = /sq\.?\s*m|sqm/.test(unitLower);
      if (isSqft) {
        const side = Math.round(Math.sqrt(n) * 10) / 10;
        out += ` (~${side} ft × ${side} ft if square — confirm length × width)`;
      } else if (isSqm) {
        const sqft = n * 10.76391041671;
        const sideFt = Math.round(Math.sqrt(sqft) * 10) / 10;
        out += ` (~${Math.round(sqft)} sqft; ~${sideFt} ft × ${sideFt} ft if square — confirm)`;
      }
    }
    return out;
  }

  const cents = t.match(/\b(\d{1,4}(?:[.,]\d+)?)\s*cents?\b/i);
  if (cents) return `${cents[1]} cents`;

  const grounds = t.match(/\b(\d{1,4}(?:[.,]\d+)?)\s*grounds?\b/i);
  if (grounds) return `${grounds[1]} grounds`;

  return null;
}

export function extractLocation(text) {
  if (!text || typeof text !== "string") return null;
  const raw = text.trim();
  if (!raw) return null;
  const t = raw.toLowerCase();

  // Plain mentions (handles "chennai city", all-lowercase replies)
  if (t.includes("chennai")) return "Chennai";
  if (t.includes("bangalore") || t.includes("bengaluru")) return "Bangalore";
  if (t.includes("hyderabad")) return "Hyderabad";

  // "… city" (e.g. "madurai city", "north goa city")
  const citySuffix = t.match(/\b([a-z][a-z\s'.-]{1,48}?)\s+city\b/);
  if (citySuffix) {
    const name = citySuffix[1].replace(/\s+/g, " ").trim();
    if (
      name.length >= 2 &&
      !/^(the|a|an|my|our|in|at|near)\b/i.test(name)
    ) {
      return name.replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }

  const inCity = raw.match(
    /\b(?:in|at|near)\s+([A-Za-z][A-Za-z\s'.-]{2,40}?)(?=[\s,.;]|$)/i
  );
  if (inCity) {
    const name = inCity[1].trim();
    if (name.length > 2 && !/^(the|a|an|my|our)\b/i.test(name)) {
      return name.replace(/\s+/g, " ");
    }
  }

  const known =
    /\b(Chennai|Bengaluru|Bangalore|Mumbai|Delhi|Noida|Gurgaon|Gurugram|Hyderabad|Kolkata|Pune|Coimbatore|Madurai|Trichy|Tiruchirappalli|Salem|Erode|Kochi|Goa|Ahmedabad|Jaipur|Lucknow|Indore|Nagpur|Visakhapatnam|Vizag|Surat|Vadodara|Thiruvananthapuram|Thrissur|Calicut|Kozhikode)\b/i;
  const km = raw.match(known);
  if (km) return km[1];

  const commaCity = raw.match(
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),\s*(India|Tamil\s*Nadu|Karnataka|Kerala|Maharashtra)\b/
  );
  if (commaCity) return commaCity[1].replace(/\s+/g, " ");

  return null;
}

export function extractRoad(text) {
  if (!text || typeof text !== "string") return null;
  const t = text.trim();
  if (!t) return null;

  const m =
    t.match(
      /\b(?:road|street)\s*(?:width|is|of)?\s*:?\s*(\d{1,3}(?:[.,]\d+)?)\s*(m|meters?|metres?|ft|feet|')\b/i
    ) ||
    t.match(
      /\b(\d{1,3}(?:[.,]\d+)?)\s*(m|meters?|metres?|ft|feet|')\s+(?:wide\s+)?(?:road|street)\b/i
    ) ||
    t.match(/\b(\d{1,3}(?:[.,]\d+)?)\s*(?:ft|feet|m)\s+road\b/i);
  if (m) {
    const unit = m[2] ? m[2].toLowerCase() : "ft";
    const u =
      unit.startsWith("m") && !unit.startsWith("ft")
        ? "m"
        : "ft";
    return `${m[1].replace(",", ".")} ${u} (front)`;
  }

  return null;
}

export function extractType(text) {
  if (!text || typeof text !== "string") return null;
  const t = text.trim();
  if (!t) return null;

  for (const [re, fn] of TYPE_PATTERNS) {
    const m = t.match(re);
    if (m) return fn(m);
  }
  return null;
}

const WORD_TO_BHK = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/** @returns {number | null} */
export function extractBhk(text) {
  if (!text || typeof text !== "string") return null;
  const raw = text.trim();
  if (!raw) return null;
  const t = raw.toLowerCase();

  const clampBhk = (n) =>
    Number.isFinite(n) && n > 0 && n <= 20 ? n : null;

  // Digit + BHK / bedroom(s) (2BHK, 3 bhk, 4 bedrooms)
  const explicit =
    t.match(/\b(\d{1,2})\s*bhk\b/i) ||
    t.match(/\b(\d{1,2})bhk\b/i) ||
    t.match(/\b(\d{1,2})\s*(?:bedroom|bedrooms|beds?)\b/i);
  if (explicit) return clampBhk(parseInt(explicit[1], 10));

  // Word + BHK or bedrooms ("three bhk", "four bedrooms")
  const wordBedOrBhk = t.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:bhk|bedroom|bedrooms|bed|beds)\b/i
  );
  if (wordBedOrBhk) {
    const n = WORD_TO_BHK[wordBedOrBhk[1].toLowerCase()];
    if (n != null) return n;
  }

  // Short reply: only a bedroom count digit (e.g. answer "4" — avoids stealing from "30x50")
  const soloNum = raw.match(/^\s*(\d{1,2})\s*[.!?…]*\s*$/);
  if (soloNum) return clampBhk(parseInt(soloNum[1], 10));

  // Short reply: only a word number ("four")
  const soloWord = raw.match(
    /^\s*(one|two|three|four|five|six|seven|eight|nine|ten)\s*[.!?…]*\s*$/i
  );
  if (soloWord) {
    const n = WORD_TO_BHK[soloWord[1].toLowerCase()];
    if (n != null) return n;
  }

  return null;
}

/**
 * Main road / plot facing when the user states it (not inferred from city names).
 * @returns {string | null}
 */
export function extractFacing(text) {
  if (!text || typeof text !== "string") return null;
  const t = text.trim();
  if (!t) return null;
  const m = t.match(
    /\b(north\s*east|north\s*west|south\s*east|south\s*west|northeast|northwest|southeast|southwest|north|south|east|west)\s*[- ]?facing\b/i
  );
  if (m) {
    const raw = m[1].replace(/\s+/g, " ").toLowerCase();
    const cap = raw.replace(/\b\w/g, (c) => c.toUpperCase());
    return `${cap}-facing`;
  }
  const sw = t.match(/\b(ne|nw|se|sw)\s*[- ]?facing\b/i);
  if (sw) return `${sw[1].toUpperCase()}-facing`;
  if (/\bplot\s+faces?\s+(?:the\s+)?(north|south|east|west)\b/i.test(t)) {
    const mm = t.match(/\b(north|south|east|west)\b/i);
    if (mm)
      return `${mm[1][0].toUpperCase()}${mm[1].slice(1).toLowerCase()}-facing`;
  }
  return null;
}

/**
 * @returns {string | null} short token: yes / no
 */
export function extractParking(text) {
  if (!text || typeof text !== "string") return null;
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (
    /\b(no\s+parking|without\s+parking|don'?t\s+need\s+parking|no\s+car|bike\s+only)\b/i.test(
      t
    )
  ) {
    return "no";
  }
  if (
    /\bparking\b|\bgarage\b|\bstilt\b|\bcar\s+park|\b(\d)\s*(car|vehicle)s?\s*park/i.test(
      t
    )
  ) {
    return "yes";
  }
  return null;
}

/** @returns {number | null} */
export function extractFloors(text) {
  if (!text || typeof text !== "string") return null;
  const t = text.trim();
  const m1 = t.match(/\b(\d{1,2})\s*(?:floors?|storeys?|stories)\b/i);
  if (m1) {
    const n = parseInt(m1[1], 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const m2 =
    t.match(/\bG\s*\+\s*(\d{1,2})\b/i) ||
    t.match(/\bg\s*\+\s*(\d{1,2})\b/i) ||
    t.match(/\bground\s*\+\s*(\d{1,2})\b/i);
  if (m2) {
    const n = 1 + parseInt(m2[1], 10);
    return Number.isFinite(n) ? n : null;
  }
  if (/\bduplex\b/i.test(t)) return 2;
  if (/\btriplex\b/i.test(t)) return 3;
  if (
    /\b(?:single|one|ground)\s*[-\s]?(?:storey|story|floor)\b|\bonly\s*ground\s*floor\b/i.test(
      t
    )
  ) {
    return 1;
  }
  return null;
}

/** @returns {boolean | null} */
/**
 * Yes / no from a very short reply (used when the last assistant turn asked about Vastu).
 * @returns {boolean | null}
 */
export function extractBinaryYesNo(text) {
  if (!text || typeof text !== "string") return null;
  const t = text
    .trim()
    .toLowerCase()
    .replace(/[.!?…]+$/u, "")
    .trim();
  if (!t) return null;
  if (/^(yes|yeah|yep|yup|please|sure|ok|okay)\b/i.test(t)) return true;
  if (/^(no|nope|nah|not\s+really)\b/i.test(t)) return false;
  return null;
}

/** @returns {'modern'|'traditional'|'compact'|null} */
export function extractStandaloneLayoutStyle(text) {
  if (!text || typeof text !== "string") return null;
  const t = text
    .trim()
    .toLowerCase()
    .replace(/[.!?…]+$/u, "")
    .trim();
  if (!t) return null;
  const m = t.match(/^(modern|traditional|compact)\b/);
  return m && LAYOUT_STYLE_SET.has(m[1]) ? m[1] : null;
}

/**
 * Overall sketch style for the deterministic client layout engine.
 * @returns {'modern'|'traditional'|'compact'|null}
 */
export function extractLayoutStyle(text) {
  if (!text || typeof text !== "string") return null;
  const t = text.toLowerCase();
  if (
    /\b(traditional|classic|conventional|old[\s-]fashioned|courtyard[\s-]style)\b/i.test(
      t
    )
  ) {
    return "traditional";
  }
  if (
    /\b(compact|tight\s+plan|space[\s-]saving|smaller\s+footprint|dense\s+layout)\b/i.test(
      t
    )
  ) {
    return "compact";
  }
  if (
    /\b(modern|contemporary|minimal(ist)?|sleek|clean\s+lines)\b/i.test(t) ||
    /\bopen[\s-]?(concept|plan|layout)\b/i.test(t)
  ) {
    return "modern";
  }
  return null;
}

export function extractVastuPreference(text) {
  if (!text || typeof text !== "string") return null;
  if (!/\bvastu\b/i.test(text)) return null;
  const t = text.toLowerCase();
  if (
    /\b(no\s+vastu|without\s+vastu|skip\s+vastu|don'?t\s+want\s+vastu|not\s+needed|no\s+need\s+for\s+vastu)\b/i.test(
      t
    )
  ) {
    return false;
  }
  return true;
}

/**
 * Road access prose when numeric width not parsed (e.g. "front", "corner").
 * @returns {string | null}
 */
export function extractRoadInfo(text, roadWidthFromMessage) {
  if (roadWidthFromMessage) return null;
  if (!text || typeof text !== "string") return null;
  const t = text.trim();
  if (!t) return null;
  if (/^front\s*\.?$/i.test(t) || /\bfront\s+(road|facing|age|access)\b/i.test(t))
    return "Front road / frontage";
  if (/\bfront\s*$/i.test(t)) return "Front road / frontage";
  if (/\broad\s+on\s+(?:the\s+)?front\b/i.test(t)) return "Front road / frontage";
  if (/^side\s*\.?$/i.test(t) || /\b(side|lateral)\s+(road|access|plot)\b/i.test(t))
    return "Side road / side access";
  if (/\bcorner\b/i.test(t) && /\b(plot|site|road)\b/i.test(t))
    return "Corner / multi-frontage plot";
  const card = t.match(
    /\b(north\s*east|north\s*west|south\s*east|south\s*west|northeast|northwest|southeast|southwest|north|south|east|west)\s*[- ]?facing\b/i
  );
  if (card) {
    const label = card[1].replace(/\s+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
    return `${label}-facing (road / frontage context — confirm)`;
  }
  if (/\b(?:ne|nw|se|sw)\b/i.test(t) && /\b(facing|face|plot|site|road)\b/i.test(t)) {
    const m = t.match(/\b(ne|nw|se|sw)\b/i);
    if (m) return `${m[1].toUpperCase()} orientation (confirm road side)`;
  }
  if (/\b(east|west|north|south)\b/i.test(t) && /\b(face|facing)\b/i.test(t)) {
    const m = t.match(/\b(east|west|north|south)\b/i);
    if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)}-facing (confirm)`;
  }
  return null;
}

/** @returns {string[]} */
export function extractSpecialRequirements(text) {
  if (!text || typeof text !== "string") return [];
  const t = text;
  const out = [];
  const push = (label) => {
    if (label && !out.includes(label)) out.push(label);
  };
  if (/\bparking\b|car\s*park|garage\b/i.test(t)) push("Parking");
  if (/\bstilt\b/i.test(t)) push("Stilt / parking under");
  if (/\bpuja|pooja\b/i.test(t)) push("Puja room");
  if (/\b(home\s*office|study\s*room)\b/i.test(t)) push("Study / home office");
  if (/\b(lift|elevator)\b/i.test(t)) push("Lift");
  if (/\bterrace\b|roof\s*garden/i.test(t)) push("Terrace / roof use");
  return out;
}

/**
 * True when plot dimensions/area, city, and bedroom count are known.
 * @param {object} input design_state or a plain object with plot or plot_size, location, bhk
 */
export function hasEnoughToPlan(input) {
  if (!input || typeof input !== "object") return false;
  const plot = input.plot ?? input.plot_size;
  const loc = input.location;
  const bhk = input.bhk;
  return Boolean(
    plot &&
    String(plot).trim() !== "" &&
    loc &&
    String(loc).trim() !== "" &&
    bhk != null &&
    bhk !== "" &&
    Number(bhk) > 0
  );
}

/**
 * Plot + location + BHK plus Vastu yes/no and layout style — required before the app
 * starts the planning stream and builds the client floor sketch.
 */
export function hasEnoughForLayoutProfile(input) {
  if (!hasEnoughToPlan(input)) return false;
  if (input.vastu_preference !== true && input.vastu_preference !== false)
    return false;
  const ls = input.layout_style;
  return typeof ls === "string" && LAYOUT_STYLE_SET.has(String(ls).toLowerCase());
}

/** @deprecated Prefer {@link hasEnoughToPlan} — same predicate. */
export function hasPlanningCore(state) {
  return hasEnoughToPlan(state);
}

/**
 * Full requirement extraction from one user message (merged progressively in state).
 * @param {string} message
 * @param {object} [options] Reserved for future flags (currently unused).
 * @returns {{
 *   plot_size: string | null,
 *   location: string | null,
 *   building_type: string | null,
 *   bhk: number | null,
 *   floors: number | null,
 *   road_width: string | null,
 *   road_info: string | null,
 *   vastu_preference: boolean | null,
 *   layout_style: 'modern'|'traditional'|'compact'|null,
 *   special_requirements: string[],
 *   facing: string | null,
 *   parking: string | null,
 * }}
 */
export function extractRequirements(message, options = {}) {
  const road_width = extractRoad(message);
  const road_info = extractRoadInfo(message, road_width);
  const snippet = String(options.lastAssistantSnippet || "").trim();

  let vastu_preference = extractVastuPreference(message);
  if (vastu_preference === null && /\bvastu\b/i.test(snippet)) {
    const yn = extractBinaryYesNo(message);
    if (yn === true) vastu_preference = true;
    if (yn === false) vastu_preference = false;
  }

  let layout_style = extractLayoutStyle(message);
  if (!layout_style) layout_style = extractStandaloneLayoutStyle(message);
  if (
    !layout_style &&
    /\b(layout\s+style|modern|traditional|compact)\b/i.test(snippet)
  ) {
    layout_style = extractStandaloneLayoutStyle(message);
  }

  return {
    plot_size: extractPlot(message),
    location: extractLocation(message),
    road_width,
    road_info,
    building_type: extractType(message),
    bhk: extractBhk(message),
    floors: extractFloors(message),
    vastu_preference,
    layout_style,
    special_requirements: extractSpecialRequirements(message),
    facing: extractFacing(message),
    parking: extractParking(message),
  };
}

export function extractInputs(message, options = {}) {
  const r = extractRequirements(message, options);
  return {
    plot_size: r.plot_size,
    location: r.location,
    road_width: r.road_width,
    building_type: r.building_type,
  };
}

export function mergeRequirementsIntoState(prev, req) {
  if (!req || typeof req !== "object") return { ...prev };
  const next = { ...prev };
  const strOk = (v) => v != null && String(v).trim() !== "";
  for (const k of [
    "plot_size",
    "location",
    "road_width",
    "road_info",
    "building_type",
  ]) {
    const v = req[k];
    if (strOk(v)) next[k] = String(v).trim();
  }
  const bhkRaw = req.bhk;
  const bhkNum =
    typeof bhkRaw === "number"
      ? bhkRaw
      : typeof bhkRaw === "string" && String(bhkRaw).trim() !== ""
        ? Number(String(bhkRaw).trim())
        : NaN;
  if (Number.isFinite(bhkNum) && bhkNum > 0) next.bhk = bhkNum;
  if (req.floors != null && Number.isFinite(req.floors) && req.floors > 0)
    next.floors = req.floors;
  if (req.vastu_preference === true || req.vastu_preference === false)
    next.vastu_preference = req.vastu_preference;
  if (
    typeof req.layout_style === "string" &&
    LAYOUT_STYLE_SET.has(String(req.layout_style).toLowerCase())
  ) {
    next.layout_style = String(req.layout_style).toLowerCase();
  }
  if (Array.isArray(req.special_requirements) && req.special_requirements.length) {
    const merged = new Set([
      ...(Array.isArray(next.special_requirements)
        ? next.special_requirements
        : []),
      ...req.special_requirements.map((s) => String(s).trim()).filter(Boolean),
    ]);
    next.special_requirements = [...merged];
  }
  if (strOk(req.facing)) next.facing = String(req.facing).trim();
  if (strOk(req.parking)) next.parking = String(req.parking).trim();
  return next;
}

export function mergeExtractedIntoState(prev, extracted, options = {}) {
  void options;
  return mergeRequirementsIntoState(prev, extracted);
}

/**
 * Merge one user line into design state (planner extraction + progressive fields).
 * @param {object} prevState
 * @param {string} userText
 * @param {object} [options] Reserved for future flags (currently unused).
 */
export function mergeRequirementsFromMessage(prevState, userText, options = {}) {
  const extracted = extractRequirements(userText, options);
  return mergeRequirementsIntoState(prevState, extracted);
}

/** Map persisted design_state into the REQUIREMENTS-shaped view (plot → plot_size). */
export function requirementsRecordFromDesignState(state) {
  if (!state || typeof state !== "object") return { ...REQUIREMENTS };
  return {
    plot: state.plot_size ?? null,
    location: state.location ?? null,
    bhk: state.bhk ?? null,
    facing: state.facing ?? null,
    parking: state.parking ?? null,
  };
}

/**
 * One short local prompt for the next missing field (plot, city, BHK, Vastu, layout style).
 * Pass full `design_state` or a superset (plot_size or plot, location, bhk, vastu_preference, layout_style).
 * @param {typeof REQUIREMENTS | Record<string, unknown>} r
 * @returns {string | null} null when ready for planning (see {@link hasEnoughForLayoutProfile})
 */
export function getNextQuestion(r) {
  const plotRaw = r?.plot_size ?? r?.plot;
  const plot =
    plotRaw != null && String(plotRaw).trim() !== "" ? plotRaw : null;
  const loc =
    r?.location != null && String(r.location).trim() !== "" ? r.location : null;
  const bhk = r?.bhk != null && Number(r.bhk) > 0 ? r.bhk : null;
  if (!plot && !loc) {
    return "To start planning, share your plot size and location. If you want knowledge only, ask your architecture question directly.";
  }
  if (!plot) return "To continue planning, what is your plot size?";
  if (!loc) return "To continue planning, which city is your plot in?";
  if (!bhk) return "How many bedrooms are you planning?";
  if (r?.vastu_preference !== true && r?.vastu_preference !== false) {
    return "Would you like Vastu-oriented zoning (e.g. pooja toward northeast) considered? Reply yes or no.";
  }
  const ls = r?.layout_style;
  if (typeof ls !== "string" || !LAYOUT_STYLE_SET.has(String(ls).toLowerCase())) {
    return "Which layout feel should the sketch follow: modern (open / minimal), traditional (formal zones), or compact (tighter rooms)?";
  }
  return null;
}

/** @deprecated use {@link hasEnoughToPlan} */
export function hasConfirmedConsultationInputs(state) {
  return hasEnoughToPlan(state);
}

/** Legacy helper — gathering flow uses {@link hasEnoughForLayoutProfile} before planning. */
export function getNextStage(state) {
  if (state.stage === "gathering" && hasEnoughForLayoutProfile(state))
    return "planning";
  if (state.stage === "planning") return "approval";
  return state.stage;
}

export function buildConfirmMessage(state) {
  const line = (label, val) =>
    `• ${label}: ${val == null || val === "" ? "—" : val}`;
  return (
    "Here's what I have — please check each line:\n\n" +
    `${line("Plot Size", state.plot_size)}\n` +
    `${line("Location", state.location)}\n` +
    `${line("Road Width", state.road_width)}\n` +
    `${line("Building Type", state.building_type)}\n\n` +
    "Does this look right? Reply yes to continue, or tell me what to change."
  );
}

export function isAffirmative(text) {
  const t = (text || "").trim().toLowerCase();
  if (!t) return false;
  return /^(yes|yeah|yep|yup|correct|right|ok|okay|sure|proceed|go ahead|that'?s right|looks good|confirm|absolutely)\b/i.test(
    t
  );
}

export function isNegative(text) {
  const t = (text || "").trim().toLowerCase();
  if (!t) return false;
  return /^(no|nope|nah|not|wrong|incorrect|change|fix)\b/i.test(t);
}

/** User wants to see the plan in chat — not a revision request. */
export function userWantsToViewPlan(text) {
  const t = (text || "").trim().toLowerCase();
  if (!t) return false;
  if (
    /\b(show|see|view|open|display)\b[\s\S]{0,40}\b(plan|layout|floor\s*plan|2d)\b/i.test(
      t
    ) ||
    /\b(plan|layout|floor\s*plan)\b[\s\S]{0,24}\b(show|see|view|open|display)\b/i.test(
      t
    )
  ) {
    return true;
  }
  return /^\s*(plan|floor\s*plan|layout|2d(\s*plan)?)\s*[!.?…]*\s*$/i.test(t);
}

export function wantsPlanChanges(text) {
  const t = (text || "").trim().toLowerCase();
  if (userWantsToViewPlan(text)) return false;
  return (
    /\b(change|changes|revise|revision|modify|adjust|adjusted|tweak|different|redo|update)\b/i.test(
      t
    ) ||
    /\b(bigger|smaller|increase|decrease|add|remove|shift|move|moves|moving|moved|extend|reduce|reduced|reduces|more|less)\b/i.test(
      t
    ) ||
    /\b(make\s+it|change\s+to|change\s+it\s+to|switch\s+to|instead|actually)\b/i.test(
      t
    )
  );
}

function looksArchitectureKnowledgeQuestion(text) {
  const t = (text || "").trim().toLowerCase();
  if (!t) return false;
  if (userWantsToViewPlan(t) || wantsPlanChanges(t) || isAffirmative(t) || isNegative(t)) {
    return false;
  }
  if (
    /\b(cmda|dtcp|setback|fsi|far|zoning|bylaw|by-law|regulation|building\s+rule|approval)\b/i.test(
      t
    )
  ) {
    return true;
  }
  if (
    /\b(what|why|how|can|is|are|does|do)\b/i.test(t) &&
    /\b(plot|site|house|plan|layout|architecture|building|permit|rule|road|ventilation|lighting)\b/i.test(
      t
    )
  ) {
    return true;
  }
  return t.includes("?");
}

export function buildApprovalPrompt() {
  return MSG_APPROVAL_FOLLOWUP;
}

/** Shown when a floor sketch is available in the UI (not coordinate output from the model). */
export const MSG_LAYOUT_READY_CTA =
  "Your layout is ready.\n\nClick below to view your floor plan — the sketch is built on your device from the requirements we collected.";

export function buildApprovalThanks() {
  return (
    `${MSG_LAYOUT_READY_CTA}\n\n` +
    "Reply yes when you want to lock this round, or describe changes and we’ll refine the plan together."
  );
}

/** Assistant line after the user taps “Redesign” — next user message should carry edits; LLM revises prose, JS re-sketches. */
export const MSG_REDESIGN_CONVERSATION_PROMPT =
  "What would you like to redesign—room sizes, circulation, kitchen position, Vastu emphasis, or layout style (modern / traditional / compact)? Describe it in your own words; I’ll update the layout reasoning with you, and your floor sketch will refresh from your updated brief.";

export function enrichPlanningState(state) {
  const next = { ...state };
  const ok = (v) => v != null && String(v).trim() !== "";
  if (!ok(next.building_type) && next.bhk != null && next.bhk > 0) {
    next.building_type = `${next.bhk}BHK`;
  }
  if (!ok(next.road_width) && ok(next.road_info)) {
    next.road_width = next.road_info;
  }
  if (!ok(next.road_width) && !ok(next.road_info)) {
    next.road_info =
      "Front road (assumed for planning—we can refine entrance and parking when you share road width).";
  }
  return next;
}

function inputsBlock(state) {
  const s = enrichPlanningState(state);
  const dash = (v) =>
    v == null || String(v).trim() === "" ? "—" : String(v).trim();
  const spec =
    Array.isArray(s.special_requirements) && s.special_requirements.length
      ? s.special_requirements.join(", ")
      : "—";
  return (
    `Confirmed client inputs:\n` +
    `- Plot size: ${dash(s.plot_size)}\n` +
    `- Location: ${dash(s.location)}\n` +
    `- Road (width / access): ${dash(s.road_width || s.road_info)}\n` +
    `- BHK: ${s.bhk != null ? s.bhk : "—"}\n` +
    `- Facing: ${dash(s.facing)}\n` +
    `- Parking: ${dash(s.parking)}\n` +
    `- Floors: ${s.floors != null ? s.floors : "—"}\n` +
    `- Building type: ${dash(s.building_type)}\n` +
    `- Vastu: ${
      s.vastu_preference === true
        ? "preferred"
        : s.vastu_preference === false
          ? "not required"
          : "—"
    }\n` +
    `- Layout style: ${
      typeof s.layout_style === "string" &&
      LAYOUT_STYLE_SET.has(String(s.layout_style).toLowerCase())
        ? String(s.layout_style).toLowerCase()
        : "—"
    }\n` +
    `- Special requirements: ${spec}`
  );
}


export function wrapPlanningPrompt(state, priorAnalysisExcerpt) {
  const excerpt = (priorAnalysisExcerpt || "").trim().slice(0, 3500);
  return (
    `[VisionDesignie consultation — PLANNING stage]\n` +
    `${VISIONDESIGNIE_SYSTEM_IDENTITY}` +
    `${WRAPPER_FORMAT_HINT}` +
    `${CONSULTATION_FORMAT_HINT}` +
    `PLANNING TURN: Confirmed inputs below. Four sections: 📐📊 tight recap; 🏡 main layout (spatial reasoning in prose—room placement, flow, light/privacy); ❓ one forward question. Do not append PLAN_JSON, coordinates, SVG, or geometry—the client app renders the floor sketch from these facts.\n` +
    `${inputsBlock(state)}\n\n` +
    `Prior analysis (internalize; do not paste raw):\n${excerpt || "(none)"}`
  );
}

export function wrapPlanningRevisionPrompt(state, userNote, priorPlanExcerpt) {
  const planBit = (priorPlanExcerpt || "").trim().slice(0, 2500);
  return (
    `[VisionDesignie consultation — PLANNING revision]\n` +
    `${VISIONDESIGNIE_SYSTEM_IDENTITY}` +
    `${WRAPPER_FORMAT_HINT}` +
    `${CONSULTATION_FORMAT_HINT}` +
    `Client note: ${(userNote || "").trim().slice(0, 500)}\n` +
    `Address the note with deltas only; updated 🏡 in prose (no PLAN_JSON, coordinates, SVG, or geometry blocks—the client redraws the sketch from saved requirements).\n` +
    `${inputsBlock(state)}\n\n` +
    `Earlier plan (internalize; do not quote verbatim):\n${planBit || "(none)"}`
  );
}

/**
 * Decide how to handle this user turn.
 * @param {string} [lastAssistantContent] Latest assistant reply (for plan revisions).
 * @param {object} mergedState Result of {@link mergeRequirementsFromMessage} for this turn (caller merges once).
 * @returns {{ kind: 'local', assistantText: string, nextState: object } | { kind: 'remote', messageToModel: string, nextState: object, phase: 'planning' | 'knowledge', planningBridgeFromGathering?: boolean }}
 */
export function planConsultationTurn(
  prevState,
  userText,
  lastAssistantContent = "",
  mergedState
) {
  // NOTE: planner chats only. Gathering uses {@link getNextQuestion} until {@link hasEnoughForLayoutProfile}; then planning stream.
  const priorPlan =
    typeof lastAssistantContent === "string" ? lastAssistantContent : "";

  const merged = mergedState;

  if (prevState.stage === "approval") {
    if (userWantsToViewPlan(userText)) {
      return {
        kind: "local",
        assistantText: MSG_LAYOUT_READY_CTA,
        nextState: { ...prevState },
      };
    }
    if (wantsPlanChanges(userText)) {
      return {
        kind: "remote",
        messageToModel: wrapPlanningRevisionPrompt(
          merged,
          userText,
          priorPlan
        ),
        nextState: { ...merged, stage: "planning" },
        phase: "planning",
      };
    }
    if (isAffirmative(userText)) {
      return {
        kind: "local",
        assistantText: buildApprovalThanks(),
        nextState: { ...merged, stage: "complete" },
      };
    }
    if (looksArchitectureKnowledgeQuestion(userText)) {
      return {
        kind: "remote",
        messageToModel: userText,
        nextState: { ...prevState },
        phase: "knowledge",
      };
    }
    return {
      kind: "local",
      assistantText:
        "For planning approval, reply with a clear yes to proceed, or tell me what you'd like to change. You can also ask architecture knowledge questions any time.",
      nextState: { ...prevState },
    };
  }

  if (prevState.stage === "planning") {
    return {
      kind: "local",
      assistantText:
        "Hang on — the layout reply is still finishing. If this persists, wait a moment and send your message again.",
      nextState: { ...prevState },
    };
  }

  if (prevState.stage === "complete") {
    if (wantsPlanChanges(userText)) {
      return {
        kind: "remote",
        messageToModel: wrapPlanningRevisionPrompt(
          merged,
          userText,
          priorPlan
        ),
        nextState: { ...merged, stage: "planning" },
        phase: "planning",
      };
    }
    if (userWantsToViewPlan(userText)) {
      return {
        kind: "local",
        assistantText:
          "Your plan is ready.\n\nScroll up in this chat to see the latest suggested layout and notes.",
        nextState: { ...prevState },
      };
    }
    if (looksArchitectureKnowledgeQuestion(userText)) {
      return {
        kind: "remote",
        messageToModel: userText,
        nextState: { ...prevState },
        phase: "knowledge",
      };
    }
    return {
      kind: "local",
      assistantText:
        "Your plan is finalized. Scroll up to review it in chat, or tell me what you'd like to adjust.",
      nextState: { ...prevState },
    };
  }

  const gatheringStages = new Set([
    "gathering",
    "collecting",
    "confirm",
  ]);
  const st = prevState.stage;
  const inGatheringFlow =
    gatheringStages.has(st) ||
    /^collecting_/.test(String(st || ""));

  if (inGatheringFlow) {
    if (hasEnoughForLayoutProfile(merged)) {
      const planState = enrichPlanningState(merged);
      return {
        kind: "remote",
        messageToModel: wrapPlanningPrompt(planState, ""),
        nextState: { ...planState, stage: "planning" },
        phase: "planning",
        planningBridgeFromGathering: true,
      };
    }
    if (looksArchitectureKnowledgeQuestion(userText)) {
      return {
        kind: "remote",
        messageToModel: userText,
        nextState: { ...merged, stage: "gathering" },
        phase: "knowledge",
      };
    }
    const q = getNextQuestion(merged) ?? "What is your plot size and location?";
    return {
      kind: "local",
      assistantText: q,
      nextState: { ...merged, stage: "gathering" },
    };
  }

  if (hasEnoughForLayoutProfile(merged)) {
    const planState = enrichPlanningState(merged);
    return {
      kind: "remote",
      messageToModel: wrapPlanningPrompt(planState, ""),
      nextState: { ...planState, stage: "planning" },
      phase: "planning",
      planningBridgeFromGathering: true,
    };
  }
  return {
    kind: "local",
    assistantText:
      getNextQuestion(merged) ?? "What is your plot size and location?",
    nextState: { ...merged, stage: "gathering" },
  };
}

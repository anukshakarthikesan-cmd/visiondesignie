/**
 * Drop paragraphs that look like echoed consultation briefs (plot/location bullets, internal gap lines).
 * @param {string} text
 */
function stripLeakedConsultationScaffold(text) {
  if (!text || typeof text !== "string") return text;
  const INTERNAL_BULLET =
    /^-\s*(Plot size|Location|Road|BHK:|Floors:|Building|Vastu|Special notes|Special requirements)\b/i;
  const isGapMeta = (line) => {
    const t = line.trim();
    if (!t) return false;
    if (/^App sufficiency:/i.test(t)) return true;
    if (/^Still missing before we can draft/i.test(t)) return true;
    if (/^Internal:\s*(plot|still need)/i.test(t)) return true;
    if (/^Internal(?:\s+gaps)?\b/i.test(t)) return true;
    return false;
  };
  const isLeakedHeader = (line) => {
    const t = line.trim();
    return (
      /^(What we already have|INTERNAL BRIEF)\b/i.test(t) ||
      /^Confirmed client inputs:/i.test(t) ||
      /^Prior analysis \(internalize/i.test(t) ||
      /^Earlier plan \(internalize/i.test(t)
    );
  };

  const chunks = text.split(/\n{2,}/);
  const kept = [];
  for (const chunk of chunks) {
    const t = chunk.trim();
    if (!t) continue;
    const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    if (isLeakedHeader(lines[0])) continue;
    if (lines.length === 1 && isGapMeta(lines[0])) continue;
    if (lines.every((l) => INTERNAL_BULLET.test(l) || isGapMeta(l))) continue;
    kept.push(chunk.trim());
  }
  return kept.join("\n\n").trim();
}

/**
 * Remove common instruction echoes so chat bubbles stay client-facing.
 * @param {string} text
 */
export function stripAssistantPromptLeakage(text) {
  if (!text || typeof text !== "string") return text;
  let s = text;

  s = s.replace(
    /^\s*\[[^\]\n]*(?:VisionDesignie|Architect mode|Learning mode|Architect consultation)[^\]\n]*\]\s*\n*/gim,
    ""
  );
  s = s.replace(/^\s*\[Conversation memory[^\]\n]*\]\s*\n*/gim, "");
  s = s.replace(
    /◆\s*Please answer only the following user message[^\n]*\n*/gi,
    ""
  );
  s = s.replace(/^\s*User message:\s*\n*/gim, "");
  s = s.replace(/^---+\s*User Query\s*---+$/gim, "");
  s = s.replace(/^---+$/gm, "");
  s = s.replace(/\bNot specified\b/gi, "—");
  s = s.replace(/^\s*3D\s+MODELS?:.*$/gim, "");
  s = s.replace(
    /^\s*FAISS\s+RAG\s+SNIPPETS\s*\r?\n(?:^\s*-.*\r?\n|^\s*\r?\n)*/gim,
    ""
  );
  s = stripLeakedConsultationScaffold(s);
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

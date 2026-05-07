import { useEffect, useMemo, useState } from "react";
import { splitPlanJsonFromMessage } from "../lib/extractPlanJson";
import { stripAssistantPromptLeakage } from "../lib/sanitizeAssistantReply";
import "./ArchitectMessageContent.css";

/** Only the four consultation headers â€” other emojis in prose must stay plain (avoids â€œrandomâ€ structured cards). */
const SECTION_RE = /^(ðŸ“|ðŸ“Š|ðŸ¡|â“)\s*(.+)$/u;

/**
 * UI-only: break very long plain prose into 2â€“3+ short paragraphs at sentence boundaries
 * (does not change stored message text).
 */
function softParagraphBreaks(raw) {
  const text = (raw || "").trim();
  if (!text) return text;
  if (text.includes("\n\n")) return text;
  if (text.length < 260) return text;
  if (/PLAN_JSON\s*:/i.test(text)) return text;
  const chunks = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (chunks.length < 2) return text;
  const paras = [];
  let acc = "";
  const maxRun = 420;
  for (const c of chunks) {
    const piece = c.trim();
    if (!piece) continue;
    const next = acc ? `${acc} ${piece}` : piece;
    if (next.length > maxRun && acc) {
      paras.push(acc.trim());
      acc = piece;
    } else {
      acc = next;
    }
  }
  if (acc) paras.push(acc.trim());
  if (paras.length < 2) return text;
  return paras.slice(0, 6).join("\n\n");
}

function parseBlocks(text) {
  if (!text || !text.trim()) return [];
  const lines = text.split("\n");
  const blocks = [];
  let preamble = [];
  let i = 0;

  const flushPreamble = () => {
    const t = preamble.join("\n").trim();
    if (t) blocks.push({ type: "text", content: t });
    preamble = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(SECTION_RE);
    if (m) {
      flushPreamble();
      const title = `${m[1]} ${m[2]}`.trim();
      i += 1;
      const bodyLines = [];
      while (i < lines.length && !SECTION_RE.test(lines[i])) {
        bodyLines.push(lines[i]);
        i += 1;
      }
      blocks.push({
        type: "section",
        title,
        body: bodyLines.join("\n").trim(),
      });
    } else {
      preamble.push(line);
      i += 1;
    }
  }
  flushPreamble();
  return blocks;
}

function BodyLines({ body }) {
  if (!body) return null;
  const lines = body.split("\n");
  const items = [];
  let para = [];
  const flushPara = () => {
    if (para.length) {
      items.push({ kind: "p", text: para.join(" ").trim() });
      para = [];
    }
  };
  for (const line of lines) {
    const bullet = line.match(/^[-â€¢*]\s+(.+)$/);
    if (bullet) {
      flushPara();
      items.push({ kind: "li", text: bullet[1].trim() });
    } else if (line.trim() === "") {
      flushPara();
    } else {
      para.push(line.trim());
    }
  }
  flushPara();

  const nodes = [];
  let list = [];
  const flushList = () => {
    if (list.length) {
      nodes.push(
        <ul key={nodes.length} className="chat-section-list architect-card__list">
          {list.map((t, j) => (
            <li key={j}>{t}</li>
          ))}
        </ul>
      );
      list = [];
    }
  };
  for (const it of items) {
    if (it.kind === "li") {
      list.push(it.text);
    } else {
      flushList();
      if (it.text) {
        nodes.push(
          <p key={nodes.length} className="chat-section-para architect-card__para">
            {it.text}
          </p>
        );
      }
    }
  }
  flushList();
  return nodes.length ? (
    nodes
  ) : (
    <p className="chat-section-para architect-card__para">{body}</p>
  );
}

export default function ArchitectMessageContent({ content, animateTyping = false }) {
  const { displayText } = useMemo(() => {
    const { displayText: raw } = splitPlanJsonFromMessage(content ?? "");
    return {
      displayText: stripAssistantPromptLeakage(raw),
    };
  }, [content]);
  const [animatedText, setAnimatedText] = useState(displayText);

  useEffect(() => {
    if (!animateTyping) return;
    if (!displayText) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      if (cancelled) return;
      setAnimatedText((prev) => {
        const safePrev = displayText.startsWith(prev) ? prev : "";
        if (safePrev.length >= displayText.length) {
          window.clearInterval(timer);
          return displayText;
        }
        const nextLen = Math.min(displayText.length, safePrev.length + 3);
        return displayText.slice(0, nextLen);
      });
    }, 16);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [displayText, animateTyping]);

  const renderedText = animateTyping ? animatedText : displayText;

  const blocks = useMemo(() => parseBlocks(renderedText), [renderedText]);

  const plainBody = useMemo(
    () => softParagraphBreaks(renderedText),
    [renderedText]
  );

  const renderPlain = (body) => {
    if (!body?.trim()) return null;
    const paras = body.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
    if (paras.length <= 1) {
      return (
        <div className="architect-plain" data-assistant-layout="plain">
          {paras[0] ?? body}
        </div>
      );
    }
    return (
      <div
        className="architect-plain architect-plain--stack"
        data-assistant-layout="plain"
      >
        {paras.map((p, i) => (
          <p key={i} className="architect-plain__para">
            {p}
          </p>
        ))}
      </div>
    );
  };

  if (blocks.length === 0) {
    return plainBody ? renderPlain(plainBody) : null;
  }

  const hasSections = blocks.some((b) => b.type === "section");

  if (!hasSections) {
    return renderPlain(plainBody);
  }

  return (
    <div className="architect-message" data-assistant-layout="structured">
      {blocks.map((b, idx) =>
        b.type === "text" && b.content ? (
          <div key={idx} className="architect-plain-lead">
            {renderPlain(softParagraphBreaks(b.content))}
          </div>
        ) : b.type === "section" ? (
          <article key={idx} className="chat-section architect-card">
            <h4 className="chat-section-title architect-card__title">{b.title}</h4>
            <div className="chat-section-body architect-card__body">
              <BodyLines body={b.body} />
            </div>
          </article>
        ) : null
      )}
    </div>
  );
}


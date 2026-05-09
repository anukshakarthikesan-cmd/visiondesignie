"""
RAG chat pipeline for VisionDesignie.

Flow (each user message):
  1. Retrieve context from FAISS using the clean user line (``user_input`` when provided, else tail of ``message``).
  2. Optionally append labeled fallback when retrieval is thin and the query looks regulatory.
  3. Build prompt: persona + mode (natural reply vs structured consultation) + optional history + Context + user message.
  4. Stream from Groq; post-process enforces four sections only for analysis/planning; general chat stays natural (no machine-readable layout JSON).

The HTTP API sends a single message string to the model (no separate messages[] API roles);
sections in the prompt are named explicitly so operators can treat them as system vs user vs RAG context.
"""

import json
import logging
import os
import re
import threading
import time
import uuid
from typing import Any, Iterator, Literal

from app.core.config import GROQ_API_KEY, RAG_RETRIEVAL_DEBUG
from app.services.fallback_knowledge import FALLBACK_HEADER, FALLBACK_KNOWLEDGE
from app.services.rag_metrics_supabase import (
    fetch_recent_messages_for_rag_history,
    fetch_user_id_for_chat,
    insert_rag_query_metrics_row,
    is_metrics_enabled,
)
logger = logging.getLogger(__name__)

# Lazy singletons: avoid heavy model/index loading during module import.
# This lets Uvicorn bind $PORT quickly on Render, then load on first chat request.
_vectorstore = None
_llm = None
_init_lock = threading.Lock()


def _get_vectorstore():
    global _vectorstore
    if _vectorstore is None:
        with _init_lock:
            if _vectorstore is None:
                logger.info("Loading FAISS vector store...")
                from app.services.vector_store import load_vector_store

                _vectorstore = load_vector_store()
    return _vectorstore


def _get_llm():
    global _llm
    if _llm is None:
        with _init_lock:
            if _llm is None:
                logger.info("Initializing Groq chat model...")
                from langchain_groq import ChatGroq

                _llm = ChatGroq(
                    api_key=GROQ_API_KEY,
                    model="llama-3.1-8b-instant",
                )
    return _llm


def get_llm():
    """Shared Groq client (lazy singleton). Safe for callers like ``chat_title``."""
    return _get_llm()


def prewarm_rag() -> None:
    """
    Best-effort warm-up to reduce time-to-first-token on hosted cold starts.
    Runs in a background thread from FastAPI lifespan so the server can bind PORT first.
    """
    try:
        _get_llm()
    except Exception:
        logger.exception("prewarm_rag: llm init failed")
    # FAISS preload can be memory-heavy on small instances; keep it opt-in.
    if (os.getenv("PREWARM_VECTORSTORE") or "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    ):
        try:
            _get_vectorstore()
        except Exception:
            logger.exception("prewarm_rag: vectorstore init failed")


SMALL_TALK = [
    "hi",
    "hii",
    "hiii",
    "hiiii",
    "hai",
    "hello",
    "helloo",
    "hey",
    "heyy",
    "hey there",
    "hey hii",
    "hey hi",
    "hey hello",
    "how are you",
    "gm",
    "gn",
]

# Early replies for “what can you do?” style prompts — same mindset as THREAD BEHAVIOR.
_PLANNER_CAPABILITIES_REPLY = (
    "I can do both: plan your project from your site brief, and answer architecture knowledge questions. "
    "For planning, share plot size + location + BHK in one line."
)

# ✅ Per-chat memory (isolates threads; chat_id from client should be unique per Supabase chat)
# ~4 turns (user+assistant); keeps Groq prompt smaller without dropping recent context.
_MAX_HISTORY_MESSAGES = 8
# Cap each stored turn length so a single huge PLAN_JSON paste does not blow TPM.
_HISTORY_MESSAGE_MAX_CHARS = 1200

chat_histories: dict[str, list[dict[str, str]]] = {}

# Retrieved RAG text injected into the prompt (fallback appended inside this budget).
MAX_CONTEXT_CHARS = 1600

# Append illustrative fallback only when RAG is very thin AND the user query looks regulatory.
_FALLBACK_RAG_MAX_LEN = 200
_REGULATORY_FALLBACK_KEYWORDS = ("fsi", "setback", "zoning", "regulation")


def _should_append_fallback(docs: list, rag: str, query: str) -> bool:
    ql = (query or "").lower()
    if not any(kw in ql for kw in _REGULATORY_FALLBACK_KEYWORDS):
        return False
    if len(rag.strip()) >= _FALLBACK_RAG_MAX_LEN:
        return False
    return True


def _doc_source_label(doc: Any) -> str:
    meta = getattr(doc, "metadata", {}) or {}
    source = str(meta.get("source", "unknown"))
    page = meta.get("page", None)
    if page is None:
        return source
    return f"{source}#p{page}"


def _safe_preview(text: str, max_chars: int = 180) -> str:
    t = re.sub(r"\s+", " ", (text or "")).strip()
    if len(t) <= max_chars:
        return t
    return t[: max_chars - 1].rstrip() + "…"


def _tokenize_for_overlap(text: str) -> set[str]:
    toks = re.findall(r"[a-zA-Z][a-zA-Z0-9]{2,}", (text or "").lower())
    return {t for t in toks if t not in {"what", "which", "where", "when", "how", "why", "with", "from"}}


def _best_doc_query_overlap(clean_query: str, docs: list[Any]) -> float:
    q = _tokenize_for_overlap(clean_query)
    if not q or not docs:
        return 0.0
    best = 0.0
    for doc in docs[:3]:
        d = _tokenize_for_overlap(getattr(doc, "page_content", "")[:1200])
        if not d:
            continue
        overlap = len(q & d) / max(1, len(q))
        if overlap > best:
            best = overlap
    return best


def _log_retrieval_debug(clean_query: str, docs: list[Any]) -> None:
    if not RAG_RETRIEVAL_DEBUG:
        return
    if not docs:
        logger.info("rag_debug query=%r docs=0", clean_query)
        return
    rows = []
    for i, doc in enumerate(docs[:3], start=1):
        src = _doc_source_label(doc)
        preview = _safe_preview(getattr(doc, "page_content", ""))
        rows.append(f"{i}. {src} :: {preview}")
    logger.info("rag_debug query=%r docs=%d\n%s", clean_query, len(docs), "\n".join(rows))

_WELCOME = (
    "For planning, share plot details.\n"
    "For guidance, ask any questions."
)

# --- Structured output post-processing (RAG pipeline only; retrieval unchanged) ---

_RE_SITE = re.compile(r"📐\s*Site Analysis", re.IGNORECASE)
_RE_REG = re.compile(r"📊\s*Regulations", re.IGNORECASE)
_RE_PLAN = re.compile(r"🏡\s*Suggested Plan", re.IGNORECASE)
_RE_NEXT = re.compile(r"❓\s*Next Step", re.IGNORECASE)

_BLOCK_SITE = """📐 Site Analysis:

- Which city or area is the plot in?
- What are the plot dimensions or total area?
- What is the front road width (if you know it)?"""

_BLOCK_REG = """📊 Regulations:

- FSI / coverage: typical range for this city and plot scale (from Context + sound judgment).
- Floors allowed: align with FSI, setbacks, and the stated program.
- Setbacks: practical front/side/rear setbacks for the road width and typology (from Context + norms)."""

_BLOCK_PLAN = """🏡 Suggested Plan:

- What should the ground floor prioritize (living, kitchen, parking)?
- What do you want on upper floors, if any?
- Any must-haves (bedrooms, stair, utility)?"""

_BLOCK_NEXT = """❓ Next Step:

- What single detail can you share next so I can narrow this down — plot size, location, front road, or building type?"""

_FALLBACK_FULL = f"""{_BLOCK_SITE}

{_BLOCK_REG}

{_BLOCK_PLAN}

{_BLOCK_NEXT}"""

_RESPONSE_SHAPE_TEMPLATE = """📐 Site Analysis:

- Location:
- Plot Size:
- Road Width:

📊 Regulations:

- FSI:
- Floors Allowed:
- Setbacks:

🏡 Suggested Plan:

- Ground Floor:
- First Floor:
- Notes:

❓ Next Step:

- (Exactly one question ending with ?.)"""

_CONVERSATIONAL_FALLBACK = (
    "Plot size (or total area) and city or area—one line when you can."
)


def _normalize_bullet_lines(text: str) -> str:
    """Ensure list lines use '- ' (also normalize • and * bullets)."""
    lines = text.split("\n")
    out = []
    for line in lines:
        stripped = line.lstrip()
        if re.match(r"^[•*]\s+", stripped):
            indent = line[: len(line) - len(stripped)]
            rest = re.sub(r"^[•*]\s+", "", stripped)
            out.append(f"{indent}- {rest}")
        elif stripped.startswith("-") and not stripped.startswith("- "):
            indent = line[: len(line) - len(stripped)]
            out.append(f"{indent}- {stripped[1:].lstrip()}")
        else:
            out.append(line)
    return "\n".join(out)


def _normalize_headers(text: str) -> str:
    """Map common header variants to canonical emoji headers."""
    t = text
    subs: list[tuple[re.Pattern[str], str]] = [
        (
            re.compile(r"^(\s*)Site Analysis\s*:", re.MULTILINE | re.IGNORECASE),
            r"\1📐 Site Analysis:",
        ),
        (
            re.compile(r"^(\s*)📐\s*Site\s*Analysis\s*$", re.MULTILINE | re.IGNORECASE),
            r"\1📐 Site Analysis:",
        ),
        (
            re.compile(r"^(\s*)Regulations\s*:", re.MULTILINE | re.IGNORECASE),
            r"\1📊 Regulations:",
        ),
        (
            re.compile(r"^(\s*)📊\s*Regulations\s*$", re.MULTILINE | re.IGNORECASE),
            r"\1📊 Regulations:",
        ),
        (
            re.compile(r"^(\s*)Suggested Plan\s*:", re.MULTILINE | re.IGNORECASE),
            r"\1🏡 Suggested Plan:",
        ),
        (
            re.compile(r"^(\s*)🏡\s*Suggested\s*Plan\s*$", re.MULTILINE | re.IGNORECASE),
            r"\1🏡 Suggested Plan:",
        ),
        (
            re.compile(r"^(\s*)Next Step\s*:", re.MULTILINE | re.IGNORECASE),
            r"\1❓ Next Step:",
        ),
        (
            re.compile(r"^(\s*)❓\s*Next\s*Step\s*$", re.MULTILINE | re.IGNORECASE),
            r"\1❓ Next Step:",
        ),
    ]
    for pat, repl in subs:
        t = pat.sub(repl, t)
    return t


def _has_all_canonical_sections(text: str) -> bool:
    return bool(
        _RE_SITE.search(text)
        and _RE_REG.search(text)
        and _RE_PLAN.search(text)
        and _RE_NEXT.search(text)
    )


def _has_structured_headers(text: str) -> bool:
    return bool(
        _RE_SITE.search(text)
        or _RE_REG.search(text)
        or _RE_PLAN.search(text)
        or _RE_NEXT.search(text)
    )


def _append_missing_sections(text: str, fixes: list[str]) -> str:
    t = text.rstrip()
    if not _RE_SITE.search(t):
        fixes.append("appended missing 📐 Site Analysis")
        t = f"{t}\n\n{_BLOCK_SITE}" if t else _BLOCK_SITE
    if not _RE_REG.search(t):
        fixes.append("appended missing 📊 Regulations")
        t = f"{t}\n\n{_BLOCK_REG}"
    if not _RE_PLAN.search(t):
        fixes.append("appended missing 🏡 Suggested Plan")
        t = f"{t}\n\n{_BLOCK_PLAN}"
    if not _RE_NEXT.search(t):
        fixes.append("appended missing ❓ Next Step")
        t = f"{t}\n\n{_BLOCK_NEXT}"
    return t


def _strip_trailing_plan_json_reply(text: str) -> str:
    """Remove trailing PLAN_JSON (requirements / concept turns must not persist layout JSON)."""
    main, _frag = _split_plan_json_suffix(text or "")
    return main.strip()


def _split_plan_json_suffix(raw: str) -> tuple[str, str | None]:
    """
    If the tail contains ``PLAN_JSON:`` followed by a JSON object, return
    (text_before, json_object_string). Otherwise (raw, None).
    Uses brace matching so nested objects in ``rooms`` are handled.
    """
    s = raw or ""
    matches = list(re.finditer(r"(?ms)^\s*PLAN_JSON:\s*", s))
    if not matches:
        return s, None
    m = matches[-1]
    prefix = s[: m.start()].rstrip()
    rest = s[m.end() :].lstrip()
    if not rest.startswith("{"):
        return s, None
    depth = 0
    end = -1
    for i, c in enumerate(rest):
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end < 0:
        return s, None
    return prefix, rest[:end].strip()


def post_process_assistant_response(
    raw: str, phase: Literal["analysis", "planning", "none"]
) -> tuple[str, list[str]]:
    """
    Normalize four architect sections; strip any accidental trailing PLAN_JSON (not used in UI).
    """
    all_fixes: list[str] = []
    if phase == "planning":
        main = _strip_trailing_plan_json_reply(raw)
        processed, fixes = post_process_structured_response(main, phase="planning")
        all_fixes.extend(fixes)
        _, json_frag = _split_plan_json_suffix(raw or "")
        if json_frag:
            all_fixes.append("stripped trailing PLAN_JSON from planning reply")
        return processed.strip(), all_fixes
    return post_process_structured_response(raw, phase=phase)


def _strip_rag_and_prompt_echo(text: str) -> str:
    """
    Remove leaked RAG dataset lines (VISIONDESIGNIE headers, numbered sample lines)
    and model echoes of "--- User Query ---" blocks so users do not see prompt junk.
    """
    if not text or not text.strip():
        return text
    lines = text.splitlines()
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if re.match(r"(?i)^---\s*User\s+Query\s*---\s*$", stripped):
            i += 1
            while i < len(lines) and lines[i].strip() != "":
                i += 1
            continue
        if re.match(r"(?i)^-+\s*User\s+Query\s*-+\s*$", stripped):
            i += 1
            while i < len(lines) and lines[i].strip() != "":
                i += 1
            continue
        if re.search(r"(?i)VISIONDESIGNIE\s*[—–\-]", line):
            i += 1
            continue
        if re.match(r"(?i)^\s*\d+\s*:\s*", line) and re.search(
            r"(?i)(BEDROOM|SQ\.?\s*FT|SQFT|PLOT|FLOOR\s*PLAN|GARAGE|PARKING|MASTER)",
            line,
        ):
            i += 1
            continue
        if re.match(r"(?i)^FAISS\s+RAG\s+SNIPPETS\s*$", stripped):
            i += 1
            while i < len(lines) and (
                lines[i].strip().startswith("-") or lines[i].strip() == ""
            ):
                i += 1
            continue
        if re.match(r"(?i)^3D\s+MODELS?:", stripped):
            i += 1
            continue
        out.append(line)
        i += 1
    s = "\n".join(out).strip()
    paras = [p.strip() for p in re.split(r"\n{2,}", s) if p.strip()]
    if len(paras) < 2:
        return s
    deduped: list[str] = []
    prev_key: str | None = None
    for p in paras:
        key = p[:240]
        if key == prev_key:
            continue
        deduped.append(p)
        prev_key = key
    return "\n\n".join(deduped)


def post_process_structured_response(
    raw: str,
    phase: Literal["analysis", "planning", "none"] = "none",
) -> tuple[str, list[str]]:
    """
    Consultation phases: normalize and ensure all four sections exist.
    General phase: preserve short conversational replies without forcing sections.
    """
    fixes: list[str] = []
    text = _strip_rag_and_prompt_echo((raw or "").strip())
    if text != (raw or "").strip():
        fixes.append("stripped RAG/prompt echo lines")

    if phase == "none":
        if not text or len(text) < 4:
            fixes.append("empty → conversational fallback")
            logger.info("structured_post_process: %s", "; ".join(fixes))
            return _CONVERSATIONAL_FALLBACK, fixes
        fixes.append("general mode — natural reply, no section enforcement")
        logger.info("structured_post_process: %s", "; ".join(fixes))
        return text.strip(), fixes

    if not text or len(text) < 8:
        fixes.append("empty or trivial response → full fallback template")
        logger.info("structured_post_process: %s", "; ".join(fixes))
        return _FALLBACK_FULL.strip(), fixes

    text = _normalize_bullet_lines(text)
    if text != (raw or "").strip():
        fixes.append("normalized bullet markers (•/* → - )")

    before_headers = text
    text = _normalize_headers(text)
    if text != before_headers:
        fixes.append("normalized section headers to canonical emoji form")

    text = _append_missing_sections(text, fixes)

    if not _has_all_canonical_sections(text):
        fixes.append("sections still incomplete after append → full fallback")
        logger.info("structured_post_process: %s", "; ".join(fixes))
        return _FALLBACK_FULL.strip(), fixes

    if fixes:
        logger.info("structured_post_process: %s", "; ".join(fixes))
    return text.strip(), fixes


def _emit_stream_suffix(streamed: str, final: str) -> Iterator[str]:
    """Emit extra SSE chunks so the client sees the same `final` as stored in memory."""
    if final == streamed:
        return
    if final.startswith(streamed):
        extra = final[len(streamed) :]
        if extra:
            fixes_note = "structured_post_process: emitting suffix after stream"
            logger.info(fixes_note)
            yield _format_sse({"chunk": extra})
        return
    # Prefix differed (e.g. header normalization changed early text): append full corrected body
    fixes_note = (
        "structured_post_process: prefix differed from stream — emitting separator + full fix"
    )
    logger.warning(fixes_note)
    yield _format_sse({"chunk": "\n\n──\n\n" + final})


def _tail_after_current_request(q: str) -> str:
    """Text after `Current request:` (any line ending / CRLF). Whole prompt if marker missing."""
    qn = (q or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    m = re.search(r"Current request:\s*", qn, re.IGNORECASE)
    if m:
        return qn[m.end() :].strip()
    return qn


def _last_non_empty_line(q: str) -> str:
    """Last non-empty line of the *user* tail (after Current request:), not of the full prompt."""
    tail = _tail_after_current_request(q)
    lines = [ln.strip() for ln in tail.split("\n") if ln.strip()]
    return lines[-1] if lines else ""


def _is_small_talk(q: str) -> bool:
    tail = _last_non_empty_line(q)
    if not tail:
        return False
    t = tail.lower().rstrip("!.?…").strip()
    return t in SMALL_TALK


def _single_line_greeting_token(s: str) -> bool:
    s = (s or "").strip().lower().rstrip("!.?…").strip()
    if not s or len(s) > 28:
        return False
    if s in SMALL_TALK:
        return True
    if re.fullmatch(r"h+i+", s):
        return True
    if re.fullmatch(r"hey+", s):
        return True
    if re.fullmatch(r"hello+", s):
        return True
    if re.fullmatch(r"hai+", s):
        return True
    return False


def _line_is_trivial_greeting(user_turn: str) -> bool:
    """
    User turn is only a short greeting (one non-empty line). Skips LLM+RAG so retrieval
    cannot invent plot/sqft from unrelated snippets on a new chat.
    """
    t = (user_turn or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    lines = [ln.strip() for ln in t.split("\n") if ln.strip()]
    if len(lines) != 1:
        return False
    return _single_line_greeting_token(lines[0])


def _is_planner_capabilities_meta(user_line: str) -> bool:
    """Short meta questions about the assistant — not a project brief (planner only)."""
    u = (user_line or "").strip().lower()
    if not u or len(u) > 200:
        return False
    if re.search(r"\b(how can you|how could you)\s+(help|assist)\b", u):
        return True
    if re.search(r"\bwhat can you\s+(do|help)\b", u):
        return True
    if re.search(r"\b(how do you work|what do you do|who are you)\b", u):
        return True
    if re.search(
        r"\b(capabilities|what are you for|what is this (chat|for))\b", u
    ):
        return True
    return False


def _history_storage_key(chat_id: str | None) -> str:
    if chat_id is None:
        return "__no_chat__"
    key = str(chat_id).strip()
    return key if key else "__no_chat__"


def _get_or_create_history(chat_id: str | None) -> list[dict[str, str]]:
    key = _history_storage_key(chat_id)
    if key not in chat_histories:
        chat_histories[key] = []
        if key != "__no_chat__" and is_metrics_enabled():
            raw_id = (chat_id or "").strip()
            seeded = fetch_recent_messages_for_rag_history(
                raw_id,
                limit=_MAX_HISTORY_MESSAGES,
                content_max_chars=_HISTORY_MESSAGE_MAX_CHARS,
            )
            if seeded:
                chat_histories[key].extend(seeded)
    return chat_histories[key]


def _truncate_for_prompt(text: str, max_chars: int) -> str:
    t = (text or "").strip()
    if len(t) <= max_chars:
        return t
    return t[: max_chars - 1].rstrip() + "…"


def _format_history_for_prompt(history: list[dict[str, str]]) -> str:
    """Last few turns as User:/Assistant: lines (capped per message for TPM)."""
    lines: list[str] = []
    cap = _HISTORY_MESSAGE_MAX_CHARS
    for msg in history[-8:]:
        role = msg.get("role", "")
        raw = (msg.get("content") or "").strip()
        content = _truncate_for_prompt(raw, cap)
        if role == "user":
            lines.append(f"User: {content}")
        elif role == "assistant":
            lines.append(f"Assistant: {content}")
    return "\n".join(lines)


def _client_inlined_conversation_history(query: str) -> bool:
    """Frontend sends last turns inside the message; avoid duplicating server memory."""
    return (query or "").lstrip().startswith("Previous conversation:")


def _history_text_for_prompt(query: str, history: list[dict[str, str]]) -> str:
    if _client_inlined_conversation_history(query):
        return (
            "Use only the conversation provided above. Do not assume additional history."
        )
    return _format_history_for_prompt(history)


def _user_turn_for_server_log(query: str, user_input: str | None = None) -> str:
    """
    Short line for RAG + server memory: prefer explicit ``user_input`` from the client
    (original typed line when ``query`` is a wrapper); else tail after ``Current request:``;
    else last non-empty line of ``query``.
    """
    explicit = (user_input or "").strip()
    if explicit:
        return explicit
    if not query:
        return ""
    qn = (query or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    matches = list(re.finditer(r"(?i)Current request:\s*", qn))
    if matches:
        return qn[matches[-1].end() :].strip()
    lines = [ln.strip() for ln in qn.split("\n") if ln.strip()]
    return lines[-1] if lines else ""


def _normalize_consultation_marker(text: str) -> str:
    """Normalize dashes so bracket markers match despite en-dash vs hyphen."""
    return (
        text.replace("\u2014", "-")
        .replace("\u2013", "-")
        .replace("—", "-")
        .lower()
    )


def _detect_consultation_phase(query: str) -> Literal["analysis", "planning", "none"]:
    """
    Frontend sends bracketed markers; flow controls stage. LLM follows stage-only behavior.
    Accepts legacy `[Architect consultation — …]` and product `[VisionDesignie consultation — …]`.
    Unknown sub-tags (e.g. requirements conversation) fall through to ``none`` — natural RAG mode.
    """
    if not query or not query.strip():
        return "none"
    n = _normalize_consultation_marker(query)
    if not (
        "visiondesignie consultation" in n
        or "architect consultation" in n
    ):
        return "none"
    if "planning revision" in n:
        return "planning"
    if "planning stage" in n:
        return "planning"
    if "analyzing stage" in n or "analysis phase" in n:
        return "analysis"
    return "none"


def _is_requirements_conversation_turn(query: str) -> bool:
    return "requirements conversation" in _normalize_consultation_marker(query or "")


def _compose_context_with_fallback(
    query: str, user_input: str | None = None
) -> tuple[str, dict[str, Any]]:
    """
    Build context from retrieval. Always keep retrieved text when present (never replace).
    Append illustrative fallback only when RAG is very short and the query looks regulatory.
    Retrieval must use the real user line only—not the full prefixed / wrapped API message.

    Returns the context string plus a dict of fields compatible with ``public.rag_query_metrics``.
    """
    clean_query = _user_turn_for_server_log(query, user_input)
    meta: dict[str, Any] = {
        "search_k": 3,
        "fetch_k": 8,
        "query_preview": (clean_query or "")[:500] or None,
    }

    retriever = _get_vectorstore().as_retriever(
        search_type="mmr",
        search_kwargs={"k": 3, "fetch_k": 8},
    )
    t_invoke0 = time.perf_counter()
    docs = retriever.invoke(clean_query)
    t_invoke1 = time.perf_counter()
    meta["retrieval_total_ms"] = int((t_invoke1 - t_invoke0) * 1000)
    _log_retrieval_debug(clean_query, docs)

    t_build0 = time.perf_counter()
    best_overlap = _best_doc_query_overlap(clean_query, docs)
    meta["best_doc_overlap"] = round(best_overlap, 3)

    # RAG -> LLM fallback: if retrieval is too weak/noisy, skip injected context.
    # LLM still answers, but without misleading snippets.
    if len(docs) == 0 or best_overlap < 0.12:
        meta["rag_context_skipped_low_relevance"] = True
        meta["fallback_knowledge_appended"] = False
        meta["context_char_count"] = 0
        meta["context_build_ms"] = int((time.perf_counter() - t_build0) * 1000)
        if RAG_RETRIEVAL_DEBUG:
            logger.info(
                "rag_debug fallback_to_llm_only query=%r docs=%d overlap=%.3f",
                clean_query,
                len(docs),
                best_overlap,
            )
        return "", meta

    context = ""
    for doc in docs:
        if len(context) < MAX_CONTEXT_CHARS:
            context += doc.page_content + "\n"
        else:
            break
    rag = context.strip()
    meta["docs_returned"] = len(docs)
    meta["rag_context_skipped_low_relevance"] = False

    clean_q = _user_turn_for_server_log(query, user_input)
    if not _should_append_fallback(docs, rag, clean_q):
        out = rag
        meta["fallback_knowledge_appended"] = False
        meta["context_char_count"] = len(out)
        meta["context_build_ms"] = int((time.perf_counter() - t_build0) * 1000)
        return out, meta

    sep = f"\n\n---\n{FALLBACK_HEADER}\n\n"
    fb = FALLBACK_KNOWLEDGE
    suffix = sep + fb
    max_rag = MAX_CONTEXT_CHARS - len(suffix)
    if max_rag <= 0:
        out = suffix[:MAX_CONTEXT_CHARS]
        meta["fallback_knowledge_appended"] = True
        meta["context_char_count"] = len(out)
        meta["context_build_ms"] = int((time.perf_counter() - t_build0) * 1000)
        return out, meta
    rag_part = rag[:max_rag] if rag else ""
    combined = (rag_part + suffix) if rag_part else suffix.lstrip("\n")
    if len(combined) > MAX_CONTEXT_CHARS:
        combined = combined[:MAX_CONTEXT_CHARS]
    meta["fallback_knowledge_appended"] = True
    meta["context_char_count"] = len(combined)
    meta["context_build_ms"] = int((time.perf_counter() - t_build0) * 1000)
    return combined, meta


def _architect_voice_brief() -> str:
    return "- Structured consultation: follow THREAD BEHAVIOR and MODE; obey STRUCTURED OUTPUT RULES + RESPONSE SHAPE below."


def _no_echo_and_scaffolding() -> str:
    return """- Do NOT repeat or reference: "Previous conversation", "Current request", or any conversation-formatting text from the prompt. Answer naturally as a direct response; never quote those labels.
- Never echo prompt scaffolding: do NOT output "--- User Query ---", "--- Context ---", "--- Conversation history ---", or similar delimiter lines. Do NOT restate the user's message as a titled section.
- Do NOT paste internal briefing blocks (e.g. lines starting "INTERNAL BRIEF", "Confirmed client inputs", or bullet lists of plot/location/BHK copied from the prompt).
- Speak as one architect assistant: do not open every reply with a self-introduction; do not name-drop internal thread labels or the product name unless the user explicitly asks about them.
- Identity: the person you are replying to is the CLIENT. Address them naturally; do not use fictional assistant names when talking to them."""


def _rag_truthfulness() -> str:
    return """- Context comes from indexed RAG (FAISS). Treat it as background reasoning only: fold facts into what you say—never copy, paraphrase as a block, dump passages, or sound like you are reporting "what the documents say."
- Never tell the client you are using "documents", "snippets", "retrieved rules", or "the index"—weave facts in as your own professional judgment.
- Prefer synthesis over generic web-style claims; do NOT paste long raw quotes or list "snippets".
- If indexed snippets conflict with text after '---' (illustrative demo), trust indexed snippets for facts; treat demo numbers as non-binding.
- If details are missing: still guide—use Context first, then defensible regional/city practice for residential plots like theirs. Do not invent precise code numbers with zero basis; prefer ranges or qualitative rules grounded in Context or widely used norms. Never tell the client to "confirm locally", "check with the authority", "verify on site", or similar—you are their guide here.
STRICT DOMAIN CONTROL:
- Do NOT mix unrelated examples from Context into the reply.
- Do NOT reuse unrelated building types or programs from retrieved content.
- Ignore any RAG content that does not match the user's stated project (e.g. residential vs non-residential, scale, or use type).
RAG SCOPE (regulations — use Context only for this):
- Setbacks, FSI/FAR (and similar density rules), and local building bylaws / regulations that match the client's stated plot and city.
- Do NOT use Context to introduce unrelated building types, off-domain programs, or worked examples from a different project type than the client's.
- If Context is thin on numbers: give clear architect-style guidance (typical bands, what usually drives FSI/setbacks for that city scale) without outsourcing verification—no "confirm with local body" language."""


def _structured_four_section_rules() -> str:
    return """- Four sections in order; headers EXACTLY: 📐 Site Analysis: / 📊 Regulations: / 🏡 Suggested Plan: / ❓ Next Step: (emoji + label + colon; no markdown fences).
- Bullets only ("- "); short lines. One design step forward per turn—no recap unless the user asked.
- Voice: sound like a practicing architect talking to a client—not a form or report generator. No stacked intros, no "I will now…" meta; get to substance quickly.
- Unknowns: honest or typical practice; no placeholder labels. If plot, location, BHK, Vastu, or layout style is still missing: one blocking ❓ only (never multiple questions).
- 📊 Regulations: lead with FSI/setbacks/floors guidance from Context + city-appropriate norms; write as your professional read—no "confirm locally", "check with authority", or "verify on site".
- 🏡: rooms clearly placed (where) + short reason (why: light, breeze, privacy, circulation). Keep flow readable: entry → living → kitchen → bedrooms when program allows. Imperatives over hedging; stay practical.
- ❓: one bullet, one sentence ending "?"; no permission-seeking. When plot + location + BHK are known, never re-ask those—advance layout or offer a single tweak/proceed angle."""


_THREAD_BEHAVIOR = """THREAD BEHAVIOR (do not describe this label to the user):
You are the VisionDesignie architect assistant—ONE continuous conversation with the CLIENT (no separate modes or personas). Behave like a real architect from first message through layout.

CORE FLOW (mental only—never announce steps):
Understand → collect missing site facts → when enough → plan → refine in place.

DECISION (each turn; do not label it to the user):
- Concept-only (e.g. “what is FSI?” with no plot / build intent in this message): 2–4 tight lines of explanation only—do NOT start detailed layout planning in natural (non-structured) turns.
- Project intent (plot, house, build, layout): collect toward plot + location + BHK; one question at a time; never a form-style questionnaire.
- Concept + project together: explain the concept briefly (2–4 lines), then continue their site in the same reply—one forward motion.

REQUIREMENTS:
- Must have before layout: plot (dimensions or area), location (city/area), BHK, Vastu yes/no, and layout style (modern / traditional / compact)—the client app collects these before planning.
- Optional when one focused ask helps: facing; parking.

COLLECTION:
- At most ONE question per reply while any of the three essentials is missing; never stack questions; never repeat an already-answered fact.

PLANNING TRIGGER:
- When plot + location + BHK + Vastu + layout style are known (thread or this message): STOP re-asking those; START layout reasoning immediately—no confirmation wait. Natural prose turns stay prose-only (no four-section template). Structured PLANNING MODE turns end after the four sections—describe placement in 🏡 in words only; never append PLAN_JSON, coordinates, SVG, or machine-readable geometry. The product draws the floor sketch in the browser from saved facts—you only reason in prose.

PLANNING CONTENT:
- Where + short why per move; readable flow: entry → living → kitchen → bedrooms (adapt if the program is very tight).
- “ok / yes / continue”: advance one design layer—no permission-seeking. User changes something: UPDATE in place—do NOT restart discovery.

LAYOUT INTELLIGENCE RULES (apply in prose in 🏡 Suggested Plan—do not describe this heading to the user):
When designing a house plan, follow real architectural reasoning:
1. ZONING: Divide the plot mentally into three bands along the road–rear axis: FRONT → public (entry, living, parking); MIDDLE → semi-private (dining, kitchen); BACK → private (bedrooms). Let room order and adjacency in your written plan reflect this.
2. ENTRY: Entry from the road side; entry opens into living (or a short foyer that opens to living)—never straight into a bedroom.
3. LIVING: Front zone, adjacent to entry; favor daylight and a clear public face (openness where setbacks allow).
4. KITCHEN: Near dining; prefer an outer wall run for ventilation and shorter wet stacks; avoid burying the kitchen in the core with no wall to outside.
5. BEDROOMS: Rear / quieter zone; shield from entry sightlines and street noise; avoid doors that face the entry axis.
6. BATHROOMS: Cluster near bedrooms they serve; avoid isolated cores with no wall to wet risers; prefer perimeter adjacency for ducts and light where possible.
7. STAIRCASE: Along a side or back edge—not a bulky block in the middle; keep circulation clear to upper levels without cutting through private suites first.
8. FLOW: Prefer the sequence entry → living → dining → kitchen → private wing (bedrooms). Avoid reversing private–service–public (e.g. bedroom first, then kitchen, then living as the only path).
9. LIGHT & VENTILATION: Aim for each habitable room to have at least one outer wall or a short path to one; favor cross-ventilation pairs (opposite or perpendicular walls); avoid only internal rooms with no wall to outside air.
10. SMALL PLOT OPTIMIZATION: Prefer linear or L-shaped wings along edges; shorten corridors; combine living + dining when tight; reduce dead circulation.
11. PARKING: If parking is in the program, reserve a clear front strip along the access edge; tuck living slightly behind it so the public edge reads as arrival, not bedroom frontage.
12. LOCATION INTELLIGENCE: In hot climates (e.g. Chennai), bias against long west-facing glazed runs; favor compact depth, shaded courts, and tighter plans that reduce solar load—still state moves in where/why terms, not cliché lists.
13. SPATIAL CONSISTENCY: Keep the written plan internally consistent (front/back, adjacency, circulation)—no coordinate grids or JSON.

RESPONSE RULES (layout-bearing turns):
- Always pair placement with reason: WHERE (front/middle/back, which edge, relation to road or courtyard) and WHY (daylight, privacy, breeze, plumbing/duct runs, noise, flow).
- Default length ~3–6 lines of substance in free prose turns; in structured turns keep 🏡 decisive and spatial—same reasoning, section discipline unchanged.
- Avoid generic filler like “living front, kitchen back” without causal language; vary sentence openings so turns do not read as copy-paste.

LAYOUT ANTI-PATTERNS (do not):
- Do not repeat the same sentence skeleton every turn; do not hand-wave vague “zones” without spatial consequence; do not ignore zoning, entry, or privacy logic above; do not scatter rooms without a coherent circulation story.

Natural prose (no 📐 headers): when plot + location + BHK are clear, open with one short human line tied to their brief (vary wording—no identical stock opener every time), then concise layout prose only. If INTERNAL BRIEF disagrees with facts already in the thread, obey the thread.

Structured turns (📐…): start at 📐 with no greeting or filler before it; when the three essentials are confirmed, 📐📊 stay minimal—add new insight only, do not parrot what the client just said or repeat app UI bridges from earlier bubbles.

RAG: setbacks, FSI, local rules only—never name documents or sources; never “confirm locally” / authority handoffs.

STYLE: ~3–6 lines default; no essays; no repetition; no meta (“I will guide you”).

Context: user message + Recent conversation; stay residential unless they broaden; ignore unrelated RAG examples."""

def _analysis_stage_block() -> str:
    return """CONSULTATION MODE: ANALYSIS (frontend controls flow — you only format and reason from evidence).

- Start immediately with 📐 Site Analysis: (no greeting or preamble before the first section).
- If plot, location, BHK, Vastu, or layout style is missing, keep bullets honest (unknowns), avoid invented dimensions, and use ❓ for exactly ONE question for the single worst gap—never a multi-part questionnaire; do not bundle facing/parking in that same turn.
- Keep the whole reply compact — avoid regulatory essays; no recycled lines from prior turns unless this turn updates them. Advance one step: do not restate analysis the user already accepted—add the next layer (numbers, constraints, or implications).
- 📐 Site Analysis & 📊 Regulations: primary source = indexed Context (RAG). If Context is silent on a precise number, still give useful one-line architect guidance (typical band or rule-of-thumb for that city/plot type)—do not tell the client to confirm with authorities; optional one focused ❓ only if something essential is truly unknown.
- 🏡 Suggested Plan: minimal bullets (two to four decisive lines if possible); point toward a clear direction for the next planning step—firm language ("Plan", "Assume", "Reserve"), not vague "we could explore" option stacks.
- ❓ Next Step: one complete question ending with "?". Make it necessary (forward or clarification), not filler or repeated discovery.

"""


def _planning_stage_block() -> str:
    return """CONSULTATION MODE: PLANNING (frontend controls flow).

- Plot, location, BHK, Vastu, and layout style are settled—do not re-ask. Optional facing/parking: fold in if known; one clarification only if blocking. Minimal 📐📊 recap (no essay—one tight line per section when facts are already known); new work lives in 🏡. Each turn adds the next layer (adjacency → circulation → refinement)—never replay the prior turn. ❓: one "?" (proceed vs tweak or one necessary clarification). Program or preference changes: revise 🏡 in place—no restart.
- Do not output PLAN_JSON, SVG, coordinate lists, or any machine-readable floor plan—layout exists only as clear prose in 🏡 Suggested Plan.

"""


_ONBOARDING_SLUG_LABELS: dict[str, str] = {
    "home_builder": "First-time Home Builder",
    "student": "Architecture Student",
    "investor": "Plot Buyer / Investor",
    "contractor": "Small Contractor / Builders",
    "professional": "Working Professional",
}


def _format_onboarding_profile_block(onboarding_role: str | None) -> str:
    raw = (onboarding_role or "").strip()
    if not raw:
        return ""
    display = _ONBOARDING_SLUG_LABELS.get(raw, raw)
    return (
        "--- User profile (app onboarding) ---\n"
        f"Primary role: {display}\n"
        "- Tailor depth and vocabulary to this role (e.g. step-by-step basics for first-time builders; "
        "denser technical notes for students or contractors when useful).\n"
        "- Do not open every reply by repeating their role; mention it only when it naturally helps.\n\n"
    )


def _build_architect_prompt(
    query: str,
    context_block: str,
    history_text: str,
    phase: Literal["analysis", "planning", "none"],
    design_state: dict | None = None,
    onboarding_role: str | None = None,
) -> str:
    phase = phase if phase in ("analysis", "planning", "none") else "none"

    design_facts = ""
    if design_state and isinstance(design_state, dict):
        plot = design_state.get("plot_size") or design_state.get("plot")
        location = design_state.get("location")
        bhk = design_state.get("bhk")
        parts: list[str] = []
        if plot:
            parts.append(f"Plot: {plot}")
        if location:
            parts.append(f"Location: {location}")
        if bhk not in (None, "", 0) and str(bhk).strip() != "":
            parts.append(f"{bhk} BHK")
        if parts:
            design_facts = (
                "Confirmed project details:\n- " + "\n- ".join(parts) + "\n\n"
            )

    thread_behavior = _THREAD_BEHAVIOR

    if phase == "none":
        core_rules = "\n".join(
            [
                "CORE RULES:",
                "- Follow THREAD BEHAVIOR; bracketed user lines add stage/format only, not conflicting rules.",
                _rag_truthfulness(),
                _no_echo_and_scaffolding(),
            ]
        )
    else:
        core_rules = "\n".join(
            [
                "CORE RULES (structured consultation turn):",
                _architect_voice_brief(),
                _rag_truthfulness(),
                _no_echo_and_scaffolding(),
            ]
        )

    if phase == "analysis":
        mode_block = _analysis_stage_block()
        shape_rules = _structured_four_section_rules()
        response_skeleton = _RESPONSE_SHAPE_TEMPLATE
        lead_rule = "Do not add any text before 📐 Site Analysis:."
        closing = (
            "Now respond (stream token by token). Start with 📐 Site Analysis: as required. "
            "Never print \"--- User Query ---\" or duplicate the user message as a section heading."
        )
    elif phase == "planning":
        mode_block = _planning_stage_block()
        shape_rules = _structured_four_section_rules()
        response_skeleton = _RESPONSE_SHAPE_TEMPLATE
        lead_rule = (
            "Do not add any text before 📐 Site Analysis:. "
            "End after the four sections—no PLAN_JSON or coordinate blocks."
        )
        closing = (
            "Now respond (stream token by token). Start with 📐 Site Analysis: as required. "
            "Never print \"--- User Query ---\" or duplicate the user message as a section heading."
        )
    else:
        _natural_base = """NATURAL REPLY MODE (general chat / RAG — not a consultation stage):

- Answer in clear, conversational prose. Do NOT use 📐 📊 🏡 ❓ section headers or a four-part report template.
- Human length: about 3–6 short lines maximum by default (concept-only answers: about 2–4 lines then stop); expand only if the user explicitly asked for depth. No essay tone. Prefer one forward design step or one tight explanation—not many parallel instructions.
- Do not repeat stock openers ("Considering your plot…", "Based on your requirement…", "Based on your plot and requirements…"); open with substance. Avoid recap bridges ("Since we discussed…") unless the user asked for memory.
- Never use permission-seeking or stall phrases ("I need a clear yes to proceed", "confirm before proceeding", "shall we continue", "do you want to proceed")—lead with the next design move.
- Short bullets only if they clarify a layout or checklist; avoid bullet dumps.
- Ground answers in Context when relevant; synthesize—do not dump raw retrieved lines; never mention "documents", "retrieval", or "sources"; RAG should read as your reasoning, not as quoted material.
- At most ONE question in the entire reply, only if essential—if the next move is obvious (e.g. user said "ok", "yes", "continue"), use zero questions and state the next step.
- Lead: decisive word choice ("Place", "Keep", "Plan") over "you could / you may / it might".
- Incomplete message ("I have a plot", no size/place/program): one line max of context, then exactly ONE focused question—no planning prose, no guessing.
- Mid-planning definitional aside: 2–3 line definition, then immediate return to their layout thread in the same reply—no unrelated questions in between.
- Requirement or realism conflict: explain tradeoff briefly, propose a workable alternative, continue—no blunt shutdown.
- If you would repeat the last reply, skip repeated lines and give only the next design increment.
"""
        if _is_requirements_conversation_turn(query):
            mode_block = (
                _natural_base
                + "- Requirement-dialogue turn: no four emoji sections, no layout JSON. Follow THREAD BEHAVIOR; use INTERNAL BRIEF only as a silent extractor hint under the user message—never quote it.\n"
            )
        else:
            mode_block = _natural_base
        shape_rules = ""
        response_skeleton = ""
        lead_rule = "Write naturally; no emoji section titles, no scaffold labels."
        closing = (
            "Stream your reply token by token in natural language. "
            "Never print \"--- User Query ---\", \"--- Context ---\", or repeat prompt headers."
        )

    identity = (
        "You are the VisionDesignie architect assistant — one continuous guide for the CLIENT: "
        "understand their brief, explain tradeoffs, then design practically.\n"
        "Reason from Context below (FAISS) and from the user message.\n"
        "Follow THREAD BEHAVIOR, then the MODE block, for this turn only."
    )

    profile_block = _format_onboarding_profile_block(onboarding_role)

    shape_block = ""
    if response_skeleton:
        shape_block = (
            f"\nSTRUCTURED OUTPUT RULES:\n{shape_rules}\n\n"
            f"RESPONSE SHAPE (fill in; exact headers):\n{response_skeleton}\n\n{lead_rule}\n"
        )
    else:
        shape_block = f"\n{lead_rule}\n"

    history_block = (
        f"Recent conversation:\n{history_text}\n\n"
        if (history_text or "").strip()
        else ""
    )

    return f"""{identity}

{design_facts}THREAD BEHAVIOR:
{thread_behavior}

{core_rules}

{mode_block}
{shape_block}
{history_block}{profile_block}Context (indexed RAG; text after '---' may be illustrative):
{context_block}

User message (answer this; do not echo as a heading):
{query}

{closing}
"""


def _small_talk_reply() -> str:
    return _WELCOME


def _rag_mode_and_payload(
    query: str,
    history: list[dict[str, str]],
    design_state: dict | None = None,
    onboarding_role: str | None = None,
    user_input: str | None = None,
) -> tuple[Literal["early", "llm"], str, dict[str, Any] | None]:
    user_log = _user_turn_for_server_log(query, user_input)
    if _is_small_talk(user_log) or _line_is_trivial_greeting(user_log):
        return "early", _small_talk_reply(), None

    if _is_planner_capabilities_meta(user_log):
        return "early", _PLANNER_CAPABILITIES_REPLY, None

    phase = _detect_consultation_phase(query)
    if phase == "planning":
        # Planning wrapper already carries confirmed client inputs; avoid extra retrieval latency here.
        context_block = (
            "Planning stage: prioritize the confirmed client inputs from the user message. "
            "Use concise architect judgment for regulations/layout where needed."
        )
        retrieval_meta = {
            "search_k": 0,
            "fetch_k": 0,
            "query_preview": (user_log or "")[:500] or None,
            "best_doc_overlap": None,
            "rag_context_skipped_for_planning": True,
            "fallback_knowledge_appended": False,
            "context_char_count": len(context_block),
            "retrieval_total_ms": 0,
            "context_build_ms": 0,
        }
    else:
        try:
            context_block, retrieval_meta = _compose_context_with_fallback(query, user_input)
        except Exception:
            logger.exception(
                "rag retrieval failed; continuing with llm-only response"
            )
            context_block = ""
            retrieval_meta = {
                "search_k": 3,
                "fetch_k": 8,
                "query_preview": (user_log or "")[:500] or None,
                "best_doc_overlap": None,
                "docs_returned": 0,
                "rag_context_skipped_due_error": True,
                "fallback_knowledge_appended": False,
                "context_char_count": 0,
            }
    history_text = _history_text_for_prompt(query, history)
    logger.info("Consultation phase: %s", phase)

    prompt = _build_architect_prompt(
        query,
        context_block,
        history_text,
        phase,
        design_state=design_state,
        onboarding_role=onboarding_role,
    )
    return "llm", prompt, retrieval_meta


def _enqueue_rag_query_metrics(
    chat_id: str | None, retrieval_meta: dict[str, Any] | None
) -> None:
    """Resolve chat owner and INSERT metrics; never raises; does not block the streaming path."""
    if not retrieval_meta or not chat_id or not is_metrics_enabled():
        return

    def _run() -> None:
        uid = fetch_user_id_for_chat(chat_id)
        if not uid:
            return
        try:
            cid = str(uuid.UUID(chat_id.strip()))
        except (ValueError, AttributeError):
            return
        row = {"chat_id": cid, "user_id": uid, **retrieval_meta}
        insert_rag_query_metrics_row(row)

    threading.Thread(target=_run, daemon=True).start()


def _format_sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def _stringify_stream_content(raw: Any) -> str:
    """
    LangChain ``AIMessageChunk.content`` may be ``str`` or ``list[str | dict]`` (blocks).
    Streaming code must never ``+=`` a list onto a string or pass lists to ``json.dumps`` chunks.
    """
    if raw is None:
        return ""
    if isinstance(raw, str):
        return raw
    if isinstance(raw, list):
        parts: list[str] = []
        for item in raw:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                t = item.get("text")
                if isinstance(t, str):
                    parts.append(t)
            else:
                parts.append(str(item))
        return "".join(parts)
    return str(raw)


def stream_chat_response_chunks(
    query: str,
    chat_id: str | None = None,
    design_state: dict | None = None,
    onboarding_role: str | None = None,
    chat_type: str | None = None,
    user_input: str | None = None,
) -> Iterator[str]:
    if not (GROQ_API_KEY or "").strip():
        yield _format_sse(
            {
                "chunk": (
                    "**VisionDesignie chat API:** Groq is not configured on this server.\n\n"
                    "Ask whoever hosts the backend to set the **`GROQ_API_KEY`** environment variable "
                    "(see `backend/.env.example`), redeploy, then open **`GET /health`** — "
                    "`groq_configured` should be `true`."
                ),
            }
        )
        yield _format_sse({"done": True})
        return

    if (chat_type or "").strip().lower() == "learning":
        logger.info("chat_type=learning ignored — unified architect assistant")
    history = _get_or_create_history(chat_id)
    mode, payload, retrieval_meta = _rag_mode_and_payload(
        query,
        history,
        design_state=design_state,
        onboarding_role=onboarding_role,
        user_input=user_input,
    )

    # ✅ early return
    if mode == "early":
        yield _format_sse({"chunk": payload})
        yield _format_sse({"done": True})
        return

    _enqueue_rag_query_metrics(chat_id, retrieval_meta)

    full_response = ""
    final_text = ""
    phase = _detect_consultation_phase(query)
    # phase "none" → natural prose; "analysis"/"planning" → four sections (no layout JSON).

    try:
        # General RAG: buffer then emit cleaned text once so users do not see RAG echo + ── repair suffix.
        if phase == "none":
            for msg_chunk in _get_llm().stream(payload):
                content = _stringify_stream_content(getattr(msg_chunk, "content", None))
                if content:
                    full_response += content
            final_text, _fixes = post_process_assistant_response(full_response, phase)
            if _is_requirements_conversation_turn(query):
                # Requirements-gathering turns must never leak layout JSON blocks.
                final_text = _strip_trailing_plan_json_reply(final_text)
            if final_text.strip():
                yield _format_sse({"chunk": final_text})
        else:
            for msg_chunk in _get_llm().stream(payload):
                content = _stringify_stream_content(getattr(msg_chunk, "content", None))
                if content:
                    full_response += content
                    yield _format_sse({"chunk": content})
            final_text, _fixes = post_process_assistant_response(full_response, phase)
            yield from _emit_stream_suffix(full_response, final_text)

        # save memory for this chat only (canonical structured form)
        history.append(
            {"role": "user", "content": _user_turn_for_server_log(query, user_input)}
        )
        history.append({"role": "assistant", "content": final_text.strip()})

        if len(history) > _MAX_HISTORY_MESSAGES:
            history[:] = history[-_MAX_HISTORY_MESSAGES:]

    except Exception:
        logger.exception("stream_chat_response_chunks failed")
        yield _format_sse(
            {
                "chunk": "\n\n(I hit an error while generating this reply. Please try again.)",
            }
        )
    finally:
        # Always terminate the SSE stream so the client does not see ERR_INCOMPLETE_CHUNKED_ENCODING
        # when Python raised mid-stream (uvicorn --reload / process kill can still cut the TCP stream).
        yield _format_sse({"done": True})


def ask_question(
    query: str,
    chat_id: str | None = None,
    design_state: dict | None = None,
    onboarding_role: str | None = None,
    chat_type: str | None = None,
    user_input: str | None = None,
):
    if (chat_type or "").strip().lower() == "learning":
        logger.info("chat_type=learning ignored — unified architect assistant")
    history = _get_or_create_history(chat_id)
    mode, payload, retrieval_meta = _rag_mode_and_payload(
        query,
        history,
        design_state=design_state,
        onboarding_role=onboarding_role,
        user_input=user_input,
    )

    if mode == "early":
        return payload

    _enqueue_rag_query_metrics(chat_id, retrieval_meta)

    response = _get_llm().invoke(payload)
    answer = response.content.strip()
    phase = _detect_consultation_phase(query)
    final_text, _ = post_process_assistant_response(answer, phase)
    if phase == "none" and _is_requirements_conversation_turn(query):
        final_text = _strip_trailing_plan_json_reply(final_text)

    history.append(
        {"role": "user", "content": _user_turn_for_server_log(query, user_input)}
    )
    history.append({"role": "assistant", "content": final_text.strip()})

    if len(history) > _MAX_HISTORY_MESSAGES:
        history[:] = history[-_MAX_HISTORY_MESSAGES:]

    return final_text

import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import { useNavigate } from "react-router-dom";
import supabase from "../lib/supabaseClient";
import { saveMessage } from "../lib/saveMessage";
import { getResponse } from "../lib/getResponse";
import {
  INITIAL_DESIGN_STATE,
  extractRequirements,
  getNewChatWelcomeMessage,
  mergeRequirementsFromMessage,
  mergeRequirementsIntoState,
  MSG_HYBRID_BRIDGE,
  buildRagMessageWithMemoryHint,
  hasEnoughForLayoutProfile,
  enrichPlanningState,
  normalizeDesignStateFromDb,
  planConsultationTurn,
  RAG_BUILDER_PERSONA_PREFIX,
  MSG_REDESIGN_CONVERSATION_PROMPT,
  sanitizeAssistantRagEcho,
  stripTrailingPlanJson,
  wrapPlanningPrompt,
} from "../lib/architectConsultation";
import {
  buildLayoutPlanFromDesignState,
  layoutEnginePlotError,
} from "../lib/layoutEngine";
import DesignPanel from "./DesignPanel";
import { ASSISTANT_AVATAR_URL, USER_AVATAR_URL } from "../lib/personaAssets";
import { buildApiMessageWithRecentHistory } from "../lib/chatApiContext";
import {
  detectIntent,
  getIntentScores,
} from "../lib/intentDetection";
import {
  assistantLooksStructured,
  insertChatMetric,
  localMetricStage,
  markLastAssistantMetricApproved,
  stageForMetric,
  userMessageSignalsApproval,
} from "../lib/chatMetricsSupabase";
import ArchitectMessageContent from "./ArchitectMessageContent";
import { CHAT_API_BASE } from "../lib/chatApiBase";
import {
  transcriptForChatTitle,
  updateChatTitleWithLlm,
} from "../lib/chatTitleApi";
import {
  formatMessageTime,
  getSpeechRecognitionCtor,
  isAssistantChromeMessage,
  lastSubstantiveAssistantContent,
  MAX_TEXT_FILE_BYTES,
  tempAssistantId,
} from "./chatMessageUtils";
import {
  IconMicOutlined,
  IconMoon,
  IconSendPlane,
  IconSun,
} from "./ChatIcons";
import "../Chat.css";

const CHAT_URL = `${CHAT_API_BASE}/chat`;

/** Abort stalled /chat SSE reads (cold Render + RAG + embeddings can exceed 60s). */
const STREAM_FETCH_TIMEOUT_MS = 240_000;

/** Matches the copy from {@link getNewChatWelcomeMessage}; used to tag/update persisted welcomes. */
function isNewChatWelcomeContent(content) {
  return /VisionDesignie\s*-\s*Architect Planner\s*&\s*Consultant/i.test(
    String(content ?? "")
  );
}

export default function Chat({
  userId = null,
  currentChatId,
  refreshChats,
  sidebarOpen,
  chatsLoading = false,
  theme = "light",
  onThemeChange,
  username = "",
  /** Raw profiles.onboarding_role; sent to /chat for prompt tailoring */
  onboardingRole = null,
  onOpenDashboard,
}) {
  const navigate = useNavigate();
  /** Stored on chats row / title API for compatibility; server uses one architect path. */
  const API_CHAT_TYPE = "planner";
  const isPlanner = true;

  const [message, setMessage] = useState("");
  const [pendingTextAttachments, setPendingTextAttachments] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [speechListening, setSpeechListening] = useState(false);
  const [designState, setDesignState] = useState(INITIAL_DESIGN_STATE);
  /** True while loading message history after `currentChatId` changes (avoids quick-start flash). */
  const [threadHydrating, setThreadHydrating] = useState(() =>
    Boolean(currentChatId)
  );
  /** After messages + design_state load; gates Supabase persist to avoid overwriting DB mid-hydrate. */
  const [designHydrationDone, setDesignHydrationDone] = useState(false);
  /** Shown on last assistant bubble after SSE `done` until persist flush (post-process suffix). */
  const [streamFinalizingUi, setStreamFinalizingUi] = useState(false);
  /** Client-only floor sketch from {@link buildLayoutPlanFromDesignState} (approval / complete). */
  const [layoutPlan, setLayoutPlan] = useState(null);
  const [layoutError, setLayoutError] = useState(null);
  const [designPanelOpen, setDesignPanelOpen] = useState(false);
  /** Hides composer â€œView floor planâ€ until sketch becomes ready again (header Floor plan stays). */
  const [floorPlanComposerCtaDismissed, setFloorPlanComposerCtaDismissed] =
    useState(false);
  /** Assistant message id that last triggered copy feedback ("Copied"). */
  const [copiedAssistantMessageId, setCopiedAssistantMessageId] = useState(null);
  const messagesRef = useRef([]);
  const prevLoadingForFocusRef = useRef(loading);

  const scrollContainerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const mountedRef = useRef(true);
  const streamAbortRef = useRef(null);
  const pendingContentRef = useRef("");
  const flushRafRef = useRef(null);
  const assistantMirrorRef = useRef("");
  const designStateRef = useRef(INITIAL_DESIGN_STATE);
  const consultationStreamPhaseRef = useRef(null);
  /** Messages snapshot at send start â€” build LLM sidebar title without stale ref races. */
  const titleThreadBaseRef = useRef([]);
  const streamStartedAtRef = useRef(0);
  const sidebarBlurSkipRef = useRef(true);
  const copyFeedbackTimerRef = useRef(null);
  const speechRecognitionRef = useRef(null);
  const speechStopFallbackRef = useRef(null);
  const speechRestartTimerRef = useRef(null);
  /** True while user wants mic on; only false when they click mic off (not on API `onend`). */
  const speechMicShouldRunRef = useRef(false);
  /** Text before the current browser recognition session (manual + prior sessions while mic on). */
  const speechBaseRef = useRef("");
  /** Last full composer string produced while dictating; survives session restarts on `onend`. */
  const speechSnapshotRef = useRef("");
  const latestMessageRef = useRef("");

  const speechSupported = useMemo(
    () => typeof window !== "undefined" && getSpeechRecognitionCtor() != null,
    []
  );

  const noChat = !currentChatId;
  const composerLocked = loading || chatsLoading || noChat;
  /** When true, textarea is removed from tab order (no chat / list loading). */
  const composerHardDisabled = noChat || chatsLoading;
  /** During assistant stream or dictation, keep textarea focusable but not editable. */
  const textareaReadOnly = loading || speechListening;

  const currentChatIdRef = useRef(currentChatId);
  currentChatIdRef.current = currentChatId;

  const usernameRef = useRef(username);
  usernameRef.current = username;
  const onboardingRoleRef = useRef(onboardingRole);
  onboardingRoleRef.current = onboardingRole;

  const buildChatApiPayload = (msg, chatId, userInput = null) => {
    const body = {
      message: msg,
      chat_id: chatId,
      design_state: { ...designStateRef.current },
    };
    const u = userInput != null ? String(userInput).trim() : "";
    if (u) {
      body.user_input = u;
    }
    const raw = onboardingRoleRef.current;
    if (raw != null && String(raw).trim() !== "") {
      body.onboarding_role = String(raw).trim();
    }
    return body;
  };

  useEffect(() => {
    latestMessageRef.current = message;
  }, [message]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    designStateRef.current = designState;
  }, [designState]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      streamAbortRef.current?.abort();
      if (flushRafRef.current != null) {
        cancelAnimationFrame(flushRafRef.current);
        flushRafRef.current = null;
      }
      speechMicShouldRunRef.current = false;
      if (speechRestartTimerRef.current != null) {
        clearTimeout(speechRestartTimerRef.current);
        speechRestartTimerRef.current = null;
      }
      try {
        speechRecognitionRef.current?.abort();
      } catch {
        /* ignore */
      }
      speechRecognitionRef.current = null;
      if (speechStopFallbackRef.current != null) {
        clearTimeout(speechStopFallbackRef.current);
        speechStopFallbackRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!composerLocked) return;
    const r = speechRecognitionRef.current;
    speechMicShouldRunRef.current = false;
    if (speechRestartTimerRef.current != null) {
      clearTimeout(speechRestartTimerRef.current);
      speechRestartTimerRef.current = null;
    }
    if (speechStopFallbackRef.current != null) {
      clearTimeout(speechStopFallbackRef.current);
      speechStopFallbackRef.current = null;
    }
    if (r) {
      try {
        r.stop();
      } catch {
        try {
          r.abort();
        } catch {
          /* ignore */
        }
      }
      speechRecognitionRef.current = null;
      setSpeechListening(false);
      setMessage(speechSnapshotRef.current);
    } else if (speechListening) {
      setSpeechListening(false);
    }
  }, [composerLocked, speechListening]);

  useEffect(() => {
    if (sidebarBlurSkipRef.current) {
      sidebarBlurSkipRef.current = false;
      return;
    }
    if (sidebarOpen) {
      inputRef.current?.blur();
    } else if (!composerHardDisabled) {
      requestAnimationFrame(() => {
        inputRef.current?.focus({ preventScroll: true });
      });
    }
  }, [sidebarOpen, composerHardDisabled]);

  /** When a chat thread finishes loading, move focus to the composer. */
  useEffect(() => {
    if (composerHardDisabled || threadHydrating) return;
    const id = requestAnimationFrame(() => {
      if (!composerHardDisabled && mountedRef.current) {
        inputRef.current?.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(id);
  }, [threadHydrating, composerHardDisabled]);

  /** When the assistant stream ends, restore caret (textarea stays in the tab order via readOnly). */
  useEffect(() => {
    const prev = prevLoadingForFocusRef.current;
    prevLoadingForFocusRef.current = loading;
    if (prev && !loading && !composerHardDisabled) {
      requestAnimationFrame(() => {
        inputRef.current?.focus({ preventScroll: true });
      });
    }
  }, [loading, composerHardDisabled]);

  const flushStreamBuffer = () => {
    const delta = pendingContentRef.current;
    pendingContentRef.current = "";
    if (!delta || !mountedRef.current) return;
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === "assistant" && !isAssistantChromeMessage(last)) {
        const newContent = last.content + delta;
        assistantMirrorRef.current = newContent;
        next[next.length - 1] = { ...last, content: newContent };
      }
      return next;
    });
  };

  const scheduleFlush = () => {
    if (flushRafRef.current != null) return;
    flushRafRef.current = requestAnimationFrame(() => {
      flushRafRef.current = null;
      flushStreamBuffer();
    });
  };

  const copyAssistantMessage = useCallback((messageId, text) => {
    const t = String(text ?? "").trim();
    if (!t || messageId == null) return;
    if (copyFeedbackTimerRef.current != null) {
      clearTimeout(copyFeedbackTimerRef.current);
      copyFeedbackTimerRef.current = null;
    }
    void navigator.clipboard.writeText(t).then(
      () => {
        setCopiedAssistantMessageId(messageId);
        requestAnimationFrame(() => {
          inputRef.current?.focus({ preventScroll: true });
        });
        copyFeedbackTimerRef.current = window.setTimeout(() => {
          setCopiedAssistantMessageId(null);
          copyFeedbackTimerRef.current = null;
        }, 2000);
      },
      (err) => {
        console.warn("Copy failed:", err);
      }
    );
  }, []);

  useEffect(
    () => () => {
      if (copyFeedbackTimerRef.current != null) {
        clearTimeout(copyFeedbackTimerRef.current);
        copyFeedbackTimerRef.current = null;
      }
    },
    []
  );

  useEffect(() => {
    if (copyFeedbackTimerRef.current != null) {
      clearTimeout(copyFeedbackTimerRef.current);
      copyFeedbackTimerRef.current = null;
    }
    setCopiedAssistantMessageId(null);
    streamAbortRef.current?.abort();
    pendingContentRef.current = "";
    assistantMirrorRef.current = "";
    if (flushRafRef.current != null) {
      cancelAnimationFrame(flushRafRef.current);
      flushRafRef.current = null;
    }
    setLoading(false);

    if (!currentChatId) {
      setThreadHydrating(false);
      setDesignHydrationDone(false);
      setMessages([]);
      setDesignState(INITIAL_DESIGN_STATE);
      designStateRef.current = INITIAL_DESIGN_STATE;
      consultationStreamPhaseRef.current = null;
      setLayoutPlan(null);
      setLayoutError(null);
      setDesignPanelOpen(false);
      return;
    }

    setDesignHydrationDone(false);
    setDesignState(INITIAL_DESIGN_STATE);
    designStateRef.current = INITIAL_DESIGN_STATE;
    consultationStreamPhaseRef.current = null;
    setMessage("");
    setPendingTextAttachments([]);
    setMessages([]);
    setThreadHydrating(true);
    setLayoutPlan(null);
    setLayoutError(null);
    setDesignPanelOpen(false);

    let cancelled = false;
    const hydrationForChatId = currentChatId;

    (async () => {
      const mapRows = (rows) =>
        (rows ?? []).map((m, idx) => ({
          id: m.id,
          role: m.role,
          content: m.content ?? "",
          created_at: m.created_at ?? null,
          ...(idx === 0 &&
          m.role === "assistant" &&
          isNewChatWelcomeContent(m.content)
            ? { chatInitGreeting: true }
            : {}),
        }));

      const applyDesignFromChatRow = (chatMeta) => {
        if (cancelled || !mountedRef.current) return;
        const normalized = normalizeDesignStateFromDb(chatMeta?.design_state);
        if (normalized) {
          setDesignState(normalized);
          designStateRef.current = normalized;
        } else {
          setDesignState(INITIAL_DESIGN_STATE);
          designStateRef.current = INITIAL_DESIGN_STATE;
        }
      };

      const resetDesignForEmptyThread = () => {
        if (cancelled || !mountedRef.current) return;
        setDesignState(INITIAL_DESIGN_STATE);
        designStateRef.current = INITIAL_DESIGN_STATE;
      };

      try {
        const [msgRes, chatRes] = await Promise.all([
          supabase
            .from("messages")
            .select("id, role, content, created_at")
            .eq("chat_id", currentChatId)
            .order("created_at", { ascending: true }),
          supabase
            .from("chats")
            .select("design_state")
            .eq("id", currentChatId)
            .maybeSingle(),
        ]);

        const { data, error } = msgRes;
        if (chatRes.error) {
          console.error(chatRes.error);
        }
        const chatMeta = chatRes.data;

        if (cancelled || !mountedRef.current) return;
        if (error) {
          console.error(error);
          setMessages([]);
          applyDesignFromChatRow(chatMeta);
          return;
        }

        const rows = data ?? [];
        if (rows.length > 0) {
          setMessages(mapRows(rows));
          applyDesignFromChatRow(chatMeta);
          return;
        }

        const { data: race } = await supabase
          .from("messages")
          .select("id")
          .eq("chat_id", currentChatId)
          .limit(1);

        if (cancelled || !mountedRef.current) return;
        if (race?.length) {
          const { data: full, error: fullErr } = await supabase
            .from("messages")
            .select("id, role, content, created_at")
            .eq("chat_id", currentChatId)
            .order("created_at", { ascending: true });
          if (cancelled || !mountedRef.current) return;
          if (fullErr) {
            console.error(fullErr);
            setMessages([]);
            applyDesignFromChatRow(chatMeta);
            return;
          }
          setMessages(mapRows(full));
          applyDesignFromChatRow(chatMeta);
          return;
        }

        if (cancelled || !mountedRef.current) return;

        const { data: again } = await supabase
          .from("messages")
          .select("id")
          .eq("chat_id", currentChatId)
          .limit(1);
        if (cancelled || !mountedRef.current) return;
        if (again?.length) {
          const { data: full, error: fullErr } = await supabase
            .from("messages")
            .select("id, role, content, created_at")
            .eq("chat_id", currentChatId)
            .order("created_at", { ascending: true });
          if (cancelled || !mountedRef.current) return;
          if (fullErr) {
            console.error(fullErr);
            return;
          }
          if (full?.length) {
            setMessages(mapRows(full));
            applyDesignFromChatRow(chatMeta);
          }
          return;
        }

        const welcomeText = getNewChatWelcomeMessage(usernameRef.current);
        const { data: welcomeRow, error: welcomeErr } = await saveMessage({
          chat_id: currentChatId,
          role: "assistant",
          content: welcomeText,
        });

        if (cancelled || !mountedRef.current) return;
        if (!welcomeErr && welcomeRow) {
          setMessages([
            {
              id: welcomeRow.id,
              role: welcomeRow.role,
              content: welcomeRow.content ?? "",
              created_at: welcomeRow.created_at ?? null,
              chatInitGreeting: true,
            },
          ]);
        } else {
          console.warn(
            "Could not persist new-chat welcome; using local-only greeting",
            welcomeErr
          );
          setMessages([
            {
              id: `local-chat-welcome-${hydrationForChatId}`,
              role: "assistant",
              content: welcomeText,
              created_at: new Date().toISOString(),
              chatInitGreeting: true,
            },
          ]);
        }
        // Empty/new chat must always start clean; avoid stale approval/complete
        // state from a previously persisted chats.design_state payload.
        resetDesignForEmptyThread();
      } finally {
        if (
          !cancelled &&
          mountedRef.current &&
          hydrationForChatId === currentChatIdRef.current
        ) {
          setThreadHydrating(false);
          setDesignHydrationDone(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentChatId]);

  /** If profile name loads after the empty-thread welcome, refresh the greeting text (and DB row if persisted). */
  useEffect(() => {
    if (!currentChatId) return;
    const localWelcomeId = `local-chat-welcome-${currentChatId}`;
    const w = getNewChatWelcomeMessage(username);
    setMessages((prev) => {
      const first = prev[0];
      if (!first || first.role !== "assistant") return prev;

      const isLocalWelcome =
        first.chatInitGreeting === true &&
        String(first.id) === localWelcomeId;

      const isPersistedWelcome =
        first.chatInitGreeting === true ||
        (prev[0] === first &&
          first.role === "assistant" &&
          isNewChatWelcomeContent(first.content));

      if (!isLocalWelcome && !isPersistedWelcome) return prev;
      if (first.content === w) return prev;

      if (
        first.id &&
        String(first.id) !== localWelcomeId &&
        !String(first.id).startsWith("local-")
      ) {
        void supabase
          .from("messages")
          .update({ content: w })
          .eq("id", first.id);
      }

      return [{ ...first, content: w, chatInitGreeting: true }, ...prev.slice(1)];
    });
  }, [username, currentChatId]);

  /**
   * When `currentChatId` changes, React can paint once with the new id but the previous
   * chat's `designState` still in state. Clear floor UI and gate layout rebuilds until
   * hydration for this chat finishes (see thread `useEffect` below).
   */
  useLayoutEffect(() => {
    setLayoutPlan(null);
    setLayoutError(null);
    setDesignPanelOpen(false);
    setDesignHydrationDone(false);
    setFloorPlanComposerCtaDismissed(false);
  }, [currentChatId]);

  useEffect(() => {
    if (!currentChatId || !designHydrationDone) {
      setLayoutPlan(null);
      setLayoutError(null);
      return;
    }
    const st = designState.stage;
    if (st !== "approval" && st !== "complete") {
      setLayoutPlan(null);
      setLayoutError(null);
      return;
    }
    if (!hasEnoughForLayoutProfile(designState)) {
      setLayoutPlan(null);
      setLayoutError(layoutEnginePlotError(designState.plot_size));
      return;
    }
    const plan = buildLayoutPlanFromDesignState(designState);
    if (plan) {
      setLayoutPlan(plan);
      setLayoutError(null);
    } else {
      setLayoutPlan(null);
      setLayoutError(
        layoutEnginePlotError(designState.plot_size) ??
          "Could not build a sketch from the current requirements."
      );
    }
  }, [designState, designHydrationDone, currentChatId]);

  useEffect(() => {
    if (!designPanelOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") setDesignPanelOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [designPanelOpen]);

  useEffect(() => {
    if (!currentChatId || !designHydrationDone) return;
    const payload = {
      plot_size: designState.plot_size,
      location: designState.location,
      road_width: designState.road_width,
      road_info: designState.road_info,
      building_type: designState.building_type,
      bhk: designState.bhk,
      floors: designState.floors,
      vastu_preference: designState.vastu_preference,
      layout_style: designState.layout_style,
      special_requirements: designState.special_requirements,
      facing: designState.facing,
      parking: designState.parking,
      stage: designState.stage,
      last_updated: new Date().toISOString(),
    };
    void supabase
      .from("chats")
      .update({ design_state: payload })
      .eq("id", currentChatId)
      .then(({ error }) => {
        if (error) console.error("design_state persist", error);
      });
  }, [designState, currentChatId, designHydrationDone]);

  const canOpenFloorPanel = useMemo(
    () =>
      (designState.stage === "approval" || designState.stage === "complete") &&
      hasEnoughForLayoutProfile(designState) &&
      (layoutPlan != null || layoutError != null),
    [designState, layoutPlan, layoutError]
  );

  const floorSketchFingerprint = useMemo(() => {
    if (!layoutPlan && !layoutError) return "";
    if (!layoutPlan) return `err:${String(layoutError ?? "")}`;
    return `ok:${layoutPlan.plot_width}x${layoutPlan.plot_height}:${layoutPlan.rooms?.length ?? 0}`;
  }, [layoutPlan, layoutError]);

  const floorSketchFpRef = useRef(null);
  useEffect(() => {
    if (!canOpenFloorPanel) {
      floorSketchFpRef.current = null;
      return;
    }
    const fp = floorSketchFingerprint;
    if (floorSketchFpRef.current != null && fp !== floorSketchFpRef.current) {
      setFloorPlanComposerCtaDismissed(false);
    }
    floorSketchFpRef.current = fp;
  }, [canOpenFloorPanel, floorSketchFingerprint]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages, loading]);

  const appendAssistantPersisted = useCallback(async (plainText) => {
    const cid = currentChatIdRef.current;
    if (!cid) return;
    const nowIso = new Date().toISOString();
    const { data: row, error } = await saveMessage({
      chat_id: cid,
      role: "assistant",
      content: plainText,
    });
    if (error || !row || !mountedRef.current) return;
    setMessages((prev) => [
      ...prev,
      {
        id: row.id,
        role: "assistant",
        content: plainText,
        created_at: row.created_at ?? nowIso,
      },
    ]);
    refreshChats?.();
    requestAnimationFrame(() =>
      inputRef.current?.focus({ preventScroll: true })
    );
  }, [refreshChats]);

  const handleRedesignFromPanel = useCallback(() => {
    setDesignPanelOpen(false);
    void appendAssistantPersisted(MSG_REDESIGN_CONVERSATION_PROMPT);
  }, [appendAssistantPersisted]);

  const handleOpenVision3D = useCallback(() => {
    if (!layoutPlan) return;
    setDesignPanelOpen(false);
    navigate("/vision-3d", {
      state: {
        layoutPlan,
        designState,
        chatId: currentChatId,
        fromDesignPanel: true,
      },
    });
  }, [navigate, layoutPlan, designState, currentChatId]);

  const composeOutgoingText = (textOverride) => {
    const typed =
      typeof textOverride === "string" ? textOverride.trim() : message.trim();
    const blocks = [];
    if (typed) blocks.push(typed);
    for (const a of pendingTextAttachments) {
      blocks.push(`[Attachment: ${a.name}]\n${a.text}`);
    }
    return blocks.join("\n\n").trim();
  };

  async function runKnowledgeOrHybridIntent({
    text,
    sendChatId,
    intent,
    apiHistorySlice,
  }) {
    pendingContentRef.current = "";
    assistantMirrorRef.current = "";
    if (flushRafRef.current != null) {
      cancelAnimationFrame(flushRafRef.current);
      flushRafRef.current = null;
    }

    streamAbortRef.current?.abort();
    const ac = new AbortController();
    streamAbortRef.current = ac;

    let streamFetchTimeoutId = null;
    let streamFetchDidTimeout = false;
    streamFetchTimeoutId = window.setTimeout(() => {
      streamFetchDidTimeout = true;
      ac.abort();
    }, STREAM_FETCH_TIMEOUT_MS);

    const priorMessages = messagesRef.current.slice();
    const historySlice =
      Array.isArray(apiHistorySlice) && apiHistorySlice.length > 0
        ? apiHistorySlice
        : priorMessages.slice(-3);
    const memoryDesignState = designStateRef.current;
    let coreForApi = buildRagMessageWithMemoryHint(text, memoryDesignState, []);
    if (isPlanner) {
      coreForApi = `${RAG_BUILDER_PERSONA_PREFIX}${coreForApi}`;
    }
    const messageForModel = buildApiMessageWithRecentHistory(
      historySlice,
      coreForApi
    );

    const { data: userRow, error: userErr } = await saveMessage({
      chat_id: sendChatId,
      role: "user",
      content: text,
    });
    if (userErr || !userRow) return;

    if (userId && userMessageSignalsApproval(text)) {
      void markLastAssistantMetricApproved(supabase, sendChatId, userId);
    }

    await supabase
      .from("chats")
      .update({ title: text.slice(0, 80) })
      .eq("id", sendChatId)
      .in("title", ["New chat", "Planning chat", "Learning chat"]);

    refreshChats?.();

    const nowIso = new Date().toISOString();

    const assistantLocal = {
      id: tempAssistantId(),
      role: "assistant",
      content: "",
      created_at: nowIso,
    };

    setMessages((prev) => [
      ...prev,
      {
        id: userRow.id,
        role: "user",
        content: text,
        created_at: userRow.created_at ?? nowIso,
      },
      assistantLocal,
    ]);
    setMessage("");
    setPendingTextAttachments([]);
    setStreamFinalizingUi(false);
    setLoading(true);

    consultationStreamPhaseRef.current = null;

    const syncFlushPending = () => {
      if (flushRafRef.current != null) {
        cancelAnimationFrame(flushRafRef.current);
        flushRafRef.current = null;
      }
      flushStreamBuffer();
    };

    const processSseBlock = (rawEvent) => {
      for (const line of rawEvent.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        let payload;
        try {
          payload = JSON.parse(line.slice(6));
        } catch {
          continue;
        }
        if (typeof payload.chunk === "string") {
          pendingContentRef.current += payload.chunk;
          if (payload.chunk.length > 0) {
            scheduleFlush();
          }
        }
        if (payload.done === true) {
          syncFlushPending();
          if (mountedRef.current) setStreamFinalizingUi(true);
        }
      }
    };

    const drainBuffer = (bufRef) => {
      let buffer = bufRef.value;
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        processSseBlock(rawEvent);
      }
      bufRef.value = buffer;
    };

    let reader;
    try {
      streamStartedAtRef.current = performance.now();
      const res = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildChatApiPayload(messageForModel, sendChatId, text)),
        signal: ac.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`Request failed: ${res.status}`);
      }

      reader = res.body.getReader();
      const decoder = new TextDecoder();
      const bufferRef = { value: "" };

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          bufferRef.value += decoder.decode();
          break;
        }
        bufferRef.value += decoder.decode(value, { stream: true });
        drainBuffer(bufferRef);
      }

      drainBuffer(bufferRef);
    } catch (e) {
      if (e?.name === "AbortError" || ac.signal.aborted) {
        assistantMirrorRef.current = streamFetchDidTimeout
          ? "This is taking longer than expected — the server may be waking up (cold start on free hosting can take 1–2 minutes). Please wait and send your message again."
          : "";
      } else {
        console.error(e);
        if (mountedRef.current) {
          const botReply = await getResponse(messageForModel);
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant" && last.content === "") {
              assistantMirrorRef.current = botReply;
              next[next.length - 1] = { ...last, content: botReply };
            }
            return next;
          });
        }
      }
    } finally {
      if (streamFetchTimeoutId != null) {
        clearTimeout(streamFetchTimeoutId);
        streamFetchTimeoutId = null;
      }
      if (reader) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
      }
      if (flushRafRef.current != null) {
        cancelAnimationFrame(flushRafRef.current);
        flushRafRef.current = null;
      }
      flushStreamBuffer();
      if (mountedRef.current) setStreamFinalizingUi(false);

      const toPersist = assistantMirrorRef.current;
      assistantMirrorRef.current = "";

      const extractedForHybrid = isPlanner
        ? extractRequirements(text, {
            lastAssistantSnippet: lastSubstantiveAssistantContent(
              priorMessages
            ),
          })
        : {};
      const hasAnyHybrid =
        isPlanner &&
        Object.entries(extractedForHybrid).some(([k, v]) => {
          if (v == null) return false;
          if (k === "special_requirements")
            return Array.isArray(v) && v.length > 0;
          if (typeof v === "boolean") return true;
          return String(v).trim() !== "";
        });

      let mainContentToSave =
        toPersist !== "" ? sanitizeAssistantRagEcho(toPersist) : toPersist;
      if (toPersist !== "") {
        if (intent === "knowledge") {
          mainContentToSave = stripTrailingPlanJson(mainContentToSave);
        }
        if (intent === "hybrid" && hasAnyHybrid) {
          const alreadyBridged = priorMessages.some(
            (m) =>
              m?.role === "assistant" &&
              typeof m?.content === "string" &&
              m.content.includes(MSG_HYBRID_BRIDGE)
          );
          if (!alreadyBridged) {
          mainContentToSave = `${mainContentToSave}\n\n${MSG_HYBRID_BRIDGE}`;
          }
        }
      }

      if (
        mountedRef.current &&
        sendChatId &&
        toPersist !== "" &&
        !ac.signal.aborted
      ) {
        try {
          const { data: row, error: insErr } = await saveMessage({
            chat_id: sendChatId,
            role: "assistant",
            content: mainContentToSave,
          });

          if (!insErr && row && mountedRef.current) {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === "assistant") {
                next[next.length - 1] = {
                  ...last,
                  id: row.id,
                  content: mainContentToSave,
                  created_at: row.created_at ?? last.created_at,
                };
              }
              return next;
            });
            if (userId) {
              const { error: mErr } = await insertChatMetric(supabase, {
                chatId: sendChatId,
                userId,
                stage: stageForMetric(null),
                responseTimeMs: performance.now() - streamStartedAtRef.current,
                structured: assistantLooksStructured(mainContentToSave),
                userInputPreview: text,
                assistantMessageId: row.id,
              });
              if (mErr) console.error("chat_metrics insert", mErr);
            }

            if (isPlanner && intent === "hybrid" && hasAnyHybrid) {
              const merged = mergeRequirementsIntoState(
                designStateRef.current,
                extractedForHybrid
              );
              const nextState = { ...merged, stage: "gathering" };
              setDesignState(nextState);
              designStateRef.current = nextState;
            }

            void updateChatTitleWithLlm({
              supabase,
              chatId: sendChatId,
              messages: transcriptForChatTitle(
                titleThreadBaseRef.current,
                text,
                mainContentToSave
              ),
              chatType: API_CHAT_TYPE,
              refreshChats,
            });
          }
        } catch (persistErr) {
          console.error(persistErr);
        }
      }

      consultationStreamPhaseRef.current = null;

      if (mountedRef.current) {
        setLoading(false);
        inputRef.current?.focus({ preventScroll: true });
      }
    }
  }

  const sendOutgoingMessage = async (textOverride) => {
    const text = composeOutgoingText(textOverride);
    const sendChatId = currentChatId;
    if (!text || loading || !sendChatId) return;

    titleThreadBaseRef.current = messagesRef.current
      .filter(
        (m) =>
          (m.role === "user" || m.role === "assistant") &&
          !isAssistantChromeMessage(m)
      )
      .map((m) => ({ role: m.role, content: String(m.content || "") }));

    const apiHistorySlice = messagesRef.current.slice(-3);

    const stageNow = designStateRef.current?.stage ?? "gathering";
    const inGatheringStage =
      isPlanner &&
      (stageNow === "gathering" ||
        stageNow === "collecting" ||
        stageNow === "confirm" ||
        /^collecting_/.test(String(stageNow)));
    const fsmLocked =
      isPlanner &&
      (stageNow === "planning" ||
        stageNow === "approval" ||
        stageNow === "complete");

    const mergedForPlan = mergeRequirementsFromMessage(
      designStateRef.current,
      text,
      {
        lastAssistantSnippet: lastSubstantiveAssistantContent(
          messagesRef.current
        ),
      }
    );
    const detected = detectIntent(text, mergedForPlan);
    const canForcePlan =
      isPlanner &&
      stageNow !== "planning" &&
      stageNow !== "approval" &&
      stageNow !== "complete" &&
      hasEnoughForLayoutProfile(mergedForPlan);

    /**
     * Let knowledge-style turns hit RAG+LLM even during gathering / approval.
     * Keep planning stage on the consultation path so we do not interleave streams.
     * When forcing the first plan, skip a hybrid RAG detour (merged facts still feed planning).
     */
    const intent =
      stageNow === "planning"
        ? "consultation"
        : detected === "knowledge"
          ? "knowledge"
          : detected === "hybrid" && !canForcePlan
            ? "hybrid"
            : inGatheringStage || fsmLocked
              ? "consultation"
              : detected;

    if (import.meta.env.DEV) {
      console.log("[intent]", {
        intent,
        detected,
        isPlanner,
        stage: designStateRef.current?.stage,
        inputs: isPlanner
          ? {
              plot_size: mergedForPlan.plot_size,
              location: mergedForPlan.location,
              road_width: mergedForPlan.road_width,
              building_type: mergedForPlan.building_type,
              bhk: mergedForPlan.bhk,
              vastu_preference: mergedForPlan.vastu_preference,
              layout_style: mergedForPlan.layout_style,
            }
          : {},
        fsmLocked,
        canForcePlan,
        ...getIntentScores(text, mergedForPlan),
      });
    }

    if (
      intent === "knowledge" ||
      (intent === "hybrid" && !canForcePlan)
    ) {
      await runKnowledgeOrHybridIntent({
        text,
        sendChatId,
        intent,
        apiHistorySlice,
      });
      return;
    }

    const lastAssistantContent = lastSubstantiveAssistantContent(messages);
    const planStateForced = canForcePlan
      ? enrichPlanningState(mergedForPlan)
      : null;
    const decision = canForcePlan
      ? {
          kind: "remote",
          messageToModel: wrapPlanningPrompt(planStateForced, ""),
          nextState: { ...planStateForced, stage: "planning" },
          phase: "planning",
          planningBridgeFromGathering: true,
        }
      : planConsultationTurn(
          designStateRef.current,
          text,
          lastAssistantContent ?? "",
          mergedForPlan
        );

    if (decision.kind === "local") {
      const { data: userRow, error: userErr } = await saveMessage({
        chat_id: sendChatId,
        role: "user",
        content: text,
      });
      if (userErr || !userRow) return;

      if (userId && userMessageSignalsApproval(text)) {
        void markLastAssistantMetricApproved(supabase, sendChatId, userId);
      }

      await supabase
        .from("chats")
        .update({ title: text.slice(0, 80) })
        .eq("id", sendChatId)
        .in("title", ["New chat", "Planning chat", "Learning chat"]);

      refreshChats?.();

      const nowIso = new Date().toISOString();
      const { data: asstRow, error: asstErr } = await saveMessage({
        chat_id: sendChatId,
        role: "assistant",
        content: decision.assistantText,
      });

      const assistantMsg = {
        id: asstRow?.id ?? tempAssistantId(),
        role: "assistant",
        content: decision.assistantText,
        created_at: asstRow?.created_at ?? nowIso,
      };

      setMessages((prev) => [
        ...prev,
        {
          id: userRow.id,
          role: "user",
          content: text,
          created_at: userRow.created_at ?? nowIso,
        },
        assistantMsg,
      ]);
      setMessage("");
      setPendingTextAttachments([]);

      if (userId && !asstErr && asstRow) {
        const { error: mErr } = await insertChatMetric(supabase, {
          chatId: sendChatId,
          userId,
          stage: localMetricStage(decision.nextState),
          responseTimeMs: 0,
          structured: assistantLooksStructured(decision.assistantText),
          userInputPreview: text,
          assistantMessageId: asstRow.id,
        });
        if (mErr) console.error("chat_metrics insert", mErr);
      }

      void updateChatTitleWithLlm({
        supabase,
        chatId: sendChatId,
        messages: transcriptForChatTitle(
          titleThreadBaseRef.current,
          text,
          decision.assistantText
        ),
        chatType: API_CHAT_TYPE,
        refreshChats,
      });

      const next = decision.nextState;
      setDesignState(next);
      designStateRef.current = next;
      inputRef.current?.focus({ preventScroll: true });
      return;
    }

    pendingContentRef.current = "";
    assistantMirrorRef.current = "";
    if (flushRafRef.current != null) {
      cancelAnimationFrame(flushRafRef.current);
      flushRafRef.current = null;
    }

    streamAbortRef.current?.abort();
    const ac = new AbortController();
    streamAbortRef.current = ac;

    let streamFetchTimeoutId = null;
    let streamFetchDidTimeout = false;
    streamFetchTimeoutId = window.setTimeout(() => {
      streamFetchDidTimeout = true;
      ac.abort();
    }, STREAM_FETCH_TIMEOUT_MS);

    const nextDesign = decision.nextState;

    const { data: userRow, error: userErr } = await saveMessage({
      chat_id: sendChatId,
      role: "user",
      content: text,
    });

    if (userErr || !userRow) {
      return;
    }

    if (userId && userMessageSignalsApproval(text)) {
      void markLastAssistantMetricApproved(supabase, sendChatId, userId);
    }

    setDesignState(nextDesign);
    designStateRef.current = nextDesign;

    await supabase
      .from("chats")
      .update({ title: text.slice(0, 80) })
      .eq("id", sendChatId)
      .in("title", ["New chat", "Planning chat", "Learning chat"]);

    refreshChats?.();

    const nowIso = new Date().toISOString();

    const assistantLocal = {
      id: tempAssistantId(),
      role: "assistant",
      content: "",
      created_at: nowIso,
    };

    setMessages((prev) => [
      ...prev,
      {
        id: userRow.id,
        role: "user",
        content: text,
        created_at: userRow.created_at ?? nowIso,
      },
      assistantLocal,
    ]);
    setMessage("");
    setPendingTextAttachments([]);
    setStreamFinalizingUi(false);
    setLoading(true);

    consultationStreamPhaseRef.current = decision.phase ?? null;

    const syncFlushPending = () => {
      if (flushRafRef.current != null) {
        cancelAnimationFrame(flushRafRef.current);
        flushRafRef.current = null;
      }
      flushStreamBuffer();
    };

    const processSseBlock = (rawEvent) => {
      for (const line of rawEvent.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        let payload;
        try {
          payload = JSON.parse(line.slice(6));
        } catch {
          continue;
        }
        if (typeof payload.chunk === "string") {
          pendingContentRef.current += payload.chunk;
          if (payload.chunk.length > 0) {
            scheduleFlush();
          }
        }
        if (payload.done === true) {
          syncFlushPending();
          if (mountedRef.current) setStreamFinalizingUi(true);
        }
      }
    };

    const drainBuffer = (bufRef) => {
      let buffer = bufRef.value;
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        processSseBlock(rawEvent);
      }
      bufRef.value = buffer;
    };

    let reader;

    const consultationPayload = buildApiMessageWithRecentHistory(
      apiHistorySlice,
      decision.messageToModel
    );

    try {
      streamStartedAtRef.current = performance.now();
      const res = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildChatApiPayload(consultationPayload, sendChatId, text)
        ),
        signal: ac.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`Request failed: ${res.status}`);
      }

      reader = res.body.getReader();
      const decoder = new TextDecoder();
      const bufferRef = { value: "" };

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          bufferRef.value += decoder.decode();
          break;
        }
        bufferRef.value += decoder.decode(value, { stream: true });
        drainBuffer(bufferRef);
      }

      drainBuffer(bufferRef);
    } catch (e) {
      if (e?.name === "AbortError" || ac.signal.aborted) {
        assistantMirrorRef.current = streamFetchDidTimeout
          ? "This is taking longer than expected — the server may be waking up (cold start on free hosting can take 1–2 minutes). Please wait and send your message again."
          : "";
        consultationStreamPhaseRef.current = null;
        return;
      }
      console.error(e);
      if (mountedRef.current) {
        const botReply = await getResponse(text);
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant" && last.content === "") {
            assistantMirrorRef.current = botReply;
            next[next.length - 1] = { ...last, content: botReply };
          }
          return next;
        });
      }
    } finally {
      if (streamFetchTimeoutId != null) {
        clearTimeout(streamFetchTimeoutId);
        streamFetchTimeoutId = null;
      }
      if (reader) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
      }
      if (flushRafRef.current != null) {
        cancelAnimationFrame(flushRafRef.current);
        flushRafRef.current = null;
      }
      flushStreamBuffer();
      if (mountedRef.current) setStreamFinalizingUi(false);

      const toPersistRaw = assistantMirrorRef.current;
      assistantMirrorRef.current = "";
      const toPersist =
        toPersistRaw !== "" ? sanitizeAssistantRagEcho(toPersistRaw) : "";

      if (
        mountedRef.current &&
        sendChatId &&
        toPersist !== "" &&
        !ac.signal.aborted
      ) {
        try {
          const { data: row, error: insErr } = await saveMessage({
            chat_id: sendChatId,
            role: "assistant",
            content: toPersist,
          });

          if (!insErr && row && mountedRef.current) {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === "assistant") {
                next[next.length - 1] = {
                  ...last,
                  id: row.id,
                  content: toPersist,
                  created_at: row.created_at ?? last.created_at,
                };
              }
              return next;
            });
            if (userId) {
              const phase = consultationStreamPhaseRef.current;
              const { error: mErr } = await insertChatMetric(supabase, {
                chatId: sendChatId,
                userId,
                stage: stageForMetric(phase),
                responseTimeMs: performance.now() - streamStartedAtRef.current,
                structured: assistantLooksStructured(toPersist),
                userInputPreview: text,
                assistantMessageId: row.id,
              });
              if (mErr) console.error("chat_metrics insert", mErr);
            }
            void updateChatTitleWithLlm({
              supabase,
              chatId: sendChatId,
              messages: transcriptForChatTitle(
                titleThreadBaseRef.current,
                text,
                toPersist
              ),
              chatType: API_CHAT_TYPE,
              refreshChats,
            });
          }
        } catch (persistErr) {
          console.error(persistErr);
        }
      }

      const phase = consultationStreamPhaseRef.current;
      consultationStreamPhaseRef.current = null;

      if (phase === "planning") {
        const appr = { ...designStateRef.current, stage: "approval" };
        setDesignState(appr);
        designStateRef.current = appr;
      }
      if (mountedRef.current) {
        setLoading(false);
        inputRef.current?.focus({ preventScroll: true });
      }
    }
  };

  const sendMessage = async () => {
    await sendOutgoingMessage(undefined);
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (loading || composerHardDisabled) return;
      void sendMessage();
    }
  };

  const openTextFilePicker = () => {
    if (composerLocked) return;
    fileInputRef.current?.click();
  };

  const removeTextAttachment = (id) => {
    setPendingTextAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const toggleSpeechRecognition = useCallback(() => {
    if (composerLocked) return;
    const SR = getSpeechRecognitionCtor();
    if (!SR) {
      window.alert(
        "Voice typing needs a browser with speech recognition. Chrome or Edge on desktop usually work best."
      );
      return;
    }

    const clearSpeechStopFallback = () => {
      if (speechStopFallbackRef.current != null) {
        clearTimeout(speechStopFallbackRef.current);
        speechStopFallbackRef.current = null;
      }
    };

    const clearSpeechRestartTimer = () => {
      if (speechRestartTimerRef.current != null) {
        clearTimeout(speechRestartTimerRef.current);
        speechRestartTimerRef.current = null;
      }
    };

    const commitSpeechTranscript = () => {
      setMessage(speechSnapshotRef.current);
    };

    /** User clicked mic OFF â€” stop sessions and pending restarts only. */
    const stopSpeechMic = () => {
      speechMicShouldRunRef.current = false;
      clearSpeechStopFallback();
      clearSpeechRestartTimer();
      const active = speechRecognitionRef.current;
      if (active) {
        try {
          active.stop();
        } catch {
          try {
            active.abort();
          } catch {
            /* ignore */
          }
        }
        speechRecognitionRef.current = null;
      }
      if (mountedRef.current) {
        setSpeechListening(false);
        commitSpeechTranscript();
      }
    };

    /** Mic is on (or between browser session restarts) â€” click means OFF. */
    if (speechMicShouldRunRef.current || speechListening) {
      stopSpeechMic();
      return;
    }

    clearSpeechStopFallback();
    clearSpeechRestartTimer();
    speechMicShouldRunRef.current = true;

    const raw = latestMessageRef.current;
    speechBaseRef.current =
      raw.length > 0 && !/\s$/u.test(raw) ? `${raw} ` : raw;
    speechSnapshotRef.current = speechBaseRef.current;

    const startSpeechSession = () => {
      if (!mountedRef.current || !speechMicShouldRunRef.current) return;
      const rec = new SR();

      rec.continuous = true;
      rec.interimResults = true;
      rec.lang =
        typeof navigator !== "undefined" && navigator.language
          ? navigator.language
          : "en-US";

      rec.onresult = (event) => {
        if (!mountedRef.current) return;
        /* Join all segments in this session â€” some engines rarely fire `isFinal` before `onend`. */
        let sessionText = "";
        for (let i = 0; i < event.results.length; i++) {
          sessionText += event.results[i][0]?.transcript ?? "";
        }
        const full = speechBaseRef.current + sessionText;
        speechSnapshotRef.current = full;
        setMessage(full);
      };

      rec.onerror = (ev) => {
        if (ev.error === "aborted") return;
        if (ev.error === "no-speech") return;
        clearSpeechStopFallback();
        clearSpeechRestartTimer();
        speechMicShouldRunRef.current = false;
        if (ev.error === "not-allowed") {
          window.alert(
            "Microphone access was blocked. Allow the mic for this site in your browser settings."
          );
        }
        if (speechRecognitionRef.current === rec) {
          speechRecognitionRef.current = null;
        }
        if (mountedRef.current) {
          setSpeechListening(false);
          commitSpeechTranscript();
        }
      };

      rec.onend = () => {
        clearSpeechStopFallback();
        if (speechRecognitionRef.current !== rec) return;
        speechRecognitionRef.current = null;
        if (!mountedRef.current) return;

        if (!speechMicShouldRunRef.current) {
          setSpeechListening(false);
          commitSpeechTranscript();
          return;
        }

        /* Browser ended the session (silence, limit, etc.) â€” keep mic "on" and restart. */
        clearSpeechRestartTimer();
        speechRestartTimerRef.current = window.setTimeout(() => {
          speechRestartTimerRef.current = null;
          if (!mountedRef.current || !speechMicShouldRunRef.current) {
            if (mountedRef.current) {
              setSpeechListening(false);
              commitSpeechTranscript();
            }
            return;
          }
          /* New `SpeechRecognition` has an empty `results` list â€” carry text forward. */
          speechBaseRef.current = speechSnapshotRef.current;
          startSpeechSession();
        }, 80);
      };

      try {
        speechRecognitionRef.current = rec;
        rec.start();
        if (mountedRef.current) setSpeechListening(true);
      } catch (err) {
        console.error(err);
        speechMicShouldRunRef.current = false;
        speechRecognitionRef.current = null;
        clearSpeechRestartTimer();
        if (mountedRef.current) {
          setSpeechListening(false);
          window.alert("Could not start voice input. Try again.");
        }
      }
    };

    startSpeechSession();
  }, [composerLocked, speechListening]);

  const onTextFileSelected = (e) => {
    const inputEl = e.target;
    const file = inputEl.files?.[0];
    inputEl.value = "";
    if (!file || composerLocked) return;

    const name = file.name.toLowerCase();
    const looksText =
      file.type === "text/plain" ||
      file.type === "" ||
      name.endsWith(".txt");
    if (!looksText) {
      window.alert("Please choose a plain text (.txt) file.");
      return;
    }

    if (file.size > MAX_TEXT_FILE_BYTES) {
      window.alert(
        `Text file is too large (max ${Math.round(MAX_TEXT_FILE_BYTES / 1024)} KB).`
      );
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (!mountedRef.current) return;
      const raw = typeof reader.result === "string" ? reader.result : "";
      const body = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
      setPendingTextAttachments((prev) => [
        ...prev,
        { id: crypto.randomUUID(), name: file.name, text: body },
      ]);
      requestAnimationFrame(() =>
        inputRef.current?.focus({ preventScroll: true })
      );
    };
    reader.onerror = () => {
      console.error("Could not read text file");
      window.alert("Could not read that file. Try another .txt file.");
    };
    reader.readAsText(file, "UTF-8");
  };

  const typingStatusLabel = "Writing your reply...";

  return (
    <div className="chat-main" data-chat-type={API_CHAT_TYPE}>
      <header className="chat-topbar chat-topbar--workspace-toggle">
        <div className="chat-topbar__brand">
          <div className="chat-topbar__persona-slot">
            <div
              className="chat-topbar__persona-display"
              aria-hidden="true"
              title="VisionDesignie"
            >
              <img
                className="chat-topbar__persona-avatar chat-topbar__persona-avatar--brand"
                src={ASSISTANT_AVATAR_URL}
                alt=""
                width={42}
                height={42}
                decoding="async"
              />
            </div>
          </div>
          <div className="chat-topbar__brand-copy">
            <span className="chat-topbar__brand-title">VisionDesignie</span>
            <span className="chat-topbar__brand-sub">
              One architect assistant - understand, explain, design
            </span>
          </div>
        </div>
        <div className="chat-topbar__trailing">
          {canOpenFloorPanel ? (
            <button
              type="button"
              className="chat-topbar__design-toggle"
              aria-pressed={designPanelOpen}
              onClick={() => setDesignPanelOpen(true)}
              title="Open floor plan sketch"
            >
              <span>Floor plan</span>
            </button>
          ) : null}
          {canOpenFloorPanel && layoutPlan && !layoutError ? (
            <button
              type="button"
              className="chat-topbar__design-toggle chat-topbar__vision3d-btn"
              onClick={() => void handleOpenVision3D()}
              title="Open 3D plan"
            >
              <span>3D plan</span>
            </button>
          ) : null}
          {onOpenDashboard ? (
            <button
              type="button"
              className="chat-topbar__dashboard"
              onClick={() => onOpenDashboard()}
              aria-label="Open analytics dashboard"
              title="Open analytics dashboard"
            >
              Dashboard
            </button>
          ) : null}
          <button
            type="button"
            className="chat-topbar__theme"
            onClick={() =>
              onThemeChange?.(theme === "light" ? "cosmic" : "light")
            }
            aria-label={
              theme === "light" ? "Switch to Cosmic theme" : "Switch to Light theme"
            }
          >
            {theme === "light" ? (
              <IconMoon className="chat-topbar__theme-icon" />
            ) : (
              <IconSun className="chat-topbar__theme-icon" />
            )}
            <span>{theme === "light" ? "Cosmic" : "Light"}</span>
          </button>
        </div>
      </header>

      <div
        ref={scrollContainerRef}
        className={`chat-main__scroll${!noChat && messages.length === 0 && !loading ? " chat-main__scroll--empty" : ""}`}
        role="log"
        aria-live="polite"
      >
        {noChat ? (
          <div className="chat-empty">
            <p className="chat-empty__meta">
              {chatsLoading
                ? "Loading your conversations..."
                : "Start a new conversation to begin designing."}
            </p>
          </div>
        ) : messages.length === 0 && !loading ? (
          <div className="chat-empty-state">
            <div className="chat-empty chat-empty--with-action">
              <p className="chat-empty__hint">
                {threadHydrating
                  ? "Loading this conversation..."
                  : "Tell me about your plot or what you're planning to build - ask anything about layout, codes, or concepts."}
              </p>
            </div>
          </div>
        ) : null}

        {!noChat && (
          <div className="chat-thread">
            {messages.map((m, i) => {
              const isUser = m.role === "user";
              const role = isUser ? "user" : "assistant";
              const isLast = i === messages.length - 1;
              const typingHere =
                !isUser && m.content === "" && loading && isLast;
              const showStreamFinalize =
                !isUser &&
                isLast &&
                loading &&
                streamFinalizingUi &&
                (m.content || "").trim() !== "";
              const formattedTime = formatMessageTime(m.created_at);
              const copiedThis = copiedAssistantMessageId === m.id;
              return (
                <div
                  key={m.id}
                  className={`chat-message ${role}${m.personaSwitchNotice ? " chat-message--persona-switch" : ""}`}
                >
                  <div className="chat-message__shell chat-row">
                    {!isUser ? (
                      <div
                        className="chat-avatar chat-avatar--assistant chat-avatar--persona chat-avatar--vd-assistant"
                        title="VisionDesignie"
                        aria-hidden="true"
                      >
                        <img
                          className="chat-avatar__img chat-avatar__img--brand"
                          src={ASSISTANT_AVATAR_URL}
                          alt=""
                          width={40}
                          height={40}
                          decoding="async"
                        />
                      </div>
                    ) : null}
                    <div className="chat-message__column">
                      {typingHere ? (
                        <div className="chat-typing" aria-live="polite">
                          <div
                            className="chat-bubble chat-bubble--assistant chat-bubble--typing"
                            aria-busy="true"
                            aria-label={typingStatusLabel}
                          >
                            <div className="chat-content chat-content--typing">
                              <span className="chat-typing-label">
                                {typingStatusLabel}
                              </span>
                              <span
                                className="chat-typing-dots"
                                aria-hidden="true"
                              >
                                <span className="chat-typing-dot" />
                                <span className="chat-typing-dot" />
                                <span className="chat-typing-dot" />
                              </span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div
                          className={`chat-bubble ${isUser ? "chat-bubble--user" : "chat-bubble--assistant"}${m.personaSwitchNotice ? " chat-bubble--persona-switch" : ""}`}
                        >
                          <div className="chat-content">
                            {isUser ? (
                              m.content
                            ) : m.personaSwitchNotice ? (
                              <div
                                className="chat-persona-switch"
                                role="status"
                                aria-label="Guide mode changed"
                              >
                                <span
                                  className="chat-persona-switch__label"
                                  aria-hidden="true"
                                >
                                  <span className="chat-persona-switch__icon">
                                    {"<->"}
                                  </span>
                                  Mode switch
                                </span>
                                <p className="chat-persona-switch__text">
                                  {m.content}
                                </p>
                              </div>
                            ) : (
                              <>
                                <ArchitectMessageContent
                                  content={m.content}
                                  animateTyping={
                                    isLast &&
                                    !isUser &&
                                    !m.personaSwitchNotice &&
                                    (loading || showStreamFinalize)
                                  }
                                />
                                {showStreamFinalize ? (
                                  <p
                                    className="chat-stream-finalize-hint"
                                    aria-live="polite"
                                  >
                                    Finalizing...
                                  </p>
                                ) : null}
                              </>
                            )}
                          </div>
                          {!isUser &&
                          m.content?.trim() &&
                          !m.personaSwitchNotice ? (
                            <div className="chat-bubble__actions">
                              <button
                                type="button"
                                className={`chat-copy-btn${copiedThis ? " chat-copy-btn--copied" : ""}`}
                                onClick={() => copyAssistantMessage(m.id, m.content)}
                                title={copiedThis ? "Copied" : "Copy message"}
                                aria-label={
                                  copiedThis
                                    ? "Message copied"
                                    : "Copy assistant message"
                                }
                              >
                                {copiedThis ? "Copied" : "Copy"}
                              </button>
                            </div>
                          ) : null}
                          <div className="chat-time">{formattedTime}</div>
                        </div>
                      )}
                    </div>
                    {isUser ? (
                      <div
                        className="chat-avatar chat-avatar--user"
                        title={username.trim() || "You"}
                        aria-label={
                          username.trim() ? `You, ${username.trim()}` : "You"
                        }
                      >
                        <img
                          className="chat-avatar__img"
                          src={USER_AVATAR_URL}
                          alt=""
                          width={40}
                          height={40}
                          decoding="async"
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div ref={messagesEndRef} className="chat-scroll-end" />
      </div>

      {canOpenFloorPanel && !floorPlanComposerCtaDismissed ? (
        <div className="chat-layout-cta">
          <div className="chat-layout-cta__row">
            <div className="chat-layout-cta__slot">
              <button
                type="button"
                className="chat-layout-cta__btn"
                onClick={() => setDesignPanelOpen(true)}
                title={
                  layoutError && !layoutPlan
                    ? "Sketch unavailable - open for details"
                    : "Open floor plan sketch"
                }
                aria-label={
                  layoutError && !layoutPlan
                    ? "View floor plan: sketch could not be built from the saved plot size"
                    : "View floor plan sketch from saved requirements"
                }
              >
                View floor plan
              </button>
              <button
                type="button"
                className="chat-layout-cta__cancel"
                onClick={(e) => {
                  e.stopPropagation();
                  setFloorPlanComposerCtaDismissed(true);
                }}
                aria-label="Hide floor plan shortcut"
                title="Hide shortcut"
              >
                x
              </button>
            </div>
            {layoutPlan && !layoutError ? (
              <button
                type="button"
                className="chat-layout-cta__btn chat-layout-cta__btn--3d"
                onClick={() => void handleOpenVision3D()}
                title="Open 3D preview"
              >
                3D view
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="chat-composer">
        <div className="chat-input-wrapper">
          {pendingTextAttachments.length > 0 ? (
            <div
              className="chat-input-attachments"
              aria-label="Attached text files"
            >
              {pendingTextAttachments.map((a) => (
                <div key={a.id} className="chat-input-attachment">
                  <span className="chat-input-attachment__icon" aria-hidden>
                    [TXT]
                  </span>
                  <span className="chat-input-attachment__name" title={a.name}>
                    {a.name}
                  </span>
                  <button
                    type="button"
                    className="chat-input-attachment__remove"
                    aria-label={`Remove ${a.name}`}
                    disabled={composerLocked}
                    onClick={() => removeTextAttachment(a.id)}
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="chat-input-box">
            <input
              ref={fileInputRef}
              type="file"
              className="chat-input__file"
              accept=".txt,text/plain"
              tabIndex={-1}
              aria-hidden
              onChange={onTextFileSelected}
            />
            <button
              type="button"
              className="chat-input__icon"
              aria-label="Attach a text file (.txt)"
              title="Attach .txt file - shown above; sent with your message"
              disabled={composerLocked}
              onClick={openTextFilePicker}
            >
              +
            </button>
            <button
              type="button"
              className={`chat-input__mic${speechListening ? " chat-input__mic--listening" : ""}`}
              disabled={composerLocked || !speechSupported}
              aria-label={
                speechListening ? "Stop voice input" : "Voice input - speak to type"
              }
              aria-pressed={speechListening}
              title={
                !speechSupported
                  ? "Voice input needs Chrome, Edge, or Safari"
                  : speechListening
                    ? "Click again to stop"
                    : "Click to start - speak; click again to stop"
              }
              onClick={() => toggleSpeechRecognition()}
            >
              <IconMicOutlined className="chat-input__mic-svg" />
            </button>
            <textarea
              ref={inputRef}
              className="chat-input__field"
              placeholder={
                speechListening
                  ? "Listening... speak now"
                  : chatsLoading
                    ? "Loading..."
                    : noChat
                      ? "Waiting for a chat..."
                      : loading
                        ? "VisionDesignie is replying..."
                        : "Ask about your plot, layout, or any architecture question..."
              }
              rows={1}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={composerHardDisabled}
              readOnly={textareaReadOnly}
              aria-label="Message to VisionDesignie"
              aria-busy={loading || undefined}
            />
            <button
              type="button"
              className="chat-input__send"
              onClick={() => void sendMessage()}
              disabled={
                composerLocked ||
                (!message.trim() && pendingTextAttachments.length === 0)
              }
              aria-label={loading ? "Sending..." : "Send message"}
            >
              {loading ? (
                <span className="chat-input__send-spinner" aria-hidden="true" />
              ) : (
                <IconSendPlane className="chat-input__send-svg" />
              )}
            </button>
          </div>
        </div>
      </div>

      <DesignPanel
        key={currentChatId ?? "no-chat"}
        open={designPanelOpen}
        onClose={() => setDesignPanelOpen(false)}
        plan={layoutPlan}
        plotError={layoutError}
        designState={designState}
        onRequestRedesign={handleRedesignFromPanel}
        onOpenVision3D={
          layoutPlan && !layoutError ? handleOpenVision3D : undefined
        }
      />
    </div>
  );
}


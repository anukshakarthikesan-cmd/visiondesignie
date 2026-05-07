import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import supabase from "../lib/supabaseClient";
import "./Dashboard.css";

function formatDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export default function ConversationDetails({ theme = "light", userId = null }) {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [chat, setChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        if (!userId || !chatId) {
          setChat(null);
          setMessages([]);
          setMetrics([]);
          return;
        }
        const [{ data: c, error: cErr }, { data: m, error: mErr }, { data: k, error: kErr }] =
          await Promise.all([
            supabase.from("chats").select("id,title,created_at").eq("id", chatId).maybeSingle(),
            supabase
              .from("messages")
              .select("id,role,content,created_at")
              .eq("chat_id", chatId)
              .order("created_at", { ascending: true })
              .limit(500),
            supabase
              .from("chat_metrics")
              .select("stage,response_time_ms,structured,approved,created_at,user_input_preview")
              .eq("chat_id", chatId)
              .order("created_at", { ascending: false })
              .limit(250),
          ]);
        if (cErr) throw cErr;
        if (mErr) throw mErr;
        if (kErr) throw kErr;
        if (!cancelled) {
          setChat(c || null);
          setMessages(m || []);
          setMetrics(k || []);
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setError(e?.message || "Could not load conversation details.");
          setChat(null);
          setMessages([]);
          setMetrics([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [chatId, userId]);

  const stats = useMemo(() => {
    const first = messages[0];
    const responseMs = metrics
      .map((x) => Number(x.response_time_ms))
      .filter((n) => Number.isFinite(n));
    return {
      firstMessageAt: first?.created_at || null,
      messageCount: messages.length,
      avgResponseMs: responseMs.length
        ? Math.round(responseMs.reduce((a, b) => a + b, 0) / responseMs.length)
        : 0,
      structuredRate: metrics.length
        ? Math.round((metrics.filter((x) => x.structured).length / metrics.length) * 100)
        : 0,
    };
  }, [messages, metrics]);

  return (
    <div className={`dashboard conversation-details ${theme === "cosmic" ? "conversation-details--cosmic" : ""}`}>
      <header className="dashboard__topbar">
        <h1 className="dashboard__title">Conversation details</h1>
        <div className="dashboard__actions">
          <button type="button" className="dashboard__btn" onClick={() => navigate("/dashboard")}>
            Back to dashboard
          </button>
          <button type="button" className="dashboard__btn dashboard__btn--primary" onClick={() => navigate("/")}>
            Open chat
          </button>
        </div>
      </header>

      {error ? <div className="dashboard__banner dashboard__banner--warn">{error}</div> : null}

      <div className="dashboard__body">
        <section className="conversation-details__summary" aria-label="Conversation summary">
          <article className="conversation-details__summary-card">
            <h3>First message sent</h3>
            <p>{stats.firstMessageAt ? formatDateTime(stats.firstMessageAt) : "—"}</p>
          </article>
          <article className="conversation-details__summary-card">
            <h3>Number of messages</h3>
            <p>{stats.messageCount}</p>
          </article>
          <article className="conversation-details__summary-card">
            <h3>Title</h3>
            <p>{chat?.title || "Conversation"}</p>
          </article>
          <article className="conversation-details__summary-card">
            <h3>Avg response</h3>
            <p>{stats.avgResponseMs} ms</p>
          </article>
          <article className="conversation-details__summary-card">
            <h3>Structured</h3>
            <p>{stats.structuredRate}%</p>
          </article>
        </section>

        <section className="conversation-details__grid">
          <article className="conversation-details__messages">
            <div className="conversation-details__panel-title">Messages</div>
            {loading ? (
              <p className="dashboard__empty">Loading...</p>
            ) : messages.length === 0 ? (
              <p className="dashboard__empty">No messages for this conversation.</p>
            ) : (
              <div className="conversation-details__stream">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`conversation-details__bubble conversation-details__bubble--${m.role === "assistant" ? "assistant" : "user"}`}
                  >
                    <div className="conversation-details__bubble-meta">
                      <span>{m.role}</span>
                      <time>{formatDateTime(m.created_at)}</time>
                    </div>
                    <p>{m.content}</p>
                  </div>
                ))}
              </div>
            )}
          </article>
        </section>
      </div>
    </div>
  );
}

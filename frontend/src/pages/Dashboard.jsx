import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import supabase from "../lib/supabaseClient";
import "./Dashboard.css";

const CHART_H = 230;

const DEMO_METRIC_ROWS = [
  { stage: "analysis", response_time_ms: 1820, approved: false, structured: true, created_at: "2026-04-11T14:22:00Z", chat_id: "a", user_input_preview: "40×50 ft plot" },
  { stage: "planning", response_time_ms: 2640, approved: true, structured: true, created_at: "2026-04-11T13:05:00Z", chat_id: "a", user_input_preview: "add utility near stair" },
  { stage: "general", response_time_ms: 920, approved: false, structured: false, created_at: "2026-04-10T18:40:00Z", chat_id: "b", user_input_preview: "what is FSI" },
  { stage: "planning", response_time_ms: 4020, approved: false, structured: true, created_at: "2026-04-08T08:00:00Z", chat_id: "c", user_input_preview: "continue layout" },
];

function dateHourLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dateDayLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function bucketByHour(rows, hoursBack = 6) {
  const now = Date.now();
  const buckets = [];
  for (let i = hoursBack - 1; i >= 0; i--) {
    const from = now - (i + 1) * 3600_000;
    const to = now - i * 3600_000;
    const inBucket = rows.filter((r) => {
      const t = new Date(r.created_at).getTime();
      return Number.isFinite(t) && t >= from && t < to;
    });
    buckets.push({
      hour: dateHourLabel(from),
      activeConversations: new Set(inBucket.map((r) => r.chat_id)).size,
      messageCount: inBucket.length,
    });
  }
  return buckets;
}

function bucketByDay(rows, daysBack = 7) {
  const now = Date.now();
  const buckets = [];
  for (let i = daysBack - 1; i >= 0; i--) {
    const from = now - (i + 1) * 24 * 3600_000;
    const to = now - i * 24 * 3600_000;
    const inBucket = rows.filter((r) => {
      const t = new Date(r.created_at).getTime();
      return Number.isFinite(t) && t >= from && t < to;
    });
    buckets.push({
      day: dateDayLabel(from),
      conversations: new Set(inBucket.map((r) => r.chat_id)).size,
      completions: inBucket.length,
    });
  }
  return buckets;
}

function avg(nums) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function p95(nums) {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[idx];
}

function latencyBucket(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return "3s+";
  if (n < 1000) return "0-1s";
  if (n < 2000) return "1-2s";
  if (n < 3000) return "2-3s";
  return "3s+";
}

function asIso(isoLike) {
  const d = new Date(isoLike);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

export default function Dashboard({
  theme = "light",
  onBackToChat,
  onOpenConversation,
  userId = null,
}) {
  const [loading, setLoading] = useState(true);
  const [metricRows, setMetricRows] = useState([]);
  const [chats, setChats] = useState([]);
  const [fetchError, setFetchError] = useState(null);
  const [searchParams] = useSearchParams();

  const demoMode =
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_DASHBOARD_DEMO === "1") ||
    ["1", "true", "eval"].includes(String(searchParams.get("demo") || "").toLowerCase());

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      if (!userId) {
        setMetricRows([]);
        setChats([]);
        return;
      }

      const [{ data: chatsData, error: chatsError }, { data: metricsData, error: metricsError }] =
        await Promise.all([
          supabase
            .from("chats")
            .select("id,title,created_at")
            .order("created_at", { ascending: false })
            .limit(24),
          supabase
            .from("chat_metrics")
            .select("chat_id,stage,response_time_ms,approved,structured,created_at,user_input_preview")
            .order("created_at", { ascending: false })
            .limit(500),
        ]);

      if (chatsError) throw chatsError;
      if (metricsError) throw metricsError;

      const chatList = chatsData || [];
      const rows = metricsData || [];
      setChats(chatList);
      setMetricRows(rows);
    } catch (e) {
      console.error(e);
      setFetchError(e?.message || "Could not load dashboard metrics.");
      setMetricRows([]);
      setChats([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    if (!userId) return [];
    if (metricRows.length) return metricRows;
    return demoMode ? DEMO_METRIC_ROWS : [];
  }, [userId, metricRows, demoMode]);

  const hourSeries = useMemo(() => bucketByHour(rows, 6), [rows]);
  const day24Series = useMemo(() => bucketByDay(rows, 1), [rows]);

  const kpis = useMemo(() => {
    const conversationSet = new Set(rows.map((r) => r.chat_id));
    const responseMs = rows.map((r) => Number(r.response_time_ms)).filter((n) => Number.isFinite(n));
    const perConversation = conversationSet.size ? rows.length / conversationSet.size : 0;
    const avgHour = avg(hourSeries.map((x) => x.messageCount));
    return {
      p95LatencyMs: Math.round(p95(responseMs)),
      conversationsAvgHour: Number(avgHour.toFixed(1)),
      conversationsAvg24h: day24Series[0]?.conversations || 0,
      messagesPerConversation: Number(perConversation.toFixed(2)),
      conversationLength: `${Math.round(avg(responseMs) / 1000)}s`,
      messagesCount24h: day24Series[0]?.completions || 0,
    };
  }, [rows, hourSeries, day24Series]);

  const currentConversationCards = useMemo(() => {
    const byChat = new Map();
    for (const r of rows) {
      if (!r.chat_id) continue;
      if (!byChat.has(r.chat_id)) {
        byChat.set(r.chat_id, {
          chatId: r.chat_id,
          messages: 0,
          firstMessageAt: r.created_at,
          insight: r.user_input_preview || "—",
          stage: r.stage || "general",
        });
      }
      const v = byChat.get(r.chat_id);
      v.messages += 1;
      if (new Date(r.created_at).getTime() < new Date(v.firstMessageAt).getTime()) {
        v.firstMessageAt = r.created_at;
      }
      if (!v.insight || v.insight === "—") v.insight = r.user_input_preview || "—";
    }

    const titleMap = new Map(chats.map((c) => [c.id, c.title || "Conversation"]));

    return Array.from(byChat.values())
      .map((x) => ({
        ...x,
        title: titleMap.get(x.chatId) || "Conversation",
      }))
      .sort((a, b) => b.messages - a.messages)
      .slice(0, 3);
  }, [rows, chats]);

  const planningVsKnowledge = useMemo(() => {
    let planning = 0;
    let knowledge = 0;
    for (const r of rows) {
      const s = String(r.stage || "").toLowerCase();
      if (s === "planning") planning += 1;
      else knowledge += 1;
    }
    return [
      { name: "Planning usage", value: planning },
      { name: "Knowledge usage", value: knowledge },
    ];
  }, [rows]);

  const latencyHistogram = useMemo(() => {
    const buckets = { "0-1s": 0, "1-2s": 0, "2-3s": 0, "3s+": 0 };
    for (const r of rows) {
      const b = latencyBucket(r.response_time_ms);
      buckets[b] += 1;
    }
    return Object.entries(buckets).map(([range, count]) => ({ range, count }));
  }, [rows]);

  const chartPalette = theme === "cosmic" ? ["#7c3aed", "#a78bfa"] : ["#1d4ed8", "#60a5fa"];
  const pieUsageColors = theme === "cosmic" ? ["#8b5cf6", "#b79cff"] : ["#6ea8fe", "#9fc5ff"];

  const systemLogs = useMemo(() => {
    /** @type {Array<{level: 'info'|'warn'|'error', at: string, message: string}>} */
    const logs = [];

    if (fetchError) {
      logs.push({
        level: "error",
        at: new Date().toISOString(),
        message: `Dashboard data fetch failed: ${fetchError}`,
      });
    }

    if (!loading && rows.length === 0) {
      logs.push({
        level: "warn",
        at: new Date().toISOString(),
        message: "No analytics rows available yet in chat_metrics.",
      });
    }

    const responseMs = rows
      .map((r) => Number(r.response_time_ms))
      .filter((n) => Number.isFinite(n));
    if (responseMs.length) {
      const highLatencyCount = responseMs.filter((n) => n >= 3000).length;
      if (highLatencyCount > 0) {
        logs.push({
          level: "warn",
          at: new Date().toISOString(),
          message: `${highLatencyCount} completion(s) exceeded 3s latency in current scope.`,
        });
      }
    }

    if (rows.length) {
      const structuredPct = Math.round(
        (rows.filter((r) => Boolean(r.structured)).length / rows.length) * 100
      );
      if (structuredPct < 50) {
        logs.push({
          level: "warn",
          at: new Date().toISOString(),
          message: `Structured response rate is low (${structuredPct}%).`,
        });
      } else {
        logs.push({
          level: "info",
          at: new Date().toISOString(),
          message: `Structured response rate healthy at ${structuredPct}%.`,
        });
      }
    }

    const latestCompletions = [...rows]
      .slice(0, 8)
      .map((r) => ({
        level: Number(r.response_time_ms) >= 3000 ? "warn" : "info",
        at: asIso(r.created_at),
        message: `Completion [${r.stage || "general"}] in ${Math.round(
          Number(r.response_time_ms) || 0
        )} ms.`,
      }));

    logs.push(...latestCompletions);
    return logs
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 12);
  }, [rows, fetchError, loading]);

  return (
    <div className="dashboard">
      <header className="dashboard__topbar">
        <h1 className="dashboard__title">Dashboard</h1>
        <div className="dashboard__actions">
          <button type="button" className="dashboard__btn" onClick={() => void load()}>
            Refresh
          </button>
          <button type="button" className="dashboard__btn dashboard__btn--primary" onClick={() => onBackToChat?.()}>
            Open Chat
          </button>
        </div>
      </header>

      {fetchError ? <div className="dashboard__banner dashboard__banner--warn">{fetchError}</div> : null}
      {!userId ? <div className="dashboard__banner">Sign in to view dashboard.</div> : null}

      <div className="dashboard__body">
        <section className="dashboard__kpis" aria-label="Top KPI cards">
          <article className="dashboard__kpi-card"><h3>P95 latency</h3><p>{kpis.p95LatencyMs} ms</p><span>worst-case responsiveness</span></article>
          <article className="dashboard__kpi-card"><h3>Conversations</h3><p>{kpis.conversationsAvgHour}</p><span>avg/hour last 6h</span></article>
          <article className="dashboard__kpi-card"><h3>Conversations</h3><p>{kpis.conversationsAvg24h}</p><span>across last 24h</span></article>
          <article className="dashboard__kpi-card"><h3>Messages/conversation</h3><p>{kpis.messagesPerConversation}</p><span>across loaded sample</span></article>
          <article className="dashboard__kpi-card"><h3>Avg response time</h3><p>{kpis.conversationLength}</p><span>avg response duration</span></article>
          <article className="dashboard__kpi-card"><h3>Messages count</h3><p>{kpis.messagesCount24h}</p><span>last 24h</span></article>
        </section>

        <section className="dashboard__section">
          <h2 className="dashboard__section-title">Current conversations</h2>
          <div className="dashboard__conversation-cards">
            {loading ? (
              <p className="dashboard__empty">Loading...</p>
            ) : currentConversationCards.length === 0 ? (
              <p className="dashboard__empty">No conversation samples yet.</p>
            ) : (
              currentConversationCards.map((c) => (
                <article key={c.chatId} className="dashboard__conversation-card">
                  <header>
                    <strong>{c.messages} messages</strong>
                    <span>{dateHourLabel(c.firstMessageAt)}</span>
                  </header>
                  <p className="dashboard__conversation-title">{c.title}</p>
                  <p className="dashboard__conversation-label">Insights</p>
                  <p className="dashboard__conversation-snippet">{c.insight}</p>
                  <footer>
                    <button
                      type="button"
                      className="dashboard__mini-btn"
                      onClick={() => onOpenConversation?.(c.chatId)}
                    >
                      Open Conversation
                    </button>
                    <span className="dashboard__stage">{c.stage}</span>
                  </footer>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="dashboard__section">
          <h2 className="dashboard__section-title">Activity this hour</h2>
          <div className="dashboard__grid-3">
            <article className="dashboard__panel">
              <h3>Latency histogram</h3>
              <ResponsiveContainer width="100%" height={CHART_H}>
                <BarChart data={latencyHistogram}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="range" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill={chartPalette[0]} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </article>

            <article className="dashboard__panel">
              <h3>Message count</h3>
              <ResponsiveContainer width="100%" height={CHART_H}>
                <LineChart data={hourSeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="hour" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="messageCount" stroke={chartPalette[1]} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </article>

            <article className="dashboard__panel">
              <h3>Active conversations</h3>
              <ResponsiveContainer width="100%" height={CHART_H}>
                <LineChart data={hourSeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="hour" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="activeConversations" stroke={chartPalette[0]} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </article>

          </div>
        </section>

        <section className="dashboard__section">
          <h2 className="dashboard__section-title">USER INPUT DATA (FOR PIE CHART)</h2>
          <div className="dashboard__grid-2">
            <article className="dashboard__panel">
              <h3>Conversation mode split</h3>
              <ResponsiveContainer width="100%" height={CHART_H}>
                <PieChart>
                  <Pie
                    data={planningVsKnowledge}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={52}
                    outerRadius={80}
                    cx="50%"
                    cy="50%"
                    stroke="transparent"
                  >
                    {planningVsKnowledge.map((entry, index) => (
                      <Cell key={`usage-${entry.name}`} fill={pieUsageColors[index % pieUsageColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend verticalAlign="bottom" height={32} />
                </PieChart>
              </ResponsiveContainer>
            </article>
            <article className="dashboard__panel">
              <h3>Interpretation</h3>
              <p className="dashboard__empty">
                Planning = rows with stage <strong>planning</strong>.
              </p>
              <p className="dashboard__empty">
                Knowledge = rows from other stages (general/analysis).
              </p>
              <p className="dashboard__empty">
                Use this to track whether users are mostly asking informational questions
                or actively progressing layout planning.
              </p>
            </article>
          </div>
        </section>

        <section className="dashboard__section">
          <h2 className="dashboard__section-title">System log data</h2>
          <div className="dashboard__panel dashboard__logs-panel">
            {systemLogs.length === 0 ? (
              <p className="dashboard__empty">No log events yet.</p>
            ) : (
              <ul className="dashboard__logs-list">
                {systemLogs.map((entry, idx) => (
                  <li key={`${entry.at}-${idx}`} className={`dashboard__log dashboard__log--${entry.level}`}>
                    <span className="dashboard__log-pill">{entry.level.toUpperCase()}</span>
                    <span className="dashboard__log-at">
                      {new Date(entry.at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                    <span className="dashboard__log-msg">{entry.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

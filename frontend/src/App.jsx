import { useState, useEffect, useCallback, useRef } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import supabase from "./lib/supabaseClient";
import Auth from "./components/Auth";
import Intro from "./components/Intro";
import ProfileSetup from "./components/ProfileSetup";
import Tour from "./components/Tour";
import Sidebar from "./components/Sidebar";
import Chat from "./components/Chat";
import Dashboard from "./pages/Dashboard.jsx";
import ConversationDetails from "./pages/ConversationDetails.jsx";
import Vision3DPage from "./pages/Vision3DPage.jsx";
import "./Chat.css";

const readStoredTheme = () => {
  try {
    return localStorage.getItem("vd-theme") === "cosmic" ? "cosmic" : "light";
  } catch {
    return "light";
  }
};

function App() {
  const navigate = useNavigate();
  const [theme, setTheme] = useState(readStoredTheme);
  const [session, setSession] = useState(null);
  const initDoneRef = useRef(false);
  const [username, setUsername] = useState("");
  /** profiles.onboarding_role (slug or custom text); passed to chat API for LLM context */
  const [onboardingRole, setOnboardingRole] = useState(null);
  const [chats, setChats] = useState([]);
  const [currentChatId, setCurrentChatId] = useState(null);
  const [loadingChats, setLoadingChats] = useState(false);
  const [newChatLoading, setNewChatLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  /** Flow: loading → auth | intro → profile → tour → chat; onboarding completion from profiles.onboarding_role. */
  const [step, setStep] = useState("loading");

  useEffect(() => {
    document.documentElement.classList.toggle("theme-cosmic", theme === "cosmic");
    document.documentElement.dataset.theme =
      theme === "cosmic" ? "cosmic" : "light";
    try {
      localStorage.setItem("vd-theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape" && sidebarOpen) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [sidebarOpen]);

  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      setUsername("");
      setOnboardingRole(null);
      return null;
    }
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("username, onboarding_role")
        .eq("id", userId)
        .maybeSingle();

      if (error) {
        console.error("Profile load error:", error);
        setUsername("User");
        setOnboardingRole(null);
        return null;
      }

      if (data) {
        setUsername(data.username || "User");
        setOnboardingRole(data.onboarding_role?.trim() || null);
        return data;
      }

      console.warn("Profile missing, creating new profile...");

      let newProfile = null;
      let insertError = null;

      const insertRes = await supabase
        .from("profiles")
        .insert({ id: userId })
        .select("username, onboarding_role")
        .maybeSingle();
      newProfile = insertRes.data;
      insertError = insertRes.error;

      /* Older DBs: username still NOT NULL before migration 006 */
      if (insertError?.code === "23502") {
        const fallbackUsername = `user_${userId.replace(/-/g, "").slice(0, 8)}`;
        const retry = await supabase
          .from("profiles")
          .insert({ id: userId, username: fallbackUsername })
          .select("username, onboarding_role")
          .maybeSingle();
        newProfile = retry.data;
        insertError = retry.error;
      }

      if (!insertError && newProfile) {
        setUsername(newProfile.username || "User");
        setOnboardingRole(newProfile.onboarding_role?.trim() || null);
        return newProfile;
      }

      /* Race: trigger or another client created the row between select and insert */
      if (insertError?.code === "23505") {
        const { data: existing, error: refetchErr } = await supabase
          .from("profiles")
          .select("username, onboarding_role")
          .eq("id", userId)
          .maybeSingle();
        if (refetchErr || !existing) {
          console.error("Profile create error:", insertError);
          setUsername("User");
          setOnboardingRole(null);
          return null;
        }
        setUsername(existing.username || "User");
        setOnboardingRole(existing.onboarding_role?.trim() || null);
        return existing;
      }

      console.error("Profile create error:", insertError);
      setUsername("User");
      setOnboardingRole(null);
      return null;
    } catch (err) {
      console.error("loadProfile unexpected error:", err);
      setUsername("User");
      setOnboardingRole(null);
      return null;
    }
  }, []);

  const loadChats = useCallback(async (userIdArg) => {
    const userId = userIdArg ?? session?.user?.id;
    if (!userId) return;

    setLoadingChats(true);
    const { data, error } = await supabase
      .from("chats")
      .select("*")
      .order("created_at", { ascending: false });
    setLoadingChats(false);
    if (error) {
      console.error(error);
      return;
    }

    let list = data ?? [];
    if (list.length === 0) {
      const { data: row, error: insertError } = await supabase
        .from("chats")
        .insert({
          user_id: userId,
          title: "New chat",
          chat_type: "planner",
        })
        .select()
        .single();
      if (insertError) {
        console.error(insertError);
      } else if (row) {
        list = [row];
      }
    }

    setChats(list);
    setCurrentChatId((prev) => {
      if (list.length === 0) return null;
      if (prev != null && list.some((c) => c.id === prev)) return prev;
      return list[0].id;
    });
  }, [session?.user?.id]);

  /* Never stay on loading forever if init hangs (e.g. pending network). */
  useEffect(() => {
    const timeout = setTimeout(async () => {
      if (initDoneRef.current) return;
      console.warn("Auth init timeout fallback");
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) console.error("getSession (timeout fallback):", error);
        const s = data?.session ?? null;
        setSession(s);
        if (!s?.user) {
          setStep("auth");
        } else {
          const profile = await loadProfile(s.user.id);
          setStep(
            profile?.onboarding_role?.trim() ? "chat" : "intro"
          );
          void loadChats(s.user.id);
        }
      } catch (e) {
        console.error(e);
        setSession(null);
        setStep("auth");
      }
      initDoneRef.current = true;
    }, 3000);
    return () => clearTimeout(timeout);
  }, [loadChats, loadProfile]);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (cancelled) return;

        if (error) {
          console.error("getSession error:", error);
        }

        const currentSession = data?.session ?? null;
        setSession(currentSession);

        if (!currentSession) {
          setStep("auth");
          setUsername("");
          setOnboardingRole(null);
          setChats([]);
          setCurrentChatId(null);
        } else {
          const profile = await loadProfile(currentSession.user.id);
          if (profile?.onboarding_role?.trim()) {
            setStep("chat");
          } else {
            setStep("intro");
          }
          void loadChats(currentSession.user.id);
        }
      } catch (err) {
        console.error("INIT ERROR:", err);
        if (!cancelled) {
          setSession(null);
          setUsername("");
          setChats([]);
          setCurrentChatId(null);
          setStep("auth");
        }
      } finally {
        if (!cancelled) {
          initDoneRef.current = true;
        }
      }
    };

    void init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, nextSession) => {
      const s = nextSession ?? null;
      setSession(s);

      if (!s?.user) {
        setUsername("");
        setOnboardingRole(null);
        setChats([]);
        setCurrentChatId(null);
        setStep("auth");
        return;
      }

      if (event === "SIGNED_IN") {
        const profile = await loadProfile(s.user.id);
        if (profile?.onboarding_role?.trim()) {
          setStep("chat");
        } else {
          setStep("intro");
        }
        void loadChats(s.user.id);
        return;
      }

      if (event === "TOKEN_REFRESHED") {
        void loadProfile(s.user.id);
        return;
      }

      if (event === "INITIAL_SESSION") {
        void loadProfile(s.user.id);
        void loadChats(s.user.id);
        return;
      }

      void loadProfile(s.user.id);
      void loadChats(s.user.id);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [loadChats, loadProfile]);

  const handleSelectChat = useCallback(
    (id) => {
      setCurrentChatId(id);
      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile]
  );

  const handleDeleteChat = useCallback(
    async (chatId) => {
      if (deletingId !== null) return;
      if (!window.confirm("Delete this chat?")) return;

      const remainingChats = chats.filter((c) => c.id !== chatId);
      setDeletingId(chatId);
      setChats(remainingChats);

      if (chatId === currentChatId) {
        setCurrentChatId(remainingChats[0]?.id ?? null);
      }

      const { error } = await supabase.from("chats").delete().eq("id", chatId);

      if (error) {
        console.error("Delete failed:", error);
        await loadChats();
      } else if (remainingChats.length === 0 && session?.user?.id) {
        const { data: row, error: insertError } = await supabase
          .from("chats")
          .insert({
            user_id: session.user.id,
            title: "New chat",
            chat_type: "planner",
          })
          .select()
          .single();
        if (insertError) {
          console.error(insertError);
        } else if (row) {
          setChats([row]);
          setCurrentChatId(row.id);
        }
      }

      setDeletingId(null);
    },
    [chats, currentChatId, deletingId, loadChats, session]
  );

  const createNewChat = useCallback(async () => {
    if (!session?.user?.id) return;
    setNewChatLoading(true);
    const title = "New chat";
    const { data, error } = await supabase
      .from("chats")
      .insert({
        user_id: session.user.id,
        title,
        chat_type: "planner",
      })
      .select()
      .single();
    setNewChatLoading(false);
    if (error) {
      console.error(error);
      return;
    }
    setChats((prev) => [data, ...prev]);
    setCurrentChatId(data.id);
    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [session?.user?.id, isMobile]);

  const handleLogout = useCallback(async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error("Sign out failed:", error);
        return;
      }
    } catch (e) {
      console.error("Sign out error:", e);
      return;
    }
    /* Ensure UI leaves authed routes even if onAuthStateChange is delayed */
    setSession(null);
    setUsername("");
    setOnboardingRole(null);
    setChats([]);
    setCurrentChatId(null);
    setStep("auth");
  }, []);

  const appShellClass =
    theme === "cosmic" ? "app theme-cosmic" : "app";

  if (step === "loading") {
    return (
      <div className={appShellClass}>
        <div className="app-loading">Loading...</div>
      </div>
    );
  }

  if (step === "auth") {
    return (
      <div className={appShellClass}>
        <Auth theme={theme} onThemeChange={setTheme} />
      </div>
    );
  }

  if (step === "intro") {
    return (
      <div className={appShellClass}>
        <Intro
          onNext={() => setStep("profile")}
          onLogout={handleLogout}
          theme={theme}
          onThemeChange={setTheme}
        />
      </div>
    );
  }

  if (step === "profile") {
    return (
      <div className={appShellClass}>
        <ProfileSetup
          userId={session.user.id}
          onContinue={async () => {
            await loadProfile(session.user.id);
            setStep("tour");
          }}
          onLogout={handleLogout}
          theme={theme}
          onThemeChange={setTheme}
        />
      </div>
    );
  }

  if (step === "tour") {
    return (
      <div className={appShellClass}>
        <Tour
          onNext={async () => {
            if (session?.user?.id) await loadProfile(session.user.id);
            setStep("chat");
          }}
          onBack={() => setStep("profile")}
          onLogout={handleLogout}
          theme={theme}
          onThemeChange={setTheme}
        />
      </div>
    );
  }

  return (
    <div className={appShellClass}>
      <div className="chat-shell">
        {isMobile && sidebarOpen ? (
          <button
            type="button"
            className="sidebar-backdrop"
            aria-label="Close menu"
            onClick={() => setSidebarOpen(false)}
          />
        ) : null}

        <Sidebar
          isOpen={sidebarOpen}
          isMobile={isMobile}
          chats={chats}
          currentChatId={currentChatId}
          onSelectChat={handleSelectChat}
          deletingId={deletingId}
          onDeleteChat={handleDeleteChat}
          onNewChat={() => void createNewChat()}
          onLogout={handleLogout}
          username={username}
          loadingChats={loadingChats}
          newChatLoading={newChatLoading}
          onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
        />
        <div className="chat-workspace">
          <button
            type="button"
            className="workspace-sidebar-toggle"
            onClick={() => setSidebarOpen((prev) => !prev)}
            aria-label={
              sidebarOpen
                ? isMobile
                  ? "Close sidebar"
                  : "Collapse sidebar"
                : "Open sidebar"
            }
            title={
              sidebarOpen
                ? isMobile
                  ? "Close sidebar"
                  : "Collapse sidebar (Esc)"
                : "Open sidebar"
            }
            aria-expanded={sidebarOpen}
          >
            <span className="workspace-sidebar-toggle__icon" aria-hidden="true">
              ☰
            </span>
          </button>
          <Routes>
            <Route
              path="/dashboard"
              element={
                <Dashboard
                  theme={theme}
                  userId={session?.user?.id ?? null}
                  onBackToChat={() => navigate("/")}
                  onOpenConversation={(chatId) =>
                    navigate(`/dashboard/conversations/${chatId}`)
                  }
                />
              }
            />
            <Route
              path="/dashboard/conversations/:chatId"
              element={
                <ConversationDetails
                  theme={theme}
                  userId={session?.user?.id ?? null}
                />
              }
            />
            <Route path="/vision-3d" element={<Vision3DPage />} />
            <Route
              path="/"
              element={
                <Chat
                  userId={session?.user?.id ?? null}
                  currentChatId={currentChatId}
                  refreshChats={() => loadChats()}
                  sidebarOpen={sidebarOpen}
                  chatsLoading={loadingChats}
                  theme={theme}
                  onThemeChange={setTheme}
                  isMobile={isMobile}
                  username={username}
                  onboardingRole={onboardingRole}
                  onOpenDashboard={() => navigate("/dashboard")}
                />
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

export default App;

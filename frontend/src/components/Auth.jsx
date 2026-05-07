import { useState } from "react";
import supabase from "../lib/supabaseClient";
import "./Auth.css";

function IconMoon({ className }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M21 14.5A9 9 0 0 1 9.5 3 7 7 0 1 0 21 14.5Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconSun({ className }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function Auth({ theme, onThemeChange, onBackToIntro }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [usernameInput, setUsernameInput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const em = email.trim();
    const uname = usernameInput.trim();
    if (!em || !password) {
      setError("Enter email and password.");
      return;
    }
    if (mode === "signup" && !uname) {
      setError("Choose a username.");
      return;
    }
    setLoading(true);
    try {
      if (mode === "signup") {
        const { data: signData, error: signUpError } = await supabase.auth.signUp({
          email: em,
          password,
          options: {
            data: { username: uname },
          },
        });

        if (signUpError) {
          console.error(signUpError);
          setError(signUpError.message ?? "Sign up failed.");
          return;
        }

        /* If email confirmation is off, we have a session: force profile row to chosen username
           (covers DB triggers that ignore raw_user_meta_data or weren’t migrated). */
        if (signData?.session?.user?.id) {
          const { error: profileErr } = await supabase
            .from("profiles")
            .update({ username: uname })
            .eq("id", signData.session.user.id);
          if (profileErr) {
            console.warn("Could not sync profile username:", profileErr);
          }
        }
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({
          email: em,
          password,
        });
        if (err) throw err;
      }
    } catch (err) {
      console.error(err);
      setError(err.message ?? "Authentication failed.");
    } finally {
      setLoading(false);
    }
  };

  const signupDisabled =
    loading || !email.trim() || !password || !usernameInput.trim();
  const loginDisabled = loading || !email.trim() || !password;

  const switchMode = (next) => {
    setMode(next);
    setError("");
    if (next === "login") {
      setUsernameInput("");
    }
  };

  return (
    <div className="auth">
      <div className="auth__card">
        {onBackToIntro ? (
          <button
            type="button"
            className="auth__back"
            onClick={onBackToIntro}
            disabled={loading}
          >
            ← Welcome screen
          </button>
        ) : null}
        <button
          type="button"
          className="auth__theme-toggle"
          onClick={() =>
            onThemeChange?.(theme === "light" ? "cosmic" : "light")
          }
          aria-label={theme === "light" ? "Switch to Cosmic theme" : "Switch to Light theme"}
        >
          {theme === "light" ? (
            <>
              <IconMoon className="auth__theme-icon" />
              <span>Cosmic</span>
            </>
          ) : (
            <>
              <IconSun className="auth__theme-icon" />
              <span>Light</span>
            </>
          )}
        </button>

        <div className="auth__brand">
          <img
            className="auth__logo"
            src="/visiondesignie-logo.jpg"
            alt=""
            width={56}
            height={56}
            decoding="async"
          />
          <h1 className="auth__title">VisionDesignie</h1>
          <p className="auth__subtitle">Architect assistant</p>
        </div>

        <div className="auth__tabs" role="tablist" aria-label="Authentication mode">
          <button
            type="button"
            role="tab"
            id="auth-tab-login"
            aria-selected={mode === "login"}
            className={`auth__tab ${mode === "login" ? "auth__tab--active" : ""}`}
            onClick={() => switchMode("login")}
            disabled={loading}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            id="auth-tab-signup"
            aria-selected={mode === "signup"}
            className={`auth__tab ${mode === "signup" ? "auth__tab--active" : ""}`}
            onClick={() => switchMode("signup")}
            disabled={loading}
          >
            Create account
          </button>
        </div>

        <form className="auth__form" onSubmit={handleSubmit} noValidate>
          {mode === "signup" ? (
            <div className="auth__field">
              <label htmlFor="auth-username">Username</label>
              <input
                id="auth-username"
                type="text"
                autoComplete="username"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                disabled={loading}
                placeholder="Choose a username"
              />
            </div>
          ) : null}
          <div className="auth__field">
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              placeholder="you@example.com"
            />
          </div>
          <div className="auth__field">
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              placeholder="Password"
            />
          </div>
          {error ? <p className="auth__error">{error}</p> : null}
          <button
            type="submit"
            className="auth__submit"
            disabled={mode === "signup" ? signupDisabled : loginDisabled}
          >
            {loading
              ? "Please wait…"
              : mode === "login"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}

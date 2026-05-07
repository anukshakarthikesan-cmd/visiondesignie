import { useState } from "react";
import supabase from "../lib/supabaseClient";
import "./Onboarding.css";
import "./ProfileSetup.css";

function IconMoon() {
  return (
    <svg
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

function IconSun() {
  return (
    <svg
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

const roles = [
  {
    label: "First-time Home Builder",
    value: "home_builder",
    image: "/images/home.jpg",
  },
  {
    label: "Architecture Student",
    value: "student",
    image: "/images/student.jpg",
  },
  {
    label: "Plot Buyer / Investor",
    value: "investor",
    image: "/images/investor.jpg",
  },
  {
    label: "Small Contractor / Builders",
    value: "contractor",
    image: "/images/contractor.jpg",
  },
  {
    label: "Working Professional",
    value: "professional",
    image: "/images/professional.jpg",
  },
  {
    label: "Other",
    value: "other",
    image: "/images/other.svg",
  },
];

export default function ProfileSetup({
  userId,
  onContinue,
  onLogout,
  theme,
  onThemeChange,
}) {
  const [selectedRole, setSelectedRole] = useState(null);
  const [customRole, setCustomRole] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const selectRole = (value) => {
    setError("");
    setSelectedRole(value);
    if (value !== "other") {
      setCustomRole("");
    }
  };

  const handleContinue = async () => {
    if (!selectedRole) {
      setError("Please select a role.");
      return;
    }
    if (selectedRole === "other" && !customRole.trim()) {
      setError("Please describe your role.");
      return;
    }
    if (!userId) {
      setError("You are not signed in. Please log in again.");
      return;
    }
    setError("");
    const roleFinal =
      selectedRole === "other" ? customRole.trim() : selectedRole;

    setSaving(true);
    const { data, error: upErr } = await supabase
      .from("profiles")
      .update({ onboarding_role: roleFinal })
      .eq("id", userId)
      .select("id");
    setSaving(false);

    if (upErr) {
      console.error(upErr);
      setError("Could not save your selection. Please try again.");
      return;
    }
    if (!data?.length) {
      setError("Profile not found. Try signing out and back in.");
      return;
    }

    onContinue?.();
  };

  return (
    <div className="onboarding onboarding-page profile-setup">
      <button
        type="button"
        className="onboarding__theme"
        onClick={() =>
          onThemeChange?.(theme === "light" ? "cosmic" : "light")
        }
        aria-label={
          theme === "light" ? "Switch to Cosmic theme" : "Switch to Light theme"
        }
      >
        {theme === "light" ? <IconMoon /> : <IconSun />}
        <span>{theme === "light" ? "Cosmic" : "Light"}</span>
      </button>

      <div className="onboarding__inner">
        <h1 className="profile-setup__title">About you</h1>
        <p className="profile-setup__subtitle">
          Choose the option that best describes you. This helps us tailor
          guidance to your situation.
        </p>

        <div className="profile-setup__section">
          <div className="role-grid" role="group" aria-label="Your role">
            {roles.map((role) =>
              role.value === "other" ? (
                <div
                  key={role.value}
                  role="group"
                  aria-label={`${role.label}. Specify your role in the text field.`}
                  className={`role-card role-card--other${selectedRole === "other" ? " active" : ""}`}
                  onClick={() => selectRole("other")}
                >
                  <span className="role-card__media" aria-hidden>
                    <img
                      src={role.image}
                      alt=""
                      width={200}
                      height={250}
                      decoding="async"
                      loading="lazy"
                    />
                  </span>
                  <div
                    className="role-card__other-footer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <label
                      className="role-card__other-title"
                      htmlFor="profile-custom-role"
                    >
                      {role.label}
                    </label>
                    <input
                      id="profile-custom-role"
                      type="text"
                      className="role-card__other-input"
                      placeholder="Please specify…"
                      value={customRole}
                      onChange={(e) => {
                        setCustomRole(e.target.value);
                        selectRole("other");
                      }}
                      onFocus={() => selectRole("other")}
                      autoComplete="off"
                    />
                  </div>
                </div>
              ) : (
                <button
                  key={role.value}
                  type="button"
                  className={`role-card ${selectedRole === role.value ? "active" : ""}`}
                  onClick={() => selectRole(role.value)}
                  aria-pressed={selectedRole === role.value}
                  aria-label={role.label}
                >
                  <span className="role-card__media" aria-hidden>
                    <img
                      src={role.image}
                      alt=""
                      width={200}
                      height={250}
                      decoding="async"
                      loading="lazy"
                    />
                  </span>
                  <span className="role-card__label">{role.label}</span>
                </button>
              )
            )}
          </div>

          <div
            className="profile-setup__error-slot"
            aria-live="polite"
          >
            {error ? (
              <p className="profile-setup__error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </div>

        <div className="profile-setup__actions">
          <button
            type="button"
            className="onboarding__cta"
            onClick={() => void handleContinue()}
            disabled={saving}
          >
            {saving ? "Saving…" : "Continue"}
          </button>
          <button type="button" className="onboarding__secondary" onClick={onLogout}>
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}

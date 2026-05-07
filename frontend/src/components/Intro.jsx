import "./Onboarding.css";

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

const FEATURES = [
  {
    icon: "📐",
    title: "Complex rules",
    text: "Understand CMDA, DTCP, NBC easily",
  },
  {
    icon: "💡",
    title: "No clarity",
    text: "VisionDesignie offers example prompts and a full sample brief you can paste",
  },
  {
    icon: "⚡",
    title: "Limited access",
    text: "Get instant architectural guidance anytime",
  },
];

export default function Intro({
  onNext,
  onLogout,
  showLogout = true,
  theme,
  onThemeChange,
}) {
  return (
    <div className="onboarding onboarding-page onboarding--intro">
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

      <div className="onboarding__inner intro-content">
        <img
          className="onboarding__logo"
          src="/visiondesignie-logo.jpg"
          alt=""
          width={56}
          height={56}
          decoding="async"
        />
        <h1 className="onboarding__title">VisionDesignie</h1>
        <p className="onboarding__subtitle">Architect assistant</p>
        <p className="onboarding__tagline">
          Plan your building with confidence
        </p>
        <p className="onboarding__lead">
          Choose how you&apos;d like to start, or describe your project below.
          I&apos;ll guide you step by step — from understanding rules to
          creating your plan.
        </p>

        <div className="onboarding__grid">
          {FEATURES.map((f) => (
            <article key={f.title} className="onboarding-card intro-card">
              <h2 className="onboarding-card__title">
                <span className="intro-card__icon" aria-hidden>
                  {f.icon}
                </span>
                {f.title}
              </h2>
              <p className="onboarding-card__text">{f.text}</p>
            </article>
          ))}
        </div>

        <div className="onboarding__actions">
          <button
            type="button"
            className="onboarding__cta intro-cta"
            onClick={onNext}
          >
            Get Started
          </button>
          {showLogout ? (
            <button
              type="button"
              className="onboarding__secondary"
              onClick={() => {
                void onLogout?.();
              }}
            >
              Log out
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

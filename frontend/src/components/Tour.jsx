import { useState } from "react";
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

const SLIDES = [
  "Hey Hiii, Welcome you to the VisionDesignie !",
  "You'll get planning ideas, rules, and design guidance.",
  "You're all set. Let's start designing your space.",
];

export default function Tour({ onNext, onBack, onLogout, theme, onThemeChange }) {
  const [index, setIndex] = useState(0);
  const isLast = index === SLIDES.length - 1;

  const handleBack = () => {
    if (index > 0) {
      setIndex((i) => i - 1);
    } else {
      onBack?.();
    }
  };

  return (
    <div className="onboarding onboarding-page onboarding--tour">
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

        <div className="tour__panel" role="region" aria-live="polite">
          <p className="tour__text">{SLIDES[index]}</p>
        </div>

        <div className="tour__dots" aria-hidden>
          {SLIDES.map((_, i) => (
            <span
              key={i}
              className={`tour__dot${i === index ? " tour__dot--active" : ""}`}
            />
          ))}
        </div>

        <div className="tour__actions">
          <div className="tour__nav-row">
            <button
              type="button"
              className="tour__back"
              onClick={handleBack}
              disabled={index === 0 && !onBack}
              aria-label={
                index > 0
                  ? "Previous slide"
                  : onBack
                    ? "Back to profile setup"
                    : "Back"
              }
            >
              « Back
            </button>
            <button
              type="button"
              className="onboarding__cta tour__next"
              onClick={() => {
                if (isLast) onNext();
                else setIndex((n) => n + 1);
              }}
            >
              {isLast ? "Let's Start" : "Next"}
            </button>
          </div>
          <button
            type="button"
            className="onboarding__secondary"
            onClick={onLogout}
          >
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}

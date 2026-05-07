import "./ThemeToggle.css";

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

export default function ThemeToggle({ theme, onToggle, variant = "pill" }) {
  const cosmic = theme === "cosmic";
  return (
    <button
      type="button"
      className={`theme-toggle theme-toggle--${variant}`}
      onClick={onToggle}
      aria-label={
        cosmic ? "Switch to light theme" : "Switch to cosmic theme"
      }
    >
      {cosmic ? (
        <>
          <IconSun className="theme-toggle__icon" />
          {variant !== "icon" ? <span>Light</span> : null}
        </>
      ) : (
        <>
          <IconMoon className="theme-toggle__icon" />
          {variant !== "icon" ? <span>Cosmic</span> : null}
        </>
      )}
    </button>
  );
}

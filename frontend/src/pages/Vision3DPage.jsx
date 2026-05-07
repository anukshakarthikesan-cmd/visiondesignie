import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Vision3DCanvas from "../components/vision3d/Vision3DCanvas";
import { sanitizeExportBase } from "../lib/vision3dExport";
import "../vision3d.css";

function clampFloors(n) {
  const x = Math.round(Number(n));
  if (!Number.isFinite(x)) return 2;
  return Math.min(6, Math.max(1, x));
}

function DisplayToggleGroup({
  labelsVisible,
  onLabelsChange,
  gridVisible,
  onGridChange,
  wireframe,
  onWireframeChange,
}) {
  return (
    <>
      <label className="vision3d-toggle vision3d-toggle--compact">
        <input
          type="checkbox"
          checked={labelsVisible}
          onChange={(e) => onLabelsChange(e.target.checked)}
        />
        Room labels
      </label>
      <label className="vision3d-toggle vision3d-toggle--compact">
        <input
          type="checkbox"
          checked={gridVisible}
          onChange={(e) => onGridChange(e.target.checked)}
        />
        Ground grid
      </label>
      <label className="vision3d-toggle vision3d-toggle--compact">
        <input
          type="checkbox"
          checked={wireframe}
          onChange={(e) => onWireframeChange(e.target.checked)}
        />
        Wireframe
      </label>
    </>
  );
}

/**
 * Full-page 3D visioning from navigation `location.state`:
 * `{ layoutPlan, designState, chatId?, fromDesignPanel? }`
 */
export default function Vision3DPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const payload = location.state;

  const plan = payload?.layoutPlan ?? null;
  const designState = payload?.designState ?? null;

  const floorsRaw = designState?.floors;
  const floorsMissing = floorsRaw == null || floorsRaw === "";
  const numFloors = useMemo(
    () => clampFloors(floorsMissing ? 2 : floorsRaw),
    [floorsRaw, floorsMissing]
  );

  const [roofVisible, setRoofVisible] = useState(true);
  const [furnitureVisible, setFurnitureVisible] = useState(true);
  const [labelsVisible, setLabelsVisible] = useState(true);
  const [gridVisible, setGridVisible] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [treesVisible, setTreesVisible] = useState(true);
  const [cameraPreset, setCameraPreset] = useState(
    /** @type {'exterior'|'top'|'interior'} */ ("exterior")
  );
  const [floorsBannerDismissed, setFloorsBannerDismissed] = useState(false);
  const exportApiRef = useRef(null);

  const exportBase = useMemo(
    () => sanitizeExportBase(designState?.location),
    [designState?.location]
  );

  const onExportReady = useCallback((api) => {
    exportApiRef.current = api;
  }, []);

  const handleExportPng = useCallback(() => {
    exportApiRef.current?.capturePng();
  }, []);

  useEffect(() => {
    if (!floorsMissing) {
      const id = window.setTimeout(() => setFloorsBannerDismissed(false), 0);
      return () => clearTimeout(id);
    }
  }, [floorsMissing]);

  const title = useMemo(() => {
    if (!designState) return "3D vision";
    const parts = [
      designState.bhk != null ? `${designState.bhk} BHK` : null,
      designState.plot_size,
      designState.layout_style,
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : "3D vision";
  }, [designState]);

  const goChatWithFloorsHint = useCallback(() => {
    navigate("/", {
      replace: false,
      state: {
        vision3dComposerHint:
          "How many floors should my design have? Please update my requirements (e.g. G+2).",
      },
    });
  }, [navigate]);

  const backToChat = useCallback(() => {
    navigate("/", { replace: false });
  }, [navigate]);

  if (!plan || !designState) {
    return (
      <div className="vision3d-page vision3d-page--empty">
        <div className="vision3d-empty-card">
          <h1 className="vision3d-empty-card__title">No plan loaded</h1>
          <p className="vision3d-empty-card__text">
            Open a conversation, complete your sketch, then use{" "}
            <strong>Floor plan</strong> → <strong>3D vision</strong> in the panel.
          </p>
          <button type="button" className="vision3d-btn vision3d-btn--primary" onClick={backToChat}>
            Back to chat
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="vision3d-page">
      <header className="vision3d-topbar">
        <button
          type="button"
          className="vision3d-btn vision3d-btn--ghost"
          onClick={backToChat}
          aria-label="Back to chat"
        >
          ← Chat
        </button>
        <div className="vision3d-topbar__title-wrap">
          <span className="vision3d-topbar__brand">VisionDesignie</span>
          <span className="vision3d-topbar__sep" aria-hidden />
          <span className="vision3d-topbar__title" title={title}>
            {title}
          </span>
        </div>
        <div className="vision3d-topbar__toggles">
          <label className="vision3d-toggle">
            <input
              type="checkbox"
              checked={roofVisible}
              onChange={(e) => setRoofVisible(e.target.checked)}
            />
            Roof
          </label>
          <label className="vision3d-toggle">
            <input
              type="checkbox"
              checked={furnitureVisible}
              onChange={(e) => setFurnitureVisible(e.target.checked)}
            />
            Furniture
          </label>
          <label className="vision3d-toggle">
            <input
              type="checkbox"
              checked={treesVisible}
              onChange={(e) => setTreesVisible(e.target.checked)}
            />
            Trees
          </label>
          <div
            className="vision3d-topbar__display-toggles vision3d--mobile-only"
            aria-label="Display options"
          >
            <DisplayToggleGroup
              labelsVisible={labelsVisible}
              onLabelsChange={setLabelsVisible}
              gridVisible={gridVisible}
              onGridChange={setGridVisible}
              wireframe={wireframe}
              onWireframeChange={setWireframe}
            />
          </div>
        </div>
      </header>

      {floorsMissing && !floorsBannerDismissed ? (
        <div className="vision3d-banner" role="status">
          <button
            type="button"
            className="vision3d-banner__collapse"
            onClick={() => setFloorsBannerDismissed(true)}
            aria-label="Hide floors notice"
            title="Hide"
          >
            <svg
              className="vision3d-banner__collapse-icon"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden
            >
              <path
                d="M6 15l6-6 6 6"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <p className="vision3d-banner__text">
            Floors are not set yet — showing <strong>G+{numFloors - 1}</strong> as a preview.
            Tell the architect how many floors you want.
          </p>
          <button
            type="button"
            className="vision3d-btn vision3d-btn--accent vision3d-banner__action"
            onClick={goChatWithFloorsHint}
          >
            Ask in chat
          </button>
        </div>
      ) : null}
      {floorsMissing && floorsBannerDismissed ? (
        <button
          type="button"
          className="vision3d-banner-reopen"
          onClick={() => setFloorsBannerDismissed(false)}
          aria-label="Show floors notice again"
        >
          <svg
            className="vision3d-banner-reopen__icon"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden
          >
            <path
              d="M6 9l6 6 6-6"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>Floors notice (preview G+{numFloors - 1})</span>
        </button>
      ) : null}

      <div className="vision3d-body">
        <aside className="vision3d-sidebar" aria-label="3D view controls">
          <span className="vision3d-sidebar__label">Camera</span>
          <div className="vision3d-seg">
            <button
              type="button"
              className={cameraPreset === "exterior" ? "vision3d-seg__btn is-on" : "vision3d-seg__btn"}
              onClick={() => setCameraPreset("exterior")}
            >
              Exterior
            </button>
            <button
              type="button"
              className={cameraPreset === "interior" ? "vision3d-seg__btn is-on" : "vision3d-seg__btn"}
              onClick={() => setCameraPreset("interior")}
            >
              Interior
            </button>
            <button
              type="button"
              className={cameraPreset === "top" ? "vision3d-seg__btn is-on" : "vision3d-seg__btn"}
              onClick={() => setCameraPreset("top")}
            >
              Top
            </button>
          </div>
          <p className="vision3d-hint">Drag to orbit · Scroll to zoom · Right-drag to pan</p>
          <div className="vision3d-sidebar__display vision3d--desktop-only">
            <span className="vision3d-sidebar__label">Display</span>
            <div className="vision3d-sidebar__checks">
              <DisplayToggleGroup
                labelsVisible={labelsVisible}
                onLabelsChange={setLabelsVisible}
                gridVisible={gridVisible}
                onGridChange={setGridVisible}
                wireframe={wireframe}
                onWireframeChange={setWireframe}
              />
            </div>
          </div>
          <dl className="vision3d-meta">
            <div>
              <dt>Floors</dt>
              <dd>G+{numFloors - 1}</dd>
            </div>
            {plan?.plot_width && plan?.plot_height ? (
              <div>
                <dt>Plot (3D)</dt>
                <dd>
                  {plan.plot_width}'×{plan.plot_height}'
                </dd>
              </div>
            ) : null}
            {designState?.location ? (
              <div>
                <dt>Site</dt>
                <dd>{designState.location}</dd>
              </div>
            ) : null}
          </dl>
        </aside>

        <div className="vision3d-viewport-chrome">
          <div className="vision3d-viewport-chrome__header">
            <div className="vision3d-viewport-chrome__header-main">
              <span className="vision3d-viewport-chrome__badge">3D preview</span>
              <span className="vision3d-viewport-chrome__hint">Orbit · zoom · pan</span>
            </div>
            <div className="vision3d-viewport-chrome__exports" role="group" aria-label="Export 3D preview">
              <button
                type="button"
                className="vision3d-btn vision3d-btn--ghost vision3d-export-chip"
                onClick={handleExportPng}
              >
                PNG
              </button>
            </div>
          </div>
          <div className="vision3d-canvas-wrap">
            <Vision3DCanvas
              plan={plan}
              numFloors={numFloors}
              roofVisible={roofVisible}
              furnitureVisible={furnitureVisible}
              cameraPreset={cameraPreset}
              labelsVisible={labelsVisible}
              gridVisible={gridVisible}
              wireframe={wireframe}
              layoutStyle={designState?.layout_style ?? null}
              treesVisible={treesVisible}
              exportBase={exportBase}
              onExportReady={onExportReady}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

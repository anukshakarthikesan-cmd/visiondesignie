import { useRef, useState, useCallback, useMemo } from "react";
import FloorPlanCanvas from "./FloorPlanCanvas";
import {
  downloadFloorPlanPdf,
  downloadFloorPlanPng,
  downloadFloorPlanSvgFile,
} from "../lib/floorPlanExport";
import "../designPanel.css";

function exportFilenameBase(designState) {
  const raw = String(designState?.location || "floor-plan")
    .replace(/[^a-zA-Z0-9\s-]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 36);
  const safe = raw || "floor-plan";
  return `visiondesignie-${safe}`;
}

export default function DesignPanel({
  open,
  onClose,
  plan,
  plotError,
  designState,
  onRequestRedesign,
  /** When set with a valid plan, shows “3D view” (full-page 3D preview). */
  onOpenVision3D,
}) {
  const svgRef = useRef(null);
  const [exportBusy, setExportBusy] = useState(null);

  const exportBase = useMemo(
    () => exportFilenameBase(designState),
    [designState]
  );

  const runExport = useCallback(
    async (kind) => {
      const el = svgRef.current;
      if (!el || plotError || !plan) return;
      setExportBusy(kind);
      try {
        if (kind === "svg") {
          await downloadFloorPlanSvgFile(el, `${exportBase}.svg`);
        } else if (kind === "png") {
          await downloadFloorPlanPng(el, `${exportBase}.png`);
        } else if (kind === "pdf") {
          await downloadFloorPlanPdf(el, `${exportBase}.pdf`);
        }
      } catch (err) {
        console.error(err);
        window.alert(
          "Export failed. Try SVG first, or use Chrome/Edge for PNG/PDF."
        );
      } finally {
        setExportBusy(null);
      }
    },
    [exportBase, plan, plotError]
  );

  if (!open) return null;

  const specLine = [
    designState?.plot_size,
    designState?.location,
    designState?.bhk != null ? `${designState.bhk} BHK` : null,
    designState?.vastu_preference === true
      ? "Vastu on"
      : designState?.vastu_preference === false
        ? "Vastu off"
        : null,
    designState?.layout_style,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="design-panel-backdrop" role="presentation" onClick={onClose}>
      <aside
        className="design-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="design-panel-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="design-panel__header">
          <h2 id="design-panel-title" className="design-panel__title">
            Floor plan sketch
          </h2>
          <div className="design-panel__header-end">
            {plan && !plotError && onOpenVision3D ? (
              <button
                type="button"
                className="design-panel__3d-btn"
                onClick={() => onOpenVision3D()}
                title="Open 3D preview of this layout"
              >
                3D view
              </button>
            ) : null}
            {plan && !plotError ? (
              <div
                className="design-panel__exports"
                role="group"
                aria-label="Export floor plan"
              >
                <button
                  type="button"
                  className="design-panel__export-btn"
                  disabled={exportBusy != null}
                  onClick={() => void runExport("svg")}
                  title="Download as SVG (vector)"
                >
                  {exportBusy === "svg" ? "…" : "SVG"}
                </button>
                <button
                  type="button"
                  className="design-panel__export-btn"
                  disabled={exportBusy != null}
                  onClick={() => void runExport("png")}
                  title="Download as PNG image"
                >
                  {exportBusy === "png" ? "…" : "PNG"}
                </button>
                <button
                  type="button"
                  className="design-panel__export-btn"
                  disabled={exportBusy != null}
                  onClick={() => void runExport("pdf")}
                  title="Download as PDF"
                >
                  {exportBusy === "pdf" ? "…" : "PDF"}
                </button>
              </div>
            ) : null}
            <button
              type="button"
              className="design-panel__close"
              onClick={onClose}
              aria-label="Close floor plan"
            >
              ×
            </button>
          </div>
        </header>
        <div className="design-panel__canvas-wrap">
          {plotError ? (
            <p className="design-panel__error">{plotError}</p>
          ) : plan ? (
            <FloorPlanCanvas
              ref={svgRef}
              plan={plan}
              className="design-panel__canvas"
            />
          ) : (
            <p className="design-panel__error">No sketch data yet.</p>
          )}
        </div>
        {specLine ||
        onRequestRedesign ||
        (plan && !plotError && onOpenVision3D) ? (
          <footer className="design-panel__footer">
            {specLine ? (
              <p className="design-panel__hint" title={specLine}>
                {specLine}
              </p>
            ) : null}
            {onRequestRedesign || (plan && !plotError && onOpenVision3D) ? (
              <div className="design-panel__footer-actions">
                {onRequestRedesign ? (
                  <button
                    type="button"
                    className="design-panel__redesign"
                    title="Redesign with architect"
                    onClick={() => onRequestRedesign()}
                  >
                    Redesign
                  </button>
                ) : null}
                {plan && !plotError && onOpenVision3D ? (
                  <button
                    type="button"
                    className="design-panel__3d-btn design-panel__3d-btn--footer"
                    onClick={() => onOpenVision3D()}
                    title="Open 3D preview of this layout"
                  >
                    3D view
                  </button>
                ) : null}
              </div>
            ) : null}
          </footer>
        ) : null}
      </aside>
    </div>
  );
}

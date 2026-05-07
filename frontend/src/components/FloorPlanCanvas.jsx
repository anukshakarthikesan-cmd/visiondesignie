/**
 * Renders a {@link import('../lib/layoutEngine.js').buildLayoutPlanFromDesignState} plan as SVG (no LLM).
 * Layout: compass (N/E/S/W), room blocks with name + dimensions.
 */

import { forwardRef } from "react";

function dimFeet(w, h) {
  const a = Math.round(Number(w) || 0);
  const b = Math.round(Number(h) || 0);
  return `${a}' × ${b}'`;
}

const FloorPlanCanvas = forwardRef(function FloorPlanCanvas(
  { plan, className = "" },
  ref
) {
  if (!plan?.plot_width || !plan?.plot_height || !Array.isArray(plan.rooms)) {
    return null;
  }
  const { plot_width: pw, plot_height: ph, unit = "ft", rooms } = plan;

  /* Margins in plot units; slightly tight so the building rect fills more of the viewBox when scaled to the panel. */
  const M = Math.max(5, Math.min(pw, ph) * 0.07);
  const plotX = M;
  const plotY = M;
  const vbW = plotX + pw + M;

  const plotMin = Math.min(pw, ph);
  /* Font sizes are in the same user units as the plot (feet); keep small vs plot so CSS scaling stays readable. */
  const fsComp = Math.max(1.15, plotMin * 0.028);
  /* Room for S label below the plot + small margin (no disclaimer band). */
  const spaceBelowPlot = M * 0.28 + fsComp * 0.75 + M * 0.38;
  const vbH = plotY + ph + spaceBelowPlot;
  /* Extra top viewBox padding so vertical chrome matches bottom; keeps the plot rect optically centered when scaled (meet). */
  const chromeBelow = vbH - plotY - ph;
  const chromeAbove = plotY;
  const topViewBoxPad = Math.max(0, (chromeBelow - chromeAbove) * 0.5);
  const vbHOut = vbH + topViewBoxPad;

  /** Tall viewBox: desktop CSS keeps portrait (vertical) orientation—N stays up, plot uses panel width. */
  const portraitOnDesktop = vbHOut > vbW * 1.02;
  const svgClass = [className, "floor-plan-canvas-svg"].filter(Boolean).join(" ");

  return (
    <div
      className={
        portraitOnDesktop
          ? "floor-plan-canvas-shell floor-plan-canvas-shell--vertical-desktop"
          : "floor-plan-canvas-shell"
      }
    >
      <svg
        ref={ref}
        className={svgClass}
        viewBox={`0 0 ${vbW} ${vbHOut}`}
        role="img"
        preserveAspectRatio="xMidYMid meet"
        aria-label={`Floor sketch about ${pw} by ${ph} ${unit}`}
        style={{ display: "block" }}
      >
      <g transform={`translate(0, ${topViewBoxPad})`}>
      <rect
        x={plotX}
        y={plotY}
        width={pw}
        height={ph}
        fill="#faf9f7"
        stroke="#333"
        strokeWidth={Math.max(0.45, Math.min(pw, ph) * 0.004)}
      />

      <text
        x={plotX + pw / 2}
        y={plotY - M * 0.12}
        textAnchor="middle"
        fontSize={fsComp}
        fontWeight="700"
        fill="#1a1a1a"
        style={{ fontFamily: "system-ui, Segoe UI, sans-serif", pointerEvents: "none" }}
      >
        N
      </text>
      <text
        x={plotX + pw / 2}
        y={plotY + ph + M * 0.28}
        textAnchor="middle"
        fontSize={fsComp}
        fontWeight="700"
        fill="#1a1a1a"
        style={{ fontFamily: "system-ui, Segoe UI, sans-serif", pointerEvents: "none" }}
      >
        S
      </text>
      <text
        x={plotX * 0.42}
        y={plotY + ph / 2 + fsComp * 0.22}
        textAnchor="middle"
        fontSize={fsComp}
        fontWeight="700"
        fill="#1a1a1a"
        style={{ fontFamily: "system-ui, Segoe UI, sans-serif", pointerEvents: "none" }}
      >
        W
      </text>
      <text
        x={plotX + pw + M * 0.58}
        y={plotY + ph / 2 + fsComp * 0.22}
        textAnchor="middle"
        fontSize={fsComp}
        fontWeight="700"
        fill="#1a1a1a"
        style={{ fontFamily: "system-ui, Segoe UI, sans-serif", pointerEvents: "none" }}
      >
        E
      </text>

      {rooms.map((r, i) => {
        const rx = plotX + r.x;
        const ry = plotY + r.y;
        const cx = rx + r.width / 2;
        const cy = ry + r.height / 2;
        const roomMin = Math.min(r.width, r.height);
        const fsName = Math.max(
          0.78,
          roomMin * 0.052,
          plotMin * 0.017
        );
        const fsDim = Math.max(0.65, fsName * 0.68);
        const dimLabel = dimFeet(r.width, r.height);
        const tight = Math.min(r.width, r.height) < Math.min(pw, ph) * 0.18;
        const nameY = tight ? cy - fsDim * 0.35 : cy - fsDim * 0.55;
        const dimY = tight ? cy + fsName * 0.42 : cy + fsName * 0.38;

        return (
          <g key={`${r.name}-${i}`}>
            <rect
              x={rx}
              y={ry}
              width={r.width}
              height={r.height}
              fill={r.fill || "#eee"}
              stroke={r.stroke || "#666"}
              strokeWidth={Math.max(0.28, Math.min(pw, ph) * 0.0025)}
            />
            <text
              x={cx}
              y={nameY}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={fsName}
              fontWeight="600"
              fill="#1a1a1a"
              style={{
                fontFamily: "system-ui, Segoe UI, sans-serif",
                pointerEvents: "none",
              }}
            >
              {r.name.replace(/\s*\(NE\)\s*/i, " (NE)")}
            </text>
            <text
              x={cx}
              y={dimY}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={fsDim}
              fontWeight="500"
              fill="#333"
              style={{
                fontFamily: "system-ui, Segoe UI, sans-serif",
                pointerEvents: "none",
              }}
            >
              {dimLabel}
            </text>
          </g>
        );
      })}

      </g>
      </svg>
    </div>
  );
});

export default FloorPlanCanvas;

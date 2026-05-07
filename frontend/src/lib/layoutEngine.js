/**
 * VisionDesignie - deterministic floor sketch from `design_state` (no LLM geometry).
 * Parameter-driven rectangles: BHK, plot feet, Vastu, layout style, building type.
 */

/** @typedef {{ plot_width: number, plot_height: number, unit: string, rooms: Array<{ name: string, x: number, y: number, width: number, height: number }> }} LayoutPlan */

const ROOM_COLORS = {
  living: { fill: "#FFF8F0", stroke: "#D4A070" },
  dining: { fill: "#FFF3EA", stroke: "#C4906A" },
  kitchen: { fill: "#FFF0E8", stroke: "#E8895A" },
  master: { fill: "#EEF4FF", stroke: "#7090C0" },
  bed2: { fill: "#F0F8F0", stroke: "#70A880" },
  bed3: { fill: "#F4F0FF", stroke: "#9080C0" },
  bed4: { fill: "#FFF0F4", stroke: "#C07090" },
  bath: { fill: "#E8F4FF", stroke: "#60A0C8" },
  toilet: { fill: "#EAF6FF", stroke: "#70AECF" },
  pooja: { fill: "#FFFFF0", stroke: "#C0B060" },
  store: { fill: "#F4F4F0", stroke: "#A0A090" },
  verandah: { fill: "#F0EFE8", stroke: "#B0A890" },
  office: { fill: "#F5F0FF", stroke: "#9080B0" },
};

function clampInt(n, lo, hi) {
  const x = Math.round(Number(n));
  if (!Number.isFinite(x)) return lo;
  return Math.min(hi, Math.max(lo, x));
}

/**
 * Parse plot_size string into integer feet (width x depth).
 * @param {string | null | undefined} plotSizeStr
 * @returns {{ w: number, h: number } | null}
 */
export function parsePlotFeetFromSize(plotSizeStr) {
  if (plotSizeStr == null) return null;
  const raw = String(plotSizeStr).trim();
  // Accept common separators and mojibake variants (x, X, *, ×, Ã—).
  const s = raw.replace(/Ã—/g, "x").replace(/×/g, "x");
  if (!s) return null;

  let m = s.match(
    /(\d+(?:\.\d+)?)\s*ft\s*[xX*]\s*(\d+(?:\.\d+)?)\s*ft\b/i
  );
  if (m) {
    return {
      w: clampInt(m[1], 8, 800),
      h: clampInt(m[2], 8, 800),
    };
  }

  m = s.match(/\b(\d{1,4})\s*[xX*]\s*(\d{1,4})\b/);
  if (m) {
    return { w: clampInt(m[1], 8, 800), h: clampInt(m[2], 8, 800) };
  }

  m = s.match(/~\s*(\d+(?:\.\d+)?)\s*ft\s*[xX*]\s*(\d+(?:\.\d+)?)\s*ft/i);
  if (m) {
    return {
      w: clampInt(m[1], 8, 800),
      h: clampInt(m[2], 8, 800),
    };
  }

  const sq = s.match(
    /(\d{1,6}(?:[.,]\d+)?)\s*(sq\.?\s*ft\.?|sqft|square\s*feet)/i
  );
  if (sq) {
    const raw = sq[1].replace(",", ".");
    const n = parseFloat(raw);
    if (Number.isFinite(n) && n > 100) {
      const side = Math.round(Math.sqrt(n));
      return { w: clampInt(side, 8, 800), h: clampInt(side, 8, 800) };
    }
  }

  return null;
}

function styleFactors() {
  // Keep geometry consistent across style choices so room positions/sizes stay fixed.
  // We still parse style from state for compatibility with surrounding chat flow.
  return { margin: 0.08, verandahH: 0.1, gap: 0.025 };
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Architectural cleanup pass for the sketch:
 * - keep every room fully inside the plot
 * - remove tiny seam gaps between touching rooms (floating precision artifacts)
 * - snap dimensions to 2 decimals for stable rendering/export
 */
function normalizeArchitecturalSketch(rooms, plotW, plotH) {
  const out = rooms.map((r) => {
    const x = Math.max(0, Number(r.x) || 0);
    const y = Math.max(0, Number(r.y) || 0);
    const w = Math.max(0.1, Number(r.width) || 0.1);
    const h = Math.max(0.1, Number(r.height) || 0.1);
    const maxW = Math.max(0.1, plotW - x);
    const maxH = Math.max(0.1, plotH - y);
    return {
      ...r,
      x,
      y,
      width: Math.min(w, maxW),
      height: Math.min(h, maxH),
    };
  });

  const EPS = 0.18;
  for (let i = 0; i < out.length; i += 1) {
    for (let j = i + 1; j < out.length; j += 1) {
      const a = out[i];
      const b = out[j];

      const aRight = a.x + a.width;
      const bRight = b.x + b.width;
      const aBottom = a.y + a.height;
      const bBottom = b.y + b.height;

      const vOverlap = Math.min(aBottom, bBottom) - Math.max(a.y, b.y) > EPS;
      const hOverlap = Math.min(aRight, bRight) - Math.max(a.x, b.x) > EPS;

      if (vOverlap) {
        const gapAB = Math.abs(aRight - b.x);
        const gapBA = Math.abs(bRight - a.x);
        if (gapAB > 0 && gapAB <= EPS) {
          const seam = (aRight + b.x) * 0.5;
          a.width = Math.max(0.1, seam - a.x);
          b.x = seam;
          b.width = Math.max(0.1, bRight - seam);
        } else if (gapBA > 0 && gapBA <= EPS) {
          const seam = (bRight + a.x) * 0.5;
          b.width = Math.max(0.1, seam - b.x);
          a.x = seam;
          a.width = Math.max(0.1, aRight - seam);
        }
      }

      if (hOverlap) {
        const gapAB = Math.abs(aBottom - b.y);
        const gapBA = Math.abs(bBottom - a.y);
        if (gapAB > 0 && gapAB <= EPS) {
          const seam = (aBottom + b.y) * 0.5;
          a.height = Math.max(0.1, seam - a.y);
          b.y = seam;
          b.height = Math.max(0.1, bBottom - seam);
        } else if (gapBA > 0 && gapBA <= EPS) {
          const seam = (bBottom + a.y) * 0.5;
          b.height = Math.max(0.1, seam - b.y);
          a.y = seam;
          a.height = Math.max(0.1, aBottom - seam);
        }
      }
    }
  }

  return out.map((r) => ({
    ...r,
    x: round2(Math.max(0, Math.min(plotW, r.x))),
    y: round2(Math.max(0, Math.min(plotH, r.y))),
    width: round2(Math.max(0.1, Math.min(plotW - r.x, r.width))),
    height: round2(Math.max(0.1, Math.min(plotH - r.y, r.height))),
  }));
}

/**
 * @param {object} state design_state-shaped
 * @returns {LayoutPlan | null}
 */
export function buildLayoutPlanFromDesignState(state) {
  if (!state || typeof state !== "object") return null;
  const bhk = Number(state.bhk);
  if (!Number.isFinite(bhk) || bhk < 1 || bhk > 6) return null;

  const feet = parsePlotFeetFromSize(state.plot_size ?? state.plot);
  if (!feet) return null;

  let w = feet.w;
  let h = feet.h;
  const vastu = state.vastu_preference === true;
  const styleRaw = state.layout_style != null ? String(state.layout_style).toLowerCase() : "";
  const style =
    styleRaw === "traditional" || styleRaw === "compact" || styleRaw === "modern"
      ? styleRaw
      : "modern";
  const fac = styleFactors(style);
  const commercial =
    typeof state.building_type === "string" &&
    /commercial|shop|retail|office/i.test(state.building_type);

  const rooms = [];
  const colorFor = (label) => {
    const l = String(label).toLowerCase();
    if (l.includes("kitchen")) return ROOM_COLORS.kitchen;
    if (l.includes("living") || l.includes("hall")) return ROOM_COLORS.living;
    if (l.includes("dining")) return ROOM_COLORS.dining;
    if (l.includes("master")) return ROOM_COLORS.master;
    if (l.includes("bedroom 2") || l.includes("bed 2")) return ROOM_COLORS.bed2;
    if (l.includes("bedroom 3") || l.includes("bed 3")) return ROOM_COLORS.bed3;
    if (l.includes("bedroom 4") || l.includes("bed 4")) return ROOM_COLORS.bed4;
    if (l.includes("bath")) return ROOM_COLORS.bath;
    if (l.includes("wc") || l.includes("toilet")) return ROOM_COLORS.toilet;
    if (l.includes("pooja") || l.includes("puja")) return ROOM_COLORS.pooja;
    if (l.includes("verandah")) return ROOM_COLORS.verandah;
    if (l.includes("shop") || l.includes("office")) return ROOM_COLORS.office;
    if (l.includes("bedroom")) return ROOM_COLORS.master;
    return ROOM_COLORS.store;
  };
  const add = (name, x, y, rw, rh) => {
    const col = colorFor(name);
    rooms.push({
      name,
      // Keep sub-foot precision so adjacent blocks meet cleanly without
      // visible seams from independent integer rounding.
      x: Number(x),
      y: Number(y),
      width: Number(rw),
      height: Number(rh),
      fill: col.fill,
      stroke: col.stroke,
    });
  };

  // Use full plot footprint for architectural layout (no inset blank border).
  const mx = 0;
  const sx = w * mx;
  const sy = h * mx;
  const sw = w * (1 - 2 * mx);
  const sh = h * (1 - 2 * mx);
  const vh = Math.max(4, h * fac.verandahH);

  if (commercial) {
    add("Shop / front", sx, sy, sw * 0.45, sh * 0.4);
    add("Hall / sales", sx + sw * 0.45, sy, sw * 0.55, sh * 0.4);
    add("Store / rear", sx, sy + sh * 0.4, sw * 0.55, sh * 0.45);
    add("WC", sx + sw * 0.55, sy + sh * 0.4, sw * 0.45, sh * 0.22);
    add("Office / mezz", sx + sw * 0.55, sy + sh * 0.62, sw * 0.45, sh * 0.23);
    return {
      plot_width: w,
      plot_height: h,
      unit: "ft",
      rooms: normalizeArchitecturalSketch(rooms, w, h),
    };
  }

  const bhkc = Math.min(4, Math.max(1, Math.round(bhk)));

  if (bhkc === 1) {
    const coreH = Math.max(1, sh - vh);
    add("Verandah", sx, sy, sw, vh);
    add("Living", sx, sy + vh, sw * 0.55, coreH * 0.42);
    add("Kitchen", sx + sw * 0.55, sy + vh, sw * 0.45, coreH * 0.42);
    add("Bedroom", sx, sy + vh + coreH * 0.42, sw * 0.62, coreH * 0.38);
    add("Bath", sx + sw * 0.62, sy + vh + coreH * 0.42, sw * 0.2, coreH * 0.38);
    add("WC", sx + sw * 0.82, sy + vh + coreH * 0.42, sw * 0.18, coreH * 0.38);
    add(vastu ? "Pooja (NE)" : "Store", sx, sy + vh + coreH * 0.8, sw * 0.35, coreH * 0.2);
    add("Utility", sx + sw * 0.35, sy + vh + coreH * 0.8, sw * 0.65, coreH * 0.2);
  } else if (bhkc === 2) {
    const coreH = Math.max(1, sh - vh);
    add("Verandah", sx, sy, sw, vh);
    add("Living / hall", sx, sy + vh, sw * 0.55, coreH * 0.38);
    add("Kitchen", sx + sw * 0.55, sy + vh, sw * 0.45, coreH * 0.38);
    add("Master bed", sx, sy + vh + coreH * 0.38, sw * 0.55, coreH * 0.38);
    add("Attached bath", sx + sw * 0.55, sy + vh + coreH * 0.38, sw * 0.45, coreH * 0.38);
    add("Bedroom 2", sx, sy + vh + coreH * 0.76, sw * 0.55, coreH * 0.24);
    add("WC", sx + sw * 0.55, sy + vh + coreH * 0.76, sw * 0.22, coreH * 0.24);
    add(vastu ? "Pooja (NE)" : "Store", sx + sw * 0.77, sy + vh + coreH * 0.76, sw * 0.23, coreH * 0.24);
  } else if (bhkc === 3) {
    const topH = vh * 0.95;
    const coreH = Math.max(1, sh - topH);
    add("Verandah", sx, sy, sw, topH);
    add("Living / hall", sx, sy + topH, sw * 0.52, coreH * 0.35);
    add("Kitchen", sx + sw * 0.52, sy + topH, sw * 0.48, coreH * 0.35);
    add("Dining", sx, sy + topH + coreH * 0.35, sw * 0.52, coreH * 0.22);
    add("Utility", sx + sw * 0.52, sy + topH + coreH * 0.35, sw * 0.25, coreH * 0.22);
    add("Bath", sx + sw * 0.77, sy + topH + coreH * 0.35, sw * 0.23, coreH * 0.22);
    add("Master bed", sx, sy + topH + coreH * 0.57, sw * 0.52, coreH * 0.28);
    add("Bedroom 2", sx + sw * 0.52, sy + topH + coreH * 0.57, sw * 0.48, coreH * 0.28);
    add("Bedroom 3", sx, sy + topH + coreH * 0.85, sw * 0.48, coreH * 0.15);
    add("WC", sx + sw * 0.48, sy + topH + coreH * 0.85, sw * 0.26, coreH * 0.15);
    add(vastu ? "Pooja (NE)" : "Store", sx + sw * 0.74, sy + topH + coreH * 0.85, sw * 0.26, coreH * 0.15);
  } else {
    const topH = vh * 0.85;
    const coreH = Math.max(1, sh - topH);
    add("Verandah", sx, sy, sw, topH);
    add("Living", sx, sy + topH, sw * 0.5, coreH * 0.3);
    add("Dining", sx + sw * 0.5, sy + topH, sw * 0.5, coreH * 0.3);
    add("Kitchen", sx, sy + topH + coreH * 0.3, sw * 0.38, coreH * 0.25);
    add("Utility", sx + sw * 0.38, sy + topH + coreH * 0.3, sw * 0.2, coreH * 0.25);
    add("Bath", sx + sw * 0.58, sy + topH + coreH * 0.3, sw * 0.22, coreH * 0.25);
    add("WC", sx + sw * 0.8, sy + topH + coreH * 0.3, sw * 0.2, coreH * 0.25);
    add("Master bed", sx, sy + topH + coreH * 0.55, sw * 0.5, coreH * 0.25);
    add("Bedroom 2", sx + sw * 0.5, sy + topH + coreH * 0.55, sw * 0.5, coreH * 0.25);
    add("Bedroom 3", sx, sy + topH + coreH * 0.8, sw * 0.45, coreH * 0.2);
    add("Bedroom 4", sx + sw * 0.45, sy + topH + coreH * 0.8, sw * 0.35, coreH * 0.2);
    add(vastu ? "Pooja (NE)" : "Store", sx + sw * 0.8, sy + topH + coreH * 0.8, sw * 0.2, coreH * 0.2);
  }

  return {
    plot_width: w,
    plot_height: h,
    unit: "ft",
    rooms: normalizeArchitecturalSketch(rooms, w, h),
  };
}

/**
 * Human-readable error when plot string cannot be turned into feet x feet.
 * @param {string | null | undefined} plotSizeStr
 */
export function layoutEnginePlotError(plotSizeStr) {
  if (!plotSizeStr || !String(plotSizeStr).trim()) {
    return "Add clear plot dimensions (e.g. 30 ft x 40 ft) so the sketch can scale.";
  }
  if (!parsePlotFeetFromSize(plotSizeStr)) {
    return "Plot size needs length x width in feet (or a single sq ft area we can square).";
  }
  return null;
}


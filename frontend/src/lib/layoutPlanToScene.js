/**
 * VisionDesignie — derive 3D scene parameters from {@link buildLayoutPlanFromDesignState} output.
 * Pure client transform: feet → world units, stacked floors, optional furniture hints.
 */

/** World units per foot (keeps typical plots ~10–15u wide). */
export const FT_TO_WORLD = 0.22;

/** Vertical clearance per storey (abstract units, not literal feet). */
export const FLOOR_HEIGHT = 2.35;

/** Slab thickness between storeys. */
export const SLAB_THICK = 0.12;

/** Default wall thickness in world units. */
export const WALL_THICK = 0.06;

/**
 * Shrinks each room shell so shared walls z-fight less (world units, not feet).
 */
export const ROOM_EDGE_INSET = 0.024;

/**
 * Total stacked height in world units (slabs + storeys).
 * @param {number} numFloors
 */
export function stackedBuildingHeight(numFloors) {
  const n = Math.max(1, Math.round(Number(numFloors)) || 1);
  return n * (FLOOR_HEIGHT + SLAB_THICK) + SLAB_THICK;
}

/**
 * Y (world) of centre of structural slab between storey `floorIndex` and `floorIndex+1`.
 * @param {number} floorIndex 0 … numFloors-2
 */
export function interFloorSlabCenterY(floorIndex) {
  return (
    (floorIndex + 1) * (FLOOR_HEIGHT + SLAB_THICK) - SLAB_THICK / 2
  );
}

/**
 * Ground / pad tint from VisionDesignie layout style.
 * @param {string | null | undefined} layoutStyle
 */
export function plotPadColorHex(layoutStyle) {
  const s = String(layoutStyle || "modern").toLowerCase();
  if (s === "traditional") return "#e4dcc8";
  if (s === "compact") return "#dde2e8";
  return "#ebe6df";
}

/**
 * @param {string | undefined} hexLike
 * @returns {number} three.js color number
 */
export function parseRoomColor(hexLike) {
  if (!hexLike || typeof hexLike !== "string") return 0xe8e4dc;
  const s = hexLike.trim();
  const m = s.match(/^#?([0-9a-fA-F]{6})$/);
  if (m) return parseInt(m[1], 16);
  return 0xe8e4dc;
}

/**
 * Bounding box of all rooms in plot coordinates (feet).
 * @param {{ rooms: Array<{ x: number, y: number, width: number, height: number }> }} plan
 * @param {number} plotW
 * @param {number} plotH
 */
export function roomsFootprintBounds(plan, plotW, plotH) {
  if (!plan?.rooms?.length) {
    return { minX: 0, minZ: 0, maxX: plotW, maxZ: plotH };
  }
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const r of plan.rooms) {
    minX = Math.min(minX, r.x);
    minZ = Math.min(minZ, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxZ = Math.max(maxZ, r.y + r.height);
  }
  return {
    minX: Math.max(0, minX),
    minZ: Math.max(0, minZ),
    maxX: Math.min(plotW, maxX),
    maxZ: Math.min(plotH, maxZ),
  };
}

/**
 * @param {string} name
 * @returns {'bed'|'sofa'|'table'|'counter'|'bath'|'none'}
 */
export function roomFurnitureKind(name) {
  const n = String(name || "").toLowerCase();
  if (/kitchen|utility/i.test(n)) return "counter";
  if (/bath|wc|toilet/i.test(n)) return "bath";
  if (/bed|master/i.test(n)) return "bed";
  if (/living|hall|dining|shop/i.test(n)) return "sofa";
  if (/office|store|pooja|puja|verandah/i.test(n)) return "table";
  return "none";
}

/**
 * @param {{ x: number, y: number, width: number, height: number }} room plot-space feet
 * @param {number} floorIndex 0-based
 */
export function roomWorldTransform(room, plotW, plotH, floorIndex) {
  const u = FT_TO_WORLD;
  const w = room.width * u;
  const d = room.height * u;
  const cx = (room.x + room.width / 2 - plotW / 2) * u;
  const cz = (room.y + room.height / 2 - plotH / 2) * u;
  const baseY =
    SLAB_THICK / 2 + floorIndex * (FLOOR_HEIGHT + SLAB_THICK) + 0.02;
  const wallHeight = FLOOR_HEIGHT - SLAB_THICK - 0.08;
  return { cx, cz, w, d, baseY, wallHeight, u };
}

/**
 * Radius for camera framing (world units).
 * @param {number} plotW
 * @param {number} plotH
 */
export function plotSceneRadius(plotW, plotH, numFloors = 2) {
  const u = FT_TO_WORLD;
  const footprint = Math.hypot(plotW * u, plotH * u);
  const nf = Math.max(1, Math.round(Number(numFloors)) || 1);
  return footprint * 0.55 + stackedBuildingHeight(nf) * 0.38;
}

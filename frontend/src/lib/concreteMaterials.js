/**
 * VisionDesignie — cast-concrete look from layout room colours (no textures).
 * Blends each room tint toward neutral concrete so massing reads as built structure.
 */

import * as THREE from "three";

const WALL_CONCRETE = new THREE.Color(0xada8a3);
const FLOOR_CONCRETE = new THREE.Color(0xc8c3be);

/**
 * @param {number} roomHex from parseRoomColor
 * @returns {string} "#rrggbb" for walls
 */
export function concreteWallHex(roomHex) {
  const c = new THREE.Color(roomHex);
  c.lerp(WALL_CONCRETE, 0.66);
  c.multiplyScalar(0.97);
  c.lerp(new THREE.Color(0x8f8c88), 0.08);
  return `#${c.getHexString()}`;
}

/**
 * @param {number} roomHex
 * @returns {string} "#rrggbb" for floor plates (slightly lighter)
 */
export function concreteFloorHex(roomHex) {
  const c = new THREE.Color(roomHex);
  c.lerp(FLOOR_CONCRETE, 0.74);
  c.multiplyScalar(1.03);
  c.r = Math.min(1, c.r);
  c.g = Math.min(1, c.g);
  c.b = Math.min(1, c.b);
  return `#${c.getHexString()}`;
}

/** Shared PBR for cast-in-place walls */
export const CONCRETE_WALL_PBR = {
  roughness: 0.94,
  metalness: 0.028,
  envMapIntensity: 0.85,
};

/** Slightly smoother pour for horizontal slabs */
export const CONCRETE_SLAB_PBR = {
  roughness: 0.91,
  metalness: 0.022,
  envMapIntensity: 0.8,
};

import { useMemo } from "react";
import { roomFurnitureKind, roomWorldTransform } from "../../lib/layoutPlanToScene";

/**
 * Lightweight placeholder geometry per room type (demo / visioning).
 */
export default function FurnitureHints({
  room,
  plotW,
  plotH,
  floorIndex,
  visible,
}) {
  const kind = roomFurnitureKind(room.name);
  const { cx, cz, w, d, baseY } = useMemo(
    () => roomWorldTransform(room, plotW, plotH, floorIndex),
    [room, plotW, plotH, floorIndex]
  );

  const y = baseY + 0.12;
  const scale = Math.min(w, d) * 0.35;

  if (!visible || kind === "none") return null;

  return (
    <group position={[cx, y, cz]}>
      {kind === "bed" ? (
        <group>
          <mesh castShadow position={[0, 0.12, 0]}>
            <boxGeometry args={[w * 0.55, 0.24, d * 0.42]} />
            <meshStandardMaterial color="#5a6a8a" roughness={0.9} metalness={0.02} />
          </mesh>
          <mesh castShadow position={[0, 0.35, -d * 0.12]}>
            <boxGeometry args={[w * 0.52, 0.45, 0.08]} />
            <meshStandardMaterial color="#6b4a32" roughness={0.8} metalness={0.05} />
          </mesh>
        </group>
      ) : null}
      {kind === "sofa" ? (
        <mesh castShadow position={[0, 0.14, 0]}>
          <boxGeometry args={[w * 0.5, 0.28, d * 0.32]} />
          <meshStandardMaterial color="#5a6a8a" roughness={0.9} metalness={0.02} />
        </mesh>
      ) : null}
      {kind === "table" ? (
        <mesh castShadow position={[0, 0.2, 0]}>
          <boxGeometry args={[scale, 0.08, scale * 0.9]} />
          <meshStandardMaterial color="#6b4a32" roughness={0.8} metalness={0.05} />
        </mesh>
      ) : null}
      {kind === "counter" ? (
        <mesh castShadow position={[-w * 0.08, 0.25, 0]}>
          <boxGeometry args={[w * 0.55, 0.5, d * 0.28]} />
          <meshStandardMaterial color="#ddd8d0" roughness={0.65} metalness={0.08} />
        </mesh>
      ) : null}
      {kind === "bath" ? (
        <mesh castShadow position={[0, 0.08, 0]}>
          <boxGeometry args={[w * 0.35, 0.16, d * 0.35]} />
          <meshStandardMaterial color="#ddd8d0" roughness={0.65} metalness={0.08} />
        </mesh>
      ) : null}
    </group>
  );
}

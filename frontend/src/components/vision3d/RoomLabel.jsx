import { useMemo } from "react";
import { Html } from "@react-three/drei";
import { roomWorldTransform } from "../../lib/layoutPlanToScene";

/**
 * Floating 2D label (room name + dimensions in feet) — matches floor sketch legibility.
 */
export default function RoomLabel({
  room,
  plotW,
  plotH,
  floorIndex,
  visible,
}) {
  const { cx, cz, baseY, wallHeight, w } = useMemo(
    () => roomWorldTransform(room, plotW, plotH, floorIndex),
    [room, plotW, plotH, floorIndex]
  );

  const labelY = baseY + wallHeight * 0.42;
  const short = String(room.name || "Room").replace(/\s*\(NE\)\s*/i, " (NE)");
  const dim = `${Math.round(room.width)}'×${Math.round(room.height)}'`;

  if (!visible) return null;

  return (
    <Html
      position={[cx, labelY, cz]}
      center
      distanceFactor={9}
      zIndexRange={[100, 0]}
      style={{
        pointerEvents: "none",
        userSelect: "none",
        textAlign: "center",
        minWidth: Math.min(140, Math.max(72, w * 40)),
      }}
    >
      <div className="vision3d-room-label">
        <div className="vision3d-room-label__name">{short}</div>
        <div className="vision3d-room-label__dim">{dim}</div>
      </div>
    </Html>
  );
}

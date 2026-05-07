import { useMemo } from "react";
import {
  parseRoomColor,
  roomWorldTransform,
  WALL_THICK,
  ROOM_EDGE_INSET,
} from "../../lib/layoutPlanToScene";
import {
  concreteWallHex,
  concreteFloorHex,
  CONCRETE_WALL_PBR,
  CONCRETE_SLAB_PBR,
} from "../../lib/concreteMaterials";

/**
 * Floor slab + four thin walls; cast-concrete look with faint room tint.
 */
export default function RoomVolume({
  room,
  plotW,
  plotH,
  floorIndex,
  wireframe = false,
}) {
  const { cx, cz, w, d, baseY, wallHeight } = useMemo(
    () => roomWorldTransform(room, plotW, plotH, floorIndex),
    [room, plotW, plotH, floorIndex]
  );

  const roomHex = useMemo(() => parseRoomColor(room.fill), [room.fill]);
  const wallHex = useMemo(() => concreteWallHex(roomHex), [roomHex]);
  const floorHex = useMemo(() => concreteFloorHex(roomHex), [roomHex]);

  const inset = ROOM_EDGE_INSET;
  const wi = Math.max(0.12, w - 2 * inset);
  const di = Math.max(0.12, d - 2 * inset);
  const t = WALL_THICK;
  const yMid = baseY + wallHeight * 0.5 + 0.05;
  const floorY = baseY + 0.04;

  const wallMat = {
    color: wallHex,
    ...CONCRETE_WALL_PBR,
    wireframe,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  };

  const floorMat = {
    color: floorHex,
    ...CONCRETE_SLAB_PBR,
    wireframe,
  };

  return (
    <group position={[cx, 0, cz]}>
      <mesh position={[0, floorY, 0]} castShadow receiveShadow>
        <boxGeometry args={[wi * 0.998, 0.08, di * 0.998]} />
        <meshStandardMaterial {...floorMat} />
      </mesh>
      <mesh position={[0, yMid, -di / 2 + t / 2]} castShadow receiveShadow>
        <boxGeometry args={[wi, wallHeight, t]} />
        <meshStandardMaterial {...wallMat} />
      </mesh>
      <mesh position={[0, yMid, di / 2 - t / 2]} castShadow receiveShadow>
        <boxGeometry args={[wi, wallHeight, t]} />
        <meshStandardMaterial {...wallMat} />
      </mesh>
      <mesh position={[-wi / 2 + t / 2, yMid, 0]} castShadow receiveShadow>
        <boxGeometry args={[t, wallHeight, di - 2 * t]} />
        <meshStandardMaterial {...wallMat} />
      </mesh>
      <mesh position={[wi / 2 - t / 2, yMid, 0]} castShadow receiveShadow>
        <boxGeometry args={[t, wallHeight, di - 2 * t]} />
        <meshStandardMaterial {...wallMat} />
      </mesh>
    </group>
  );
}

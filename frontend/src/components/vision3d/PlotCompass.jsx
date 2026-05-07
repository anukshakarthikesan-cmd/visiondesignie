import { useMemo } from "react";
import * as THREE from "three";
import { Line, Html } from "@react-three/drei";
import { FT_TO_WORLD } from "../../lib/layoutPlanToScene";

/**
 * Plot outline on the pad + North marker (-Z matches sketch “N” toward top of 2D view).
 */
export default function PlotCompass({ plotW, plotH }) {
  const u = FT_TO_WORLD;
  const hw = (plotW * u) / 2;
  const hd = (plotH * u) / 2;
  const y = 0.042;

  const outline = useMemo(
    () =>
      [
        new THREE.Vector3(-hw, y, -hd),
        new THREE.Vector3(hw, y, -hd),
        new THREE.Vector3(hw, y, hd),
        new THREE.Vector3(-hw, y, hd),
        new THREE.Vector3(-hw, y, -hd),
      ],
    [hw, hd]
  );

  const northZ = -hd - 0.22;

  return (
    <group>
      <Line points={outline} color="#3a3228" lineWidth={1} />
      <group position={[0, y + 0.1, northZ]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} castShadow>
          <coneGeometry args={[0.11, 0.28, 10]} />
          <meshStandardMaterial color="#4a6fa8" roughness={0.55} metalness={0.12} />
        </mesh>
        <Html position={[0, 0.22, 0]} center distanceFactor={14} style={{ pointerEvents: "none" }}>
          <span className="vision3d-plot-n">N</span>
        </Html>
      </group>
    </group>
  );
}

import { useMemo } from "react";
import { FT_TO_WORLD } from "../../lib/layoutPlanToScene";

function SingleTree({ x, z, growth }) {
  const h = 1.05 + growth;
  return (
    <group position={[x, 0, z]}>
      <mesh castShadow receiveShadow position={[0, h * 0.18, 0]}>
        <cylinderGeometry args={[0.065, 0.085, h * 0.4, 7]} />
        <meshStandardMaterial color="#4a3622" roughness={0.9} metalness={0.02} />
      </mesh>
      <mesh castShadow position={[0, h * 0.52, 0]}>
        <sphereGeometry args={[h * 0.2, 8, 6]} />
        <meshStandardMaterial color="#2d5a32" roughness={0.84} metalness={0.03} />
      </mesh>
    </group>
  );
}

/**
 * Low-poly trees around the plot (reference-style landscaping).
 */
export default function SurroundingTrees({ plotW, plotH }) {
  const u = FT_TO_WORLD;
  const hw = (plotW * u) / 2;
  const hd = (plotH * u) / 2;
  const pad = Math.max(hw, hd) * 0.18 + 0.35;

  const spots = useMemo(
    () =>
      [
        [-hw - pad * 0.95, -hd * 0.35],
        [hw + pad * 0.9, -hd * 0.4],
        [-hw * 0.5, -hd - pad],
        [hw * 0.55, -hd - pad * 0.92],
        [-hw - pad * 0.75, hd * 0.55],
        [hw + pad * 0.85, hd * 0.45],
        [-hw * 0.85, hd + pad * 0.85],
      ].map(([x, z], i) => ({
        x: x + (i % 2) * 0.08,
        z: z + ((i * 0.17) % 0.25),
        s: 0.12 + (i % 4) * 0.1,
      })),
    [hw, hd, pad]
  );

  return (
    <group>
      {spots.map((p, i) => (
        <SingleTree key={i} x={p.x} z={p.z} growth={p.s} />
      ))}
    </group>
  );
}

import { useMemo } from "react";
import RoomVolume from "./RoomVolume";
import RoomLabel from "./RoomLabel";
import FurnitureHints from "./FurnitureHints";
import PlotCompass from "./PlotCompass";
import SurroundingTrees from "./SurroundingTrees";
import {
  FT_TO_WORLD,
  FLOOR_HEIGHT,
  SLAB_THICK,
  roomsFootprintBounds,
  interFloorSlabCenterY,
  plotPadColorHex,
} from "../../lib/layoutPlanToScene";
import { CONCRETE_SLAB_PBR } from "../../lib/concreteMaterials";

export default function LayoutPlanScene({
  plan,
  numFloors,
  roofVisible,
  furnitureVisible,
  labelsVisible = true,
  gridVisible = true,
  wireframe = false,
  layoutStyle,
  treesVisible = true,
}) {
  const { plot_width: pw, plot_height: ph, rooms } = plan;
  const u = FT_TO_WORLD;
  const padColor = plotPadColorHex(layoutStyle);

  const footprint = useMemo(() => {
    const b = roomsFootprintBounds(plan, pw, ph);
    const pad = 0.02;
    const rw = (b.maxX - b.minX + pad * 2) * u;
    const rd = (b.maxZ - b.minZ + pad * 2) * u;
    const rcx = ((b.minX + b.maxX) / 2 - pw / 2) * u;
    const rcz = ((b.minZ + b.maxZ) / 2 - ph / 2) * u;
    return { rw, rd, rcx, rcz, b };
  }, [plan, pw, ph, u]);

  const roofDims = useMemo(() => {
    const pad = 0.12;
    const rw = (footprint.b.maxX - footprint.b.minX + pad * 2) * u;
    const rd = (footprint.b.maxZ - footprint.b.minZ + pad * 2) * u;
    const rcx = ((footprint.b.minX + footprint.b.maxX) / 2 - pw / 2) * u;
    const rcz = ((footprint.b.minZ + footprint.b.maxZ) / 2 - ph / 2) * u;
    const topY =
      numFloors * (FLOOR_HEIGHT + SLAB_THICK) + SLAB_THICK + 0.015;
    return { rw, rd, rcx, rcz, topY };
  }, [footprint, pw, ph, numFloors, u]);

  const entrance = useMemo(() => {
    const frontZ = (footprint.b.minZ - ph / 2) * u;
    const centerX = ((footprint.b.minX + footprint.b.maxX) / 2 - pw / 2) * u;
    const facadeWidth = Math.max(0.9, (footprint.b.maxX - footprint.b.minX) * u * 0.22);
    const doorWidth = Math.max(0.42, Math.min(0.74, facadeWidth * 0.48));
    const doorHeight = Math.max(1.05, FLOOR_HEIGHT * 0.58);
    const frameWidth = Math.min(0.12, Math.max(0.06, doorWidth * 0.18));
    const frameDepth = 0.05;
    const frameHeight = doorHeight + 0.08;
    const yCenter = SLAB_THICK / 2 + doorHeight / 2 + 0.04;
    return {
      x: centerX,
      z: frontZ + frameDepth / 2 + 0.008,
      doorWidth,
      doorHeight,
      frameWidth,
      frameDepth,
      frameHeight,
      yCenter,
    };
  }, [footprint, ph, pw, u]);

  const floorIndices = useMemo(
    () => Array.from({ length: numFloors }, (_, i) => i),
    [numFloors]
  );

  const slabIndices = useMemo(
    () => Array.from({ length: Math.max(0, numFloors - 1) }, (_, i) => i),
    [numFloors]
  );

  const gridSize = Math.max(pw, ph) * u * 2.15;
  const gridDivs = Math.min(
    48,
    Math.max(12, Math.round(Math.max(pw, ph) / 4) * 2)
  );

  const parapetH = 0.12;
  const parapetT = 0.06;

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, -0.01, 0]}>
        <planeGeometry args={[gridSize * 1.35, gridSize * 1.35]} />
        <meshStandardMaterial color="#354838" roughness={0.94} metalness={0.03} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, 0.018, 0]}>
        <planeGeometry args={[pw * u, ph * u]} />
        <meshStandardMaterial color={padColor} roughness={0.78} metalness={0.03} />
      </mesh>

      <PlotCompass plotW={pw} plotH={ph} />

      {treesVisible ? <SurroundingTrees plotW={pw} plotH={ph} /> : null}

      {gridVisible ? (
        <gridHelper args={[gridSize, gridDivs, 0x4a6048, 0x2f3d30]} position={[0, 0.025, 0]} />
      ) : null}

      {slabIndices.map((k) => (
        <mesh
          key={`slab-${k}`}
          position={[footprint.rcx, interFloorSlabCenterY(k), footprint.rcz]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[footprint.rw, SLAB_THICK, footprint.rd]} />
          <meshStandardMaterial
            color="#b0aba6"
            {...CONCRETE_SLAB_PBR}
            wireframe={wireframe}
          />
        </mesh>
      ))}

      {floorIndices.map((fi) => (
        <group key={fi}>
          {rooms.map((room, idx) => (
            <RoomVolume
              key={`${fi}-${room.name}-${idx}`}
              room={room}
              plotW={pw}
              plotH={ph}
              floorIndex={fi}
              wireframe={wireframe}
            />
          ))}
          {labelsVisible
            ? rooms.map((room, idx) => (
                <RoomLabel
                  key={`lbl-${fi}-${idx}`}
                  room={room}
                  plotW={pw}
                  plotH={ph}
                  floorIndex={fi}
                  visible
                />
              ))
            : null}
          {furnitureVisible
            ? rooms.map((room, idx) => (
                <FurnitureHints
                  key={`f-${fi}-${idx}`}
                  room={room}
                  plotW={pw}
                  plotH={ph}
                  floorIndex={fi}
                  visible
                />
              ))
            : null}
        </group>
      ))}

      {/* Ground-floor entrance marker (door + frame + small lintel canopy). */}
      <group position={[entrance.x, 0, entrance.z]}>
        <mesh position={[0, entrance.yCenter, 0.01]} castShadow receiveShadow>
          <boxGeometry args={[entrance.doorWidth, entrance.doorHeight, 0.03]} />
          <meshStandardMaterial color="#131920" roughness={0.72} metalness={0.2} wireframe={wireframe} />
        </mesh>
        <mesh
          position={[
            -(entrance.doorWidth + entrance.frameWidth) / 2 + entrance.frameWidth / 2,
            entrance.yCenter,
            0,
          ]}
          castShadow
        >
          <boxGeometry args={[entrance.frameWidth, entrance.frameHeight, entrance.frameDepth]} />
          <meshStandardMaterial color="#5f6f8d" roughness={0.8} metalness={0.06} wireframe={wireframe} />
        </mesh>
        <mesh
          position={[
            (entrance.doorWidth + entrance.frameWidth) / 2 - entrance.frameWidth / 2,
            entrance.yCenter,
            0,
          ]}
          castShadow
        >
          <boxGeometry args={[entrance.frameWidth, entrance.frameHeight, entrance.frameDepth]} />
          <meshStandardMaterial color="#5f6f8d" roughness={0.8} metalness={0.06} wireframe={wireframe} />
        </mesh>
        <mesh
          position={[0, entrance.yCenter + entrance.frameHeight / 2 - entrance.frameWidth / 2, 0]}
          castShadow
        >
          <boxGeometry args={[entrance.doorWidth + entrance.frameWidth * 2, entrance.frameWidth, entrance.frameDepth]} />
          <meshStandardMaterial color="#5f6f8d" roughness={0.8} metalness={0.06} wireframe={wireframe} />
        </mesh>
        <mesh
          position={[0, entrance.yCenter + entrance.frameHeight / 2 + 0.06, entrance.frameDepth / 2 + 0.04]}
          castShadow
        >
          <boxGeometry args={[entrance.doorWidth + 0.18, 0.035, 0.12]} />
          <meshStandardMaterial color="#8fa0bf" roughness={0.76} metalness={0.08} wireframe={wireframe} />
        </mesh>
      </group>

      {roofVisible ? (
        <group>
          <mesh
            position={[roofDims.rcx, roofDims.topY, roofDims.rcz]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[roofDims.rw, 0.14, roofDims.rd]} />
            <meshStandardMaterial
              color="#b9a090"
              roughness={0.9}
              metalness={0.03}
              wireframe={wireframe}
            />
          </mesh>
          <mesh
            position={[
              roofDims.rcx + roofDims.rw * 0.28,
              roofDims.topY + 0.52,
              roofDims.rcz + roofDims.rd * 0.22,
            ]}
            castShadow
          >
            <boxGeometry args={[0.52, 0.72, 0.52]} />
            <meshStandardMaterial
              color="#949ca2"
              roughness={0.82}
              metalness={0.06}
              wireframe={wireframe}
            />
          </mesh>
          <mesh
            position={[roofDims.rcx, roofDims.topY + parapetH / 2 + 0.07, roofDims.rcz - roofDims.rd / 2 + parapetT / 2]}
            castShadow
          >
            <boxGeometry args={[roofDims.rw, parapetH, parapetT]} />
            <meshStandardMaterial color="#928a84" roughness={0.9} metalness={0.025} wireframe={wireframe} />
          </mesh>
          <mesh
            position={[roofDims.rcx, roofDims.topY + parapetH / 2 + 0.07, roofDims.rcz + roofDims.rd / 2 - parapetT / 2]}
            castShadow
          >
            <boxGeometry args={[roofDims.rw, parapetH, parapetT]} />
            <meshStandardMaterial color="#928a84" roughness={0.9} metalness={0.025} wireframe={wireframe} />
          </mesh>
          <mesh
            position={[roofDims.rcx - roofDims.rw / 2 + parapetT / 2, roofDims.topY + parapetH / 2 + 0.07, roofDims.rcz]}
            castShadow
          >
            <boxGeometry args={[parapetT, parapetH, roofDims.rd - 2 * parapetT]} />
            <meshStandardMaterial color="#928a84" roughness={0.9} metalness={0.025} wireframe={wireframe} />
          </mesh>
          <mesh
            position={[roofDims.rcx + roofDims.rw / 2 - parapetT / 2, roofDims.topY + parapetH / 2 + 0.07, roofDims.rcz]}
            castShadow
          >
            <boxGeometry args={[parapetT, parapetH, roofDims.rd - 2 * parapetT]} />
            <meshStandardMaterial color="#928a84" roughness={0.9} metalness={0.025} wireframe={wireframe} />
          </mesh>
        </group>
      ) : null}
    </group>
  );
}

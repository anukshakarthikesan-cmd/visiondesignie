import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { Sky } from "@react-three/drei";
import LayoutPlanScene from "./LayoutPlanScene";
import CameraPresetRig from "./CameraPresetRig";
import Vision3dExportBridge from "./Vision3dExportBridge";

function Lights() {
  return (
    <>
      <hemisphereLight args={["#cfe8fa", "#3d4a38", 0.42]} />
      <ambientLight intensity={0.28} color="#e8f0f8" />
      <directionalLight
        position={[22, 38, 18]}
        intensity={1.18}
        color="#fff6ec"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={95}
        shadow-camera-left={-32}
        shadow-camera-right={32}
        shadow-camera-top={32}
        shadow-camera-bottom={-32}
        shadow-bias={-0.00025}
      />
      <directionalLight position={[-16, 14, -12]} intensity={0.2} color="#b8c8e8" />
    </>
  );
}

/**
 * Full-viewport R3F canvas: layout plan → stacked extruded rooms + optional roof / furniture.
 * @param {object} props
 * @param {import('../../lib/layoutEngine.js').LayoutPlan | null} props.plan
 * @param {number} props.numFloors
 * @param {boolean} props.roofVisible
 * @param {boolean} props.furnitureVisible
 * @param {'exterior'|'top'|'interior'} props.cameraPreset
 * @param {boolean} [props.labelsVisible]
 * @param {boolean} [props.gridVisible]
 * @param {boolean} [props.wireframe]
 * @param {string | null} [props.layoutStyle]
 * @param {boolean} [props.treesVisible]
 * @param {string} [props.exportBase] filename stem for downloads
 * @param {(api: { capturePng: () => void } | null) => void} [props.onExportReady]
 */
export default function Vision3DCanvas({
  plan,
  numFloors,
  roofVisible,
  furnitureVisible,
  cameraPreset,
  labelsVisible = true,
  gridVisible = true,
  wireframe = false,
  layoutStyle = null,
  treesVisible = true,
  exportBase = "visiondesignie-3d",
  onExportReady,
}) {
  if (!plan?.plot_width || !plan?.plot_height || !plan?.rooms?.length) {
    return null;
  }

  const pw = plan.plot_width;
  const ph = plan.plot_height;

  return (
    <Canvas
      shadows
      camera={{ fov: 48, near: 0.12, far: 220, position: [12, 10, 14] }}
      gl={{ antialias: true, alpha: false }}
      dpr={[1, 2]}
    >
      <color attach="background" args={["#9ec0d8"]} />
      <fog attach="fog" args={["#aacae0", 22, 92]} />
      <Sky
        distance={450000}
        sunPosition={[55, 88, 32]}
        turbidity={2.8}
        rayleigh={0.48}
        mieCoefficient={0.003}
        mieDirectionalG={0.76}
      />
      <Lights />
      <Suspense fallback={null}>
        <LayoutPlanScene
          plan={plan}
          numFloors={numFloors}
          roofVisible={roofVisible}
          furnitureVisible={furnitureVisible}
          labelsVisible={labelsVisible}
          gridVisible={gridVisible}
          wireframe={wireframe}
          layoutStyle={layoutStyle}
          treesVisible={treesVisible}
        />
        <Vision3dExportBridge exportBase={exportBase} onReady={onExportReady} />
      </Suspense>
      <CameraPresetRig
        preset={cameraPreset}
        plotW={pw}
        plotH={ph}
        numFloors={numFloors}
      />
    </Canvas>
  );
}

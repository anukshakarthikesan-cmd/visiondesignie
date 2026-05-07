import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { plotSceneRadius, stackedBuildingHeight } from "../../lib/layoutPlanToScene";

/**
 * @param {'exterior'|'top'|'interior'} preset
 * @param {number} plotW
 * @param {number} plotH
 * @param {number} numFloors
 */
export default function CameraPresetRig({ preset, plotW, plotH, numFloors }) {
  const { camera } = useThree();
  const controlsRef = useRef(null);
  const R = plotSceneRadius(plotW, plotH, numFloors);
  const buildH = stackedBuildingHeight(numFloors);

  useEffect(() => {
    const apply = () => {
      const ctrl = controlsRef.current;
      if (!ctrl) return;
      const midY = buildH * 0.42;
      if (preset === "exterior") {
        camera.position.set(R * 1.02, R * 0.68, R * 1.1);
        ctrl.target.set(0, midY * 0.32, 0);
      } else if (preset === "top") {
        camera.position.set(0, R * 1.42, 0.001);
        ctrl.target.set(0, 0, 0);
      } else {
        camera.position.set(R * 0.26, midY * 0.52, R * 0.38);
        ctrl.target.set(0, midY * 0.28, 0);
      }
      ctrl.update();
      camera.updateProjectionMatrix();
    };
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(apply);
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [preset, plotW, plotH, numFloors, camera, R, buildH]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={2}
      maxDistance={R * 4}
      maxPolarAngle={Math.PI * 0.495}
    />
  );
}

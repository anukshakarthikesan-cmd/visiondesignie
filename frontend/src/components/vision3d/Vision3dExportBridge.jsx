import { useLayoutEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { captureWebglPng } from "../../lib/vision3dExport";

/**
 * Registers PNG snapshot export on the parent.
 * @param {(api: Vision3dExportApi | null) => void} [onReady]
 * @param {string} exportBase filename stem (no extension)
 */

/** @typedef {{ capturePng: () => void }} Vision3dExportApi */

export default function Vision3dExportBridge({ onReady, exportBase }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const onReadyRef = useRef(onReady);

  useLayoutEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useLayoutEffect(() => {
    const base = exportBase || "visiondesignie-3d";
    /** @type {Vision3dExportApi} */
    const api = {
      capturePng: () => {
        captureWebglPng(gl, scene, camera, `${base}-3d.png`);
      },
    };
    onReadyRef.current?.(api);
    return () => {
      onReadyRef.current?.(null);
    };
  }, [gl, scene, camera, exportBase, onReady]);

  return null;
}

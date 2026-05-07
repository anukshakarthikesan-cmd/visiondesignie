/**
 * VisionDesignie — client-only 3D PNG snapshot export.
 */

/**
 * @param {string} base filename without extension
 */
export function sanitizeExportBase(base) {
  const raw = String(base || "3d-preview")
    .replace(/[^a-zA-Z0-9\s-]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40);
  return raw || "visiondesignie-3d";
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * @param {import('three').WebGLRenderer} gl
 * @param {import('three').Scene} scene
 * @param {import('three').Camera} camera
 * @param {string} filename
 */
export function captureWebglPng(gl, scene, camera, filename) {
  const prev = gl.getPixelRatio();
  gl.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  gl.render(scene, camera);
  gl.domElement.toBlob(
    (blob) => {
      gl.setPixelRatio(prev);
      if (!blob) {
        window.alert("Could not create PNG. Try again or use another browser.");
        return;
      }
      triggerDownload(blob, filename.endsWith(".png") ? filename : `${filename}.png`);
    },
    "image/png",
    0.95
  );
}

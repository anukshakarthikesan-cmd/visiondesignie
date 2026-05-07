/**
 * Export the floor-plan SVG as PNG / PDF (client-side).
 */

function ensureSvgXmlns(svgString) {
  if (/^<svg[^>]*\sxmlns\s*=/i.test(svgString)) return svgString;
  return svgString.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not rasterize floor plan"));
    img.src = src;
  });
}

/**
 * Rasterize an in-DOM floor plan SVG to PNG pixels (for PNG file or PDF embedding).
 * @param {SVGSVGElement} svg
 * @param {number} [maxEdge] longest side in CSS pixels
 * @returns {Promise<{ blob: Blob, width: number, height: number }>}
 */
export async function rasterizeFloorPlanSvg(svg, maxEdge = 1600) {
  if (!svg || svg.tagName !== "svg") {
    throw new Error("Missing SVG element");
  }
  const vb = svg.viewBox?.baseVal;
  const vw = vb?.width || 400;
  const vh = vb?.height || 400;
  const scale = maxEdge / Math.max(vw, vh, 1);
  const pixW = Math.max(1, Math.round(vw * scale));
  const pixH = Math.max(1, Math.round(vh * scale));

  let serialized = new XMLSerializer().serializeToString(svg);
  serialized = ensureSvgXmlns(serialized);
  const blob = new Blob([serialized], {
    type: "image/svg+xml;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = pixW;
    canvas.height = pixH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unsupported");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, pixW, pixH);
    ctx.drawImage(img, 0, 0, pixW, pixH);
    const pngBlob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("PNG export failed"))),
        "image/png",
        0.92
      );
    });
    return { blob: pngBlob, width: pixW, height: pixH };
  } finally {
    URL.revokeObjectURL(url);
  }
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
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * @param {SVGSVGElement} svg
 * @param {string} [filename]
 */
export async function downloadFloorPlanPng(svg, filename = "floor-plan.png") {
  const { blob } = await rasterizeFloorPlanSvg(svg);
  triggerDownload(blob, filename);
}

/**
 * @param {SVGSVGElement} svg
 * @param {string} [filename]
 */
export async function downloadFloorPlanSvgFile(
  svg,
  filename = "floor-plan.svg"
) {
  let serialized = new XMLSerializer().serializeToString(svg);
  serialized = ensureSvgXmlns(serialized);
  const blob = new Blob([serialized], {
    type: "image/svg+xml;charset=utf-8",
  });
  triggerDownload(blob, filename);
}

/**
 * @param {SVGSVGElement} svg
 * @param {string} [filename]
 */
export async function downloadFloorPlanPdf(
  svg,
  filename = "floor-plan.pdf"
) {
  const { jsPDF } = await import("jspdf");
  const { blob, width, height } = await rasterizeFloorPlanSvg(svg, 1400);
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(blob);
  });

  const orientation = width >= height ? "l" : "p";
  const pdf = new jsPDF({
    orientation,
    unit: "px",
    format: [width, height],
    hotfixes: ["px_scaling"],
  });
  pdf.addImage(dataUrl, "PNG", 0, 0, width, height, undefined, "FAST");
  pdf.save(filename);
}

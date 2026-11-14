/** One CSS-pixel viewport for camera, canvas, postprocessing and title layout. */
export function displayMetrics(width, height, density = 1, maxTextureSize = 8192) {
  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));
  // Native QHD/4K stays sharp without allocating an enormous Retina MSAA target.
  const pixelRatio = Math.min(Math.max(.5, density || 1), 1.75,
    Math.sqrt(8_500_000 / (width * height)), maxTextureSize / Math.max(width, height));
  const menuScale = Math.max(1, Math.min(2.5, width / 1440, height / 900));
  const stageWidth = Math.min(width, height * 1.9);
  return { width, height, pixelRatio, menuScale, stageWidth,
    stageLeft: (width - stageWidth) / 2, aspect: width / height };
}

export function applyDisplayLayout(metrics) {
  const style = document.documentElement.style;
  const userScale = Math.max(.8, Math.min(1.4, Number(document.documentElement.dataset.uiScale) || 1.1));
  style.setProperty('--viewport-menu-scale', metrics.menuScale.toFixed(4));
  style.setProperty('--menu-scale', (metrics.menuScale * userScale).toFixed(4));
  // The title artwork follows a fixed composition, not the accessibility
  // scale. Only its controls/type grow with that preference.
  const titleScale = Math.min(2.5, metrics.stageWidth / 1440, metrics.height / 800);
  style.setProperty('--title-scale', titleScale.toFixed(4));
  style.setProperty('--title-control-scale', (userScale / 1.1).toFixed(4));
  style.setProperty('--menu-stage', `${metrics.stageWidth}px`);
  style.setProperty('--menu-left', `${metrics.stageLeft}px`);
}

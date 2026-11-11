// 由 spike/phase0/vision.js 迁移：ESM -> CommonJS，且把 Canvas 依赖剥离为纯像素输入。
// 输入 image = { data: Uint8ClampedArray|Array, width, height }，data 为 RGBA 一维数组。
// 这样同一套算法可以在小程序 Canvas 2D 的 getImageData 与 Node 合成图像自检中共用。
const { COLOR_HEX, COLOR_ORDER } = require('../../utils/colors.js');

function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16)
  };
}

function rgbToLab(r, g, b) {
  let R = r / 255;
  let G = g / 255;
  let B = b / 255;
  R = R > 0.04045 ? Math.pow((R + 0.055) / 1.055, 2.4) : R / 12.92;
  G = G > 0.04045 ? Math.pow((G + 0.055) / 1.055, 2.4) : G / 12.92;
  B = B > 0.04045 ? Math.pow((B + 0.055) / 1.055, 2.4) : B / 12.92;
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let y = (R * 0.2126 + G * 0.7152 + B * 0.0722) / 1;
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  x = x > 0.008856 ? Math.pow(x, 1 / 3) : 7.787 * x + 16 / 116;
  y = y > 0.008856 ? Math.pow(y, 1 / 3) : 7.787 * y + 16 / 116;
  z = z > 0.008856 ? Math.pow(z, 1 / 3) : 7.787 * z + 16 / 116;
  return { L: 116 * y - 16, a: 500 * (x - y), b: 200 * (y - z) };
}

function rgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function labDist(a, b) {
  const dL = a.L - b.L;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

function chroma(lab) {
  return Math.sqrt(lab.a * lab.a + lab.b * lab.b);
}

function defaultPalette() {
  const palette = {};
  for (const color of COLOR_ORDER) {
    const rgb = hexToRgb(COLOR_HEX[color]);
    palette[color] = rgbToLab(rgb.r, rgb.g, rgb.b);
  }
  return palette;
}

/** 等比装入正方形画布（contain），避免竖拍被中间裁切 */
function fitPhotoLayout(imgWidth, imgHeight, size) {
  const scale = Math.min(size / imgWidth, size / imgHeight);
  const dw = imgWidth * scale;
  const dh = imgHeight * scale;
  return { dx: (size - dw) / 2, dy: (size - dh) / 2, dw, dh, scale };
}

/** 用四角背景对比，找出中间魔方面的大致外框 */
function detectFaceRect(image, layout) {
  const { data, width: W, height: H } = image;
  const x0 = layout ? Math.floor(layout.dx) : 0;
  const y0 = layout ? Math.floor(layout.dy) : 0;
  const x1 = layout ? Math.ceil(layout.dx + layout.dw) : W;
  const y1 = layout ? Math.ceil(layout.dy + layout.dh) : H;

  const corner = (cx, cy) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let y = cy; y < cy + 8; y++) {
      for (let x = cx; x < cx + 8; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = (y * W + x) * 4;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        n += 1;
      }
    }
    if (!n) return { r: 17, g: 17, b: 17 };
    return { r: r / n, g: g / n, b: b / n };
  };

  const inset = 4;
  const bgs = [
    corner(x0 + inset, y0 + inset),
    corner(x1 - 10 - inset, y0 + inset),
    corner(x0 + inset, y1 - 10 - inset),
    corner(x1 - 10 - inset, y1 - 10 - inset)
  ];
  const bg = {
    r: (bgs[0].r + bgs[1].r + bgs[2].r + bgs[3].r) / 4,
    g: (bgs[0].g + bgs[1].g + bgs[2].g + bgs[3].g) / 4,
    b: (bgs[0].b + bgs[1].b + bgs[2].b + bgs[3].b) / 4
  };
  const bgLab = rgbToLab(bg.r, bg.g, bg.b);
  const step = Math.max(2, Math.floor(W / 160));
  let minX = W;
  let minY = H;
  let maxX = 0;
  let maxY = 0;
  let hits = 0;
  const scanX0 = Math.max(0, x0);
  const scanY0 = Math.max(0, y0);
  const scanX1 = Math.min(W, x1);
  const scanY1 = Math.min(H, y1);

  for (let y = scanY0; y < scanY1; y += step) {
    for (let x = scanX0; x < scanX1; x += step) {
      const i = (y * W + x) * 4;
      const lab = rgbToLab(data[i], data[i + 1], data[i + 2]);
      const hsv = rgbToHsv(data[i], data[i + 1], data[i + 2]);
      if (labDist(lab, bgLab) < 26) continue;
      if (hsv.s < 0.12 && Math.abs(lab.L - bgLab.L) < 18) continue;
      hits += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  const contentW = Math.max(1, scanX1 - scanX0);
  const contentH = Math.max(1, scanY1 - scanY0);
  const fallbackSide = Math.min(contentW, contentH) * 0.72;
  const fallback = {
    x: scanX0 + (contentW - fallbackSide) / 2,
    y: scanY0 + (contentH - fallbackSide) / 2,
    w: fallbackSide,
    h: fallbackSide,
    angle: 0
  };
  if (hits < 30) return fallback;

  const pad = Math.max(12, (maxX - minX) * 0.1);
  let x = Math.max(scanX0, minX - pad);
  let y = Math.max(scanY0, minY - pad);
  let w = Math.min(scanX1 - x, maxX - minX + 2 * pad);
  let h = Math.min(scanY1 - y, maxY - minY + 2 * pad);
  const side = Math.min(contentW, contentH, Math.max(w, h) * 1.06);
  x = x + w / 2 - side / 2;
  y = y + h / 2 - side / 2;
  if (x < scanX0) x = scanX0;
  if (y < scanY0) y = scanY0;
  if (x + side > scanX1) x = scanX1 - side;
  if (y + side > scanY1) y = scanY1 - side;
  if (side < Math.min(contentW, contentH) * 0.18) return fallback;
  const inner = side * 0.02;
  return { x: x + inner, y: y + inner, w: side - 2 * inner, h: side - 2 * inner, angle: 0 };
}

function guideCenter(rect) {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

function rotatePoint(px, py, cx, cy, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = px - cx;
  const dy = py - cy;
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
}

function unrotatePoint(px, py, cx, cy, angle) {
  return rotatePoint(px, py, cx, cy, -angle);
}

function rotateHandleLocal(rect) {
  const c = guideCenter(rect);
  return { x: c.x, y: rect.y - Math.max(24, rect.w * 0.09) };
}

/** 限制九宫格在画布内（考虑旋转后的轴对齐外接） */
function clampGuideRect(rect, size) {
  const angle = rect.angle || 0;
  const minSide = Math.max(48, size * 0.08);
  let side = Math.max(minSide, Math.min(size * 0.98, rect.w, rect.h));
  let cx = rect.x + rect.w / 2;
  let cy = rect.y + rect.h / 2;
  cx = Math.min(size - 4, Math.max(4, cx));
  cy = Math.min(size - 4, Math.max(4, cy));
  const grow = Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle)) || 1;
  const room = Math.min(cx, cy, size - cx, size - cy);
  const maxSide = Math.max(minSide, (2 * room) / grow);
  side = Math.min(side, maxSide);
  return { x: cx - side / 2, y: cy - side / 2, w: side, h: side, angle };
}

function samplePatch(data, width, height, cx, cy, radius) {
  const values = [];
  const x0 = Math.max(0, Math.floor(cx - radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const x1 = Math.min(width - 1, Math.ceil(cx + radius));
  const y1 = Math.min(height - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * width + x) * 4;
      values.push([data[i], data[i + 1], data[i + 2]]);
    }
  }
  if (!values.length) return { r: 0, g: 0, b: 0 };
  // 截尾均值：去掉最亮最暗各 25%，压反光
  values.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  const trim = Math.floor(values.length * 0.25);
  const kept = values.slice(trim, Math.max(trim + 1, values.length - trim));
  let r = 0;
  let g = 0;
  let b = 0;
  for (const v of kept) {
    r += v[0];
    g += v[1];
    b += v[2];
  }
  const n = kept.length;
  return { r: r / n, g: g / n, b: b / n };
}

/** 单格内 5x5 多点搜索，取最「像贴纸」的一点；支持九宫格整体旋转 */
function sampleCell(data, width, height, cell, gcx, gcy, angle) {
  const marginX = cell.w * 0.15;
  const marginY = cell.h * 0.15;
  const x0 = cell.x + marginX;
  const y0 = cell.y + marginY;
  const x1 = cell.x + cell.w - marginX;
  const y1 = cell.y + cell.h - marginY;
  const radius = Math.min(cell.w, cell.h) * 0.12;
  let best = null;
  let bestScore = -1;
  const steps = 5;
  for (let iy = 0; iy < steps; iy++) {
    for (let ix = 0; ix < steps; ix++) {
      const lx = x0 + ((ix + 0.5) / steps) * (x1 - x0);
      const ly = y0 + ((iy + 0.5) / steps) * (y1 - y0);
      const world = rotatePoint(lx, ly, gcx, gcy, angle);
      const rgb = samplePatch(data, width, height, world.x, world.y, radius);
      const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      const lab = rgbToLab(rgb.r, rgb.g, rgb.b);
      if (hsv.v < 0.16) continue;
      const colorful = chroma(lab) * 2.2 + (hsv.s > 0.18 ? 35 : 0);
      const whitish = hsv.s < 0.2 && hsv.v > 0.5 ? hsv.v * 85 : 0;
      const score = Math.max(colorful, whitish) + hsv.v * 15;
      if (score > bestScore) {
        bestScore = score;
        best = { rgb, x: world.x, y: world.y };
      }
    }
  }
  if (best) return best;
  const mid = rotatePoint(cell.x + cell.w / 2, cell.y + cell.h / 2, gcx, gcy, angle);
  return {
    rgb: samplePatch(data, width, height, mid.x, mid.y, radius),
    x: mid.x,
    y: mid.y
  };
}

function sampleFaceColors(image, rect) {
  const angle = rect.angle || 0;
  const c = guideCenter(rect);
  const { data, width, height } = image;
  const cellW = rect.w / 3;
  const cellH = rect.h / 3;
  const samples = [];
  const points = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const cell = {
        x: rect.x + col * cellW,
        y: rect.y + row * cellH,
        w: cellW,
        h: cellH
      };
      const hit = sampleCell(data, width, height, cell, c.x, c.y, angle);
      samples.push(hit.rgb);
      points.push({ x: hit.x, y: hit.y });
    }
  }
  return { samples, rect, points };
}

/** HSV 粗分 + Lab 近邻精修；白靠低饱和，避免绿被认成白 */
function classifySticker(rgb, palette) {
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  const lab = rgbToLab(rgb.r, rgb.g, rgb.b);
  const c = chroma(lab);
  if ((hsv.s < 0.16 && hsv.v > 0.45) || (c < 14 && lab.L > 55)) {
    return { color: 'U', conf: 0.9, lab, hsv };
  }

  let hueGuess = null;
  if (hsv.s >= 0.14) {
    const h = hsv.h;
    if (h < 18 || h >= 345) hueGuess = 'R';
    else if (h < 45) hueGuess = 'L';
    else if (h < 75) hueGuess = 'D';
    else if (h < 170) hueGuess = 'F';
    else if (h < 270) hueGuess = 'B';
    else hueGuess = 'R';
  }

  let best = null;
  let second = null;
  for (const color of COLOR_ORDER) {
    let dist = labDist(lab, palette[color]);
    if (hueGuess && color === hueGuess) dist *= 0.72;
    if (color === 'U' && c > 18) dist *= 1.35;
    const item = { color, dist };
    if (!best || dist < best.dist) {
      second = best;
      best = item;
    } else if (!second || dist < second.dist) {
      second = item;
    }
  }
  const gap = second ? second.dist - best.dist : 99;
  let conf = gap > 12 ? 0.85 : gap > 6 ? 0.6 : 0.35;
  if (best.dist > 55) conf = Math.min(conf, 0.3);
  return { color: best.color, conf, lab, hsv, best, second };
}

function centerLooksLike(face, rgb) {
  const { color, conf, hsv, lab } = classifySticker(rgb, defaultPalette());
  if (color === face && conf >= 0.3) return true;
  if (face === 'U') return hsv.v > 0.45 && (hsv.s < 0.35 || chroma(lab) < 28 || lab.L > 55);
  if (face === 'R') return (hsv.h < 30 || hsv.h > 330) && hsv.s > 0.12;
  if (face === 'L') return hsv.h >= 12 && hsv.h < 55 && hsv.s > 0.12;
  if (face === 'D') return hsv.h >= 35 && hsv.h < 85 && hsv.s > 0.12;
  if (face === 'F') return hsv.h >= 65 && hsv.h < 175 && hsv.s > 0.12;
  if (face === 'B') return hsv.h >= 170 && hsv.h < 280 && hsv.s > 0.12;
  return false;
}

/** 识别一面：中心固定为该面颜色，中心采样像该色时才用其校准色板 */
function recognizeFace(samples, face, palette) {
  const center = samples[4];
  const centerOk = centerLooksLike(face, center);
  if (centerOk) palette[face] = rgbToLab(center.r, center.g, center.b);

  const colors = Array(9);
  let uncertain = 0;
  for (let i = 0; i < 9; i++) {
    if (i === 4) {
      colors[i] = face;
      continue;
    }
    const hit = classifySticker(samples[i], palette);
    const unsure = hit.conf < 0.45;
    colors[i] = unsure ? '?' : hit.color;
    if (unsure) uncertain += 1;
  }
  return { colors, uncertain, palette, centerMismatch: !centerOk };
}

/** 小程序侧主入口：按用户对齐的九宫格取样并识别 */
function analyzeFace(image, face, palette, rect) {
  const guide = clampGuideRect(rect, image.width);
  const { samples, points } = sampleFaceColors(image, guide);
  const result = recognizeFace(samples, face, palette);
  return Object.assign({}, result, { rect: guide, points, samples });
}

module.exports = {
  hexToRgb,
  rgbToLab,
  rgbToHsv,
  labDist,
  chroma,
  defaultPalette,
  fitPhotoLayout,
  detectFaceRect,
  guideCenter,
  rotatePoint,
  unrotatePoint,
  rotateHandleLocal,
  clampGuideRect,
  sampleFaceColors,
  classifySticker,
  recognizeFace,
  analyzeFace
};

import { COLOR_HEX, COLOR_ORDER } from "./colors.js";

function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function rgbToLab(r, g, b) {
  let R = r / 255;
  let G = g / 255;
  let B = b / 255;
  R = R > 0.04045 ? ((R + 0.055) / 1.055) ** 2.4 : R / 12.92;
  G = G > 0.04045 ? ((G + 0.055) / 1.055) ** 2.4 : G / 12.92;
  B = B > 0.04045 ? ((B + 0.055) / 1.055) ** 2.4 : B / 12.92;
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let y = (R * 0.2126 + G * 0.7152 + B * 0.0722) / 1;
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  x = x > 0.008856 ? x ** (1 / 3) : 7.787 * x + 16 / 116;
  y = y > 0.008856 ? y ** (1 / 3) : 7.787 * y + 16 / 116;
  z = z > 0.008856 ? z ** (1 / 3) : 7.787 * z + 16 / 116;
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

export function defaultPalette() {
  const palette = {};
  for (const color of COLOR_ORDER) {
    const rgb = hexToRgb(COLOR_HEX[color]);
    palette[color] = rgbToLab(rgb.r, rgb.g, rgb.b);
  }
  return palette;
}

/** 读图并按 EXIF 摆正（手机竖拍否则会裁歪/只显示一段）。 */
export async function loadImageFile(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // fall through
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片读取失败"));
    };
    img.src = url;
  });
}

/** 用四角背景对比，找出中间魔方面的大致外框。 */
export function detectFaceRect(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { width: W, height: H } = canvas;
  const { data } = ctx.getImageData(0, 0, W, H);
  // contain 留边时，从照片内容区四角取背景，别拿到黑边
  const L = canvas._photoLayout;
  const x0 = L ? Math.floor(L.dx) : 0;
  const y0 = L ? Math.floor(L.dy) : 0;
  const x1 = L ? Math.ceil(L.dx + L.dw) : W;
  const y1 = L ? Math.ceil(L.dy + L.dh) : H;
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
    corner(x1 - 10 - inset, y1 - 10 - inset),
  ];
  const bg = {
    r: (bgs[0].r + bgs[1].r + bgs[2].r + bgs[3].r) / 4,
    g: (bgs[0].g + bgs[1].g + bgs[2].g + bgs[3].g) / 4,
    b: (bgs[0].b + bgs[1].b + bgs[2].b + bgs[3].b) / 4,
  };
  const bgLab = rgbToLab(bg.r, bg.g, bg.b);
  const step = Math.max(2, Math.floor(W / 160));
  let minX = W;
  let minY = H;
  let maxX = 0;
  let maxY = 0;
  let hits = 0;
  // 只扫照片内容区，忽略 contain 黑边
  const scanX0 = Math.max(0, x0);
  const scanY0 = Math.max(0, y0);
  const scanX1 = Math.min(W, x1);
  const scanY1 = Math.min(H, y1);
  for (let y = scanY0; y < scanY1; y += step) {
    for (let x = scanX0; x < scanX1; x += step) {
      const i = (y * W + x) * 4;
      const lab = rgbToLab(data[i], data[i + 1], data[i + 2]);
      const hsv = rgbToHsv(data[i], data[i + 1], data[i + 2]);
      const delta = labDist(lab, bgLab);
      // 只要和四角背景接近，一律当背景（修好米色墙被当成魔方的问题）
      if (delta < 26) continue;
      // 再要一点饱和度或足够亮度差，滤掉阴影噪声
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
  };
  if (hits < 30) return fallback;
  // 外扩更多，九宫格要盖住整面贴纸，而不是缩在中间
  const pad = Math.max(12, (maxX - minX) * 0.1);
  let x = Math.max(scanX0, minX - pad);
  let y = Math.max(scanY0, minY - pad);
  let w = Math.min(scanX1 - x, maxX - minX + 2 * pad);
  let h = Math.min(scanY1 - y, maxY - minY + 2 * pad);
  // 取较大边做成正方形，宁大勿小；不超过照片内容区
  const side = Math.min(contentW, contentH, Math.max(w, h) * 1.06);
  x = x + w / 2 - side / 2;
  y = y + h / 2 - side / 2;
  if (x < scanX0) x = scanX0;
  if (y < scanY0) y = scanY0;
  if (x + side > scanX1) x = scanX1 - side;
  if (y + side > scanY1) y = scanY1 - side;
  if (side < Math.min(contentW, contentH) * 0.18) return fallback;
  // 只轻微内缩，避免切到最外一圈背景
  const inner = side * 0.02;
  return { x: x + inner, y: y + inner, w: side - 2 * inner, h: side - 2 * inner };
}

export function guideCenter(rect) {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

export function rotatePoint(px, py, cx, cy, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = px - cx;
  const dy = py - cy;
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
}

export function unrotatePoint(px, py, cx, cy, angle) {
  return rotatePoint(px, py, cx, cy, -angle);
}

export function rotateHandleLocal(rect) {
  const c = guideCenter(rect);
  return { x: c.x, y: rect.y - Math.max(24, rect.w * 0.09) };
}

export function drawGuide(ctx, rect, size, opts = {}) {
  const angle = rect.angle || 0;
  const c = guideCenter(rect);
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, size - 2, size - 2);

  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(angle);
  ctx.translate(-c.x, -c.y);

  ctx.strokeStyle = "rgba(240,194,75,0.95)";
  ctx.lineWidth = 3;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  for (let i = 1; i < 3; i++) {
    const px = rect.x + (rect.w * i) / 3;
    const py = rect.y + (rect.h * i) / 3;
    ctx.beginPath();
    ctx.moveTo(px, rect.y);
    ctx.lineTo(px, rect.y + rect.h);
    ctx.moveTo(rect.x, py);
    ctx.lineTo(rect.x + rect.w, py);
    ctx.stroke();
  }
  if (opts.handles) {
    const hs = Math.max(10, rect.w * 0.04);
    ctx.fillStyle = "#f0c24b";
    const corners = [
      [rect.x, rect.y],
      [rect.x + rect.w, rect.y],
      [rect.x, rect.y + rect.h],
      [rect.x + rect.w, rect.y + rect.h],
    ];
    for (const [hx, hy] of corners) {
      ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
    }
    // 顶部旋转柄
    const rh = rotateHandleLocal(rect);
    ctx.beginPath();
    ctx.moveTo(c.x, rect.y);
    ctx.lineTo(rh.x, rh.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(rh.x, rh.y, Math.max(9, rect.w * 0.035), 0, Math.PI * 2);
    ctx.fillStyle = "#f0c24b";
    ctx.fill();
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();
}

/** 整图等比装入正方形画布（contain），竖拍不再被中间裁切。 */
export function fitPhotoLayout(img, size) {
  const scale = Math.min(size / img.width, size / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  return {
    dx: (size - dw) / 2,
    dy: (size - dh) / 2,
    dw,
    dh,
    scale,
  };
}

/** 只铺照片，不画框。 */
export function paintPhotoBase(canvas, img) {
  const size = canvas.width;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const layout = fitPhotoLayout(img, size);
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(img, 0, 0, img.width, img.height, layout.dx, layout.dy, layout.dw, layout.dh);
  canvas._photoLayout = layout;
  return layout;
}

/** 画预览：照片 + 可调九宫格。 */
export function drawFacePreview(canvas, img, faceRect, opts = {}) {
  paintPhotoBase(canvas, img);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const rect = faceRect || detectFaceRect(canvas);
  drawGuide(ctx, rect, canvas.width, opts);
  return rect;
}

export function clampGuideRect(rect, size) {
  const angle = rect.angle || 0;
  const minSide = Math.max(48, size * 0.08);
  const maxCanvas = size * 0.98;
  let side = Math.max(minSide, Math.min(maxCanvas, rect.w, rect.h));
  let cx = rect.x + rect.w / 2;
  let cy = rect.y + rect.h / 2;
  cx = Math.min(size - 4, Math.max(4, cx));
  cy = Math.min(size - 4, Math.max(4, cy));
  // 旋转正方形的轴对齐外接：半宽 = (side/2)*(|cos|+|sin|)
  // 0° 时可几乎铺满画布；45° 时才按对角线收紧
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

/** 在单格内多点搜索；angle 时按框中心旋转到画布坐标再采样。 */
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
      if (hsv.v < 0.16) continue; // 黑框/深影
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
    y: mid.y,
  };
}

/** 只在检测到的魔方面矩形里采 9 格（支持旋转）。 */
export function sampleFaceColors(canvas, faceRect) {
  const rect = faceRect || detectFaceRect(canvas);
  const angle = rect.angle || 0;
  const c = guideCenter(rect);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { width, height } = canvas;
  const image = ctx.getImageData(0, 0, width, height);
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
        h: cellH,
      };
      const hit = sampleCell(image.data, width, height, cell, c.x, c.y, angle);
      samples.push(hit.rgb);
      points.push({ x: hit.x, y: hit.y });
    }
  }
  return { samples, rect, points };
}

function markSamples(ctx, points, colors) {
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const color = colors[i];
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = color === "?" ? "#666" : COLOR_HEX[color];
    ctx.fill();
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

/** HSV 粗分 + Lab 近邻精修。白靠低饱和，避免绿被认成白。 */
export function classifySticker(rgb, palette) {
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  const lab = rgbToLab(rgb.r, rgb.g, rgb.b);
  const c = chroma(lab);

  // 白：饱和度低、亮度够。暖光下绿仍有明显色度，不会进这里。
  if ((hsv.s < 0.16 && hsv.v > 0.45) || (c < 14 && lab.L > 55)) {
    return { color: "U", conf: 0.9, lab, hsv };
  }

  let hueGuess = null;
  if (hsv.s >= 0.14) {
    const h = hsv.h;
    if (h < 18 || h >= 345) hueGuess = "R";
    else if (h < 45) hueGuess = "L"; // 橙
    else if (h < 75) hueGuess = "D"; // 黄
    else if (h < 170) hueGuess = "F"; // 绿
    else if (h < 270) hueGuess = "B"; // 蓝
    else hueGuess = "R";
  }

  let best = null;
  let second = null;
  for (const color of COLOR_ORDER) {
    let dist = labDist(lab, palette[color]);
    // 色相投票加分
    if (hueGuess && color === hueGuess) dist *= 0.72;
    // 白色板距离：有色贴纸不要轻易贴白
    if (color === "U" && c > 18) dist *= 1.35;
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
  // 宽松：同色相家族。白中心常有品牌 Logo，饱和度会偏高，不能卡太死。
  if (face === "U") return hsv.v > 0.45 && (hsv.s < 0.35 || chroma(lab) < 28 || lab.L > 55);
  if (face === "R") return (hsv.h < 30 || hsv.h > 330) && hsv.s > 0.12;
  if (face === "L") return hsv.h >= 12 && hsv.h < 55 && hsv.s > 0.12;
  if (face === "D") return hsv.h >= 35 && hsv.h < 85 && hsv.s > 0.12;
  if (face === "F") return hsv.h >= 65 && hsv.h < 175 && hsv.s > 0.12;
  if (face === "B") return hsv.h >= 170 && hsv.h < 280 && hsv.s > 0.12;
  return false;
}

/**
 * 识别一面。中心固定为该面颜色；仅当中心采样像该色时才更新色板。
 * 返回 colors / uncertain / centerMismatch / points。
 */
export function recognizeFace(samples, face, palette) {
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
    colors[i] = unsure ? "?" : hit.color;
    if (unsure) uncertain += 1;
  }
  return {
    colors,
    uncertain,
    palette,
    centerMismatch: !centerOk,
  };
}

/** 用指定九宫格识别，并画出采样点。 */
export function recognizeAtRect(canvas, img, face, palette, rect) {
  paintPhotoBase(canvas, img);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const guide = clampGuideRect(rect, canvas.width);
  drawGuide(ctx, guide, canvas.width, { handles: false });
  const { samples, points } = sampleFaceColors(canvas, guide);
  const result = recognizeFace(samples, face, palette);
  markSamples(ctx, points, result.colors);
  return { ...result, rect: guide, points, samples };
}

/** 兼容旧调用：自动框 + 立即识别。 */
export function analyzeFaceImage(canvas, img, face, palette) {
  paintPhotoBase(canvas, img);
  const rect = detectFaceRect(canvas);
  return recognizeAtRect(canvas, img, face, palette, rect);
}

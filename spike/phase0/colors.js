export const SOLVED =
  "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";

export const COLOR_ORDER = ["U", "R", "F", "D", "L", "B"];

// 键盘 1–6（含小键盘）→ 白红绿黄橙蓝。六色需要六个键，所以从 1 起而不是 2–6。
export const KEY_TO_COLOR = {
  "1": "U",
  "2": "R",
  "3": "F",
  "4": "D",
  "5": "L",
  "6": "B",
};

// 一面 9 格里可填的 8 格顺序（跳过中心）
export const FACE_SLOTS = [0, 1, 2, 3, 5, 6, 7, 8];

export const COLOR_HEX = {
  U: "#f5f5f5",
  D: "#ffd500",
  R: "#b71234",
  L: "#ff6b1a",
  F: "#009b48",
  B: "#0046ad",
  "?": "#e4ddd4",
};

export const COLOR_NAME = {
  U: "白",
  D: "黄",
  R: "红",
  L: "橙",
  F: "绿",
  B: "蓝",
};

export const FACE_TITLE = {
  U: "上面 U",
  R: "右面 R",
  F: "前面 F",
  D: "下面 D",
  L: "左面 L",
  B: "后面 B",
};

// 拍照填色固定顺序：按中心色认面，不要按手里随便哪一面的颜色乱传。
// 1白 2红 3绿 4黄 5橙 6蓝
export const PHOTO_STEPS = COLOR_ORDER.map((face, index) => ({
  face,
  step: index + 1,
  centerColor: COLOR_NAME[face],
  title: FACE_TITLE[face],
  label: index + 1 + "." + COLOR_NAME[face] + "心·" + FACE_TITLE[face],
}));

// 展开图：左 L，中 F，右 R，上 U，下 D，再右 B
export const NET_LAYOUT = [
  { face: "U", row: 0, col: 1 },
  { face: "L", row: 1, col: 0 },
  { face: "F", row: 1, col: 1 },
  { face: "R", row: 1, col: 2 },
  { face: "B", row: 1, col: 3 },
  { face: "D", row: 2, col: 1 },
];

export function emptyFacelets() {
  return Array(54).fill("?");
}

export function solvedFacelets() {
  return SOLVED.split("");
}

export function countColors(facelets) {
  const counts = { U: 0, R: 0, F: 0, D: 0, L: 0, B: 0, "?": 0 };
  for (const color of facelets) counts[color] = (counts[color] || 0) + 1;
  return counts;
}

export function centersOk(facelets) {
  return COLOR_ORDER.every((face, i) => facelets[i * 9 + 4] === face);
}

export function countError(facelets) {
  const counts = countColors(facelets);
  if (counts["?"]) return "还有 " + counts["?"] + " 格没填色";
  for (const color of COLOR_ORDER) {
    if (counts[color] !== 9) {
      return COLOR_NAME[color] + "色应是 9 格，现在是 " + counts[color] + " 格";
    }
  }
  return null;
}

const SLOT_NAME = [
  "左上",
  "上中",
  "右上",
  "左中",
  "中心",
  "右中",
  "左下",
  "下中",
  "右下",
];

// 与 rubik-solver 一致：角块 / 棱块对应的 54 格下标
const CORNER_FACELETS = [
  [8, 9, 20], // URF
  [6, 18, 38], // UFL
  [0, 36, 47], // ULB
  [2, 45, 11], // UBR
  [29, 26, 15], // DFR
  [27, 44, 24], // DLF
  [33, 53, 42], // DBL
  [35, 17, 51], // DRB
];
const EDGE_FACELETS = [
  [5, 10], // UR
  [7, 19], // UF
  [3, 37], // UL
  [1, 46], // UB
  [32, 16], // DR
  [28, 25], // DF
  [30, 43], // DL
  [34, 52], // DB
  [23, 12], // FR
  [21, 41], // FL
  [50, 39], // BL
  [48, 14], // BR
];
const LEGAL_CORNERS = new Set(
  ["URF", "UFL", "ULB", "UBR", "DFR", "DLF", "DBL", "DRB"].map((name) =>
    [...name].sort().join(""),
  ),
);
const LEGAL_EDGES = new Set(
  ["UR", "UF", "UL", "UB", "DR", "DF", "DL", "DB", "FR", "FL", "BL", "BR"].map(
    (name) => [...name].sort().join(""),
  ),
);

export function describeFacelet(index, color) {
  const face = COLOR_ORDER[Math.floor(index / 9)];
  const slot = index % 9;
  const where = FACE_TITLE[face] + SLOT_NAME[slot];
  if (!color || color === "?") return where;
  return where + "（现为" + COLOR_NAME[color] + "）";
}

function pieceKey(colors) {
  return [...colors].sort().join("");
}

function formatPieceColors(colors) {
  return colors.map((c) => COLOR_NAME[c] || "?").join("+");
}

function describeStickers(indexes, facelets) {
  return indexes.map((i) => describeFacelet(i, facelets[i])).join("、");
}

/**
 * 找出不合法的角/棱，并标出展开图上应对的格子。
 * @returns {{ message: string|null, cells: number[] }}
 */
export function diagnoseFacelets(facelets) {
  const cells = [];
  const hints = [];

  const seenCorner = new Map();
  for (const idxs of CORNER_FACELETS) {
    const cols = idxs.map((i) => facelets[i]);
    if (cols.includes("?")) continue;
    const key = pieceKey(cols);
    if (!LEGAL_CORNERS.has(key)) {
      hints.push(
        "角块颜色「" +
          formatPieceColors(cols) +
          "」不存在，涉及：" +
          describeStickers(idxs, facelets),
      );
      cells.push(...idxs);
    } else if (seenCorner.has(key)) {
      const other = seenCorner.get(key);
      hints.push(
        "角块「" +
          formatPieceColors(cols) +
          "」出现两次，一处：" +
          describeStickers(idxs, facelets) +
          "；另一处：" +
          describeStickers(other, facelets),
      );
      cells.push(...idxs, ...other);
    } else {
      seenCorner.set(key, idxs);
    }
  }

  const seenEdge = new Map();
  for (const idxs of EDGE_FACELETS) {
    const cols = idxs.map((i) => facelets[i]);
    if (cols.includes("?")) continue;
    const key = pieceKey(cols);
    if (!LEGAL_EDGES.has(key)) {
      hints.push(
        "棱块颜色「" +
          formatPieceColors(cols) +
          "」不存在，涉及：" +
          describeStickers(idxs, facelets),
      );
      cells.push(...idxs);
    } else if (seenEdge.has(key)) {
      const other = seenEdge.get(key);
      hints.push(
        "棱块「" +
          formatPieceColors(cols) +
          "」出现两次，一处：" +
          describeStickers(idxs, facelets) +
          "；另一处：" +
          describeStickers(other, facelets),
      );
      cells.push(...idxs, ...other);
    } else {
      seenEdge.set(key, idxs);
    }
  }

  const uniq = [...new Set(cells)];
  if (hints.length) {
    return {
      message: hints.slice(0, 2).join("。") + "。请改展开图上标红的格后再求解",
      cells: uniq,
    };
  }
  return { message: null, cells: [] };
}

export function explainVerify(message, detail) {
  if (message === true) return null;
  if (detail && detail.message) return detail.message;
  if (message.includes("Corner twist")) {
    return "角块扭转不合法：某个角块的三面颜色可能填反了，请逐个核对白/黄相邻的角块";
  }
  if (message.includes("Edge flip")) {
    return "棱块翻转不合法：某条棱的两面颜色可能对调了，请核对白/黄边上的棱块";
  }
  if (message.includes("Parity")) {
    return "排列奇偶性不对，通常是两块位置对调了，请再核对相邻两面的颜色";
  }
  if (message.includes("corner") || message.includes("Corner")) {
    return "角块颜色组合不存在，请检查角块";
  }
  if (message.includes("edge") || message.includes("Edge")) {
    return "棱块颜色组合不存在，请检查棱块";
  }
  return "这个状态物理上不存在：" + message;
}

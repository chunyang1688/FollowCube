// 由 spike/phase0/turns.js 迁移：ESM -> CommonJS
// 保留转动定义与中文步骤文案，供 3D 跟做页与文字跟做页共用。
const FACES = {
  R: { axis: "x", layer: 1, quarter: -Math.PI / 2 },
  L: { axis: "x", layer: -1, quarter: Math.PI / 2 },
  U: { axis: "y", layer: 1, quarter: -Math.PI / 2 },
  D: { axis: "y", layer: -1, quarter: Math.PI / 2 },
  F: { axis: "z", layer: 1, quarter: -Math.PI / 2 },
  B: { axis: "z", layer: -1, quarter: Math.PI / 2 },
  M: { axis: "x", layer: 0, quarter: Math.PI / 2 },
  E: { axis: "y", layer: 0, quarter: Math.PI / 2 },
  S: { axis: "z", layer: 0, quarter: -Math.PI / 2 }
};

const FACE_CN = {
  U: "上面",
  D: "下面",
  R: "右面",
  L: "左面",
  F: "前面",
  B: "后面"
};

const SLICE_CN = {
  M: "左右中间层",
  E: "上下中间层",
  S: "前后中间层"
};

const SLICE_WITH = {
  M: "左面",
  E: "下面",
  S: "前面"
};

function parseMove(token) {
  const face = FACES[token[0]];
  if (!face) throw new Error("未知转动 " + token);
  const quarters = token.endsWith("2") ? 2 : token.endsWith("'") ? 3 : 1;
  return {
    token,
    axis: face.axis,
    layer: face.layer,
    quarter: face.quarter,
    quarters
  };
}

function invertToken(token) {
  if (token.endsWith("2")) return token;
  if (token.endsWith("'")) return token[0];
  return token[0] + "'";
}

// 半周照走，逆时针只转 90°，不把 270° 转满一圈。
function animationAngle(move) {
  if (move.quarters === 3) return -move.quarter;
  return move.quarter * move.quarters;
}

/** 例如 U' →「上面逆时针转 90°」。中间层没有朝外的一面，改说它跟哪一面同向。 */
function describeMove(token) {
  const slice = SLICE_CN[token[0]];
  if (slice) {
    if (token.endsWith("2")) return slice + "转 180°";
    const withFace = SLICE_WITH[token[0]];
    return token.endsWith("'") ? slice + "，与" + withFace + "反向" : slice + "，与" + withFace + "同向";
  }
  const face = FACE_CN[token[0]];
  if (!face) return token;
  if (token.endsWith("2")) return face + "转 180°";
  if (token.endsWith("'")) return face + "逆时针转 90°";
  return face + "顺时针转 90°";
}

module.exports = {
  FACES,
  parseMove,
  invertToken,
  animationAngle,
  describeMove
};

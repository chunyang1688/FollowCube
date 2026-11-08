// 从该面外侧看过去的顺时针 90°。右手系里，朝正方向的面用负角。
export const FACES = {
  R: { axis: "x", layer: 1, quarter: -Math.PI / 2 },
  L: { axis: "x", layer: -1, quarter: Math.PI / 2 },
  U: { axis: "y", layer: 1, quarter: -Math.PI / 2 },
  D: { axis: "y", layer: -1, quarter: Math.PI / 2 },
  F: { axis: "z", layer: 1, quarter: -Math.PI / 2 },
  B: { axis: "z", layer: -1, quarter: Math.PI / 2 },
};

const FACE_CN = {
  U: "上面",
  D: "下面",
  R: "右面",
  L: "左面",
  F: "前面",
  B: "后面",
};

export function parseMove(token) {
  const face = FACES[token[0]];
  if (!face) throw new Error("未知转动 " + token);
  const quarters = token.endsWith("2") ? 2 : token.endsWith("'") ? 3 : 1;
  return { token, axis: face.axis, layer: face.layer, quarter: face.quarter, quarters };
}

export function invertToken(token) {
  if (token.endsWith("2")) return token;
  if (token.endsWith("'")) return token[0];
  return token[0] + "'";
}

// 半周照走，逆时针只转 90°，不把 270° 转满一圈。
export function animationAngle(move) {
  if (move.quarters === 3) return -move.quarter;
  return move.quarter * move.quarters;
}

/** 例如 U' →「上面逆时针转 90°」 */
export function describeMove(token) {
  const face = FACE_CN[token[0]];
  if (!face) return token;
  if (token.endsWith("2")) return face + "转 180°";
  if (token.endsWith("'")) return face + "逆时针转 90°";
  return face + "顺时针转 90°";
}

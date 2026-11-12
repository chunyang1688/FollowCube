// 手动转层：手指往哪边拖，色块所在的那一层就往哪边转。
// 与小程序 packageFollow/utils/cube3d-core.js 的 turnToken 同一套规则。
// 外层、中间层、里层都靠色块在转轴上的坐标区分，不再只转被点中的那一面。

const FACE_OF_NORMAL = {
  "1,0,0": "R",
  "-1,0,0": "L",
  "0,1,0": "U",
  "0,-1,0": "D",
  "0,0,1": "F",
  "0,0,-1": "B",
};

const FACE_STEPS = {
  R: -1,
  L: 1,
  U: -1,
  D: 1,
  F: -1,
  B: 1,
};

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * 绕这一面朝外法向正转或反转，换成 R / R'。
 * positiveAroundOutward 为 true 时，右手拇指朝外。
 */
export function faceToken(normal, positiveAroundOutward) {
  const face = FACE_OF_NORMAL[normal[0] + "," + normal[1] + "," + normal[2]];
  if (!face) return null;
  const axisSign = normal[0] || normal[1] || normal[2];
  const worldPositive = positiveAroundOutward ? axisSign > 0 : axisSign < 0;
  const plainIsPositive = FACE_STEPS[face] > 0;
  return plainIsPositive === worldPositive ? face : face + "'";
}

const LAYER_FACE = {
  x: { 1: "R", 0: "M", "-1": "L" },
  y: { 1: "U", 0: "E", "-1": "D" },
  z: { 1: "F", 0: "S", "-1": "B" },
};

const PLAIN_WORLD_POSITIVE = {
  R: false, L: true, M: true,
  U: false, D: true, E: true,
  F: false, B: true, S: false,
};

/**
 * normal、pos、drag 都是世界坐标。拖动贴着法向、没有面上分量时返回 null。
 * 拖动方向选出转轴，色块在这条轴上的坐标决定外层、中间层还是里层。
 */
export function turnToken(normal, pos, drag) {
  const along = dot(normal, drag);
  const plane = [
    drag[0] - normal[0] * along,
    drag[1] - normal[1] * along,
    drag[2] - normal[2] * along,
  ];
  if (dot(plane, plane) < 1e-12) return null;
  const axisVec = cross(normal, plane);
  let axisIndex = 0;
  if (Math.abs(axisVec[1]) > Math.abs(axisVec[axisIndex])) axisIndex = 1;
  if (Math.abs(axisVec[2]) > Math.abs(axisVec[axisIndex])) axisIndex = 2;
  const axisName = axisIndex === 0 ? "x" : axisIndex === 1 ? "y" : "z";
  const layer = Math.round(pos[axisIndex]);
  const face = LAYER_FACE[axisName][layer];
  if (!face) return null;
  const axisUnit = [0, 0, 0];
  axisUnit[axisIndex] = 1;
  let ref = pos;
  const spin = cross(axisUnit, pos);
  if (dot(spin, spin) < 0.01) {
    ref = [pos[0] + normal[0], pos[1] + normal[1], pos[2] + normal[2]];
  }
  const worldPositive = dot(cross(axisUnit, ref), plane) >= 0;
  return PLAIN_WORLD_POSITIVE[face] === worldPositive ? face : face + "'";
}

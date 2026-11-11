// 手动转面：手指在世界上的拖动方向 → 被点中那一面的转动记号。
// 与小程序 packageFollow/utils/cube3d-core.js 的 turnToken 同一套规则，方便两边手感一致。

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

/**
 * normal、pos、drag 都是世界坐标。拖动没有长度时返回 null。
 * 点在面心时色块中心和法向平行，改用一条固定切线。
 */
export function turnToken(normal, pos, drag) {
  if (Math.hypot(drag[0], drag[1], drag[2]) < 1e-6) return null;
  let tangent = cross(normal, pos);
  if (dot(tangent, tangent) < 0.25) {
    const helper = Math.abs(normal[1]) < 0.5 ? [0, 1, 0] : [1, 0, 0];
    tangent = cross(normal, helper);
  }
  return faceToken(normal, dot(tangent, drag) >= 0);
}

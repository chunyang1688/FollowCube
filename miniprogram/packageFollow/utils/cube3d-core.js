// 纯数学魔方状态模型：不依赖 THREE / wx，可在 Node 中完整验证。
// 26 个可见 cubie，每个持有整数坐标 pos 与 3x3 整数旋转矩阵 ori（local 轴 -> world 轴）。
// 贴纸固定贴在 cubie 的 local 六个面上；转动 = 对整层做一次旋转矩阵左乘。
const { parseMove, invertToken, animationAngle } = require('../../utils/turns.js');
const { COLOR_ORDER, SOLVED } = require('../../utils/colors.js');

const AXIS_INDEX = { x: 0, y: 1, z: 2 };

// 绕各轴 +90° / -90° 的整数旋转矩阵（右手系，列向量）
const ROT = {
  x: {
    1: [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    '-1': [[1, 0, 0], [0, 0, 1], [0, -1, 0]]
  },
  y: {
    1: [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
    '-1': [[0, 0, -1], [0, 1, 0], [1, 0, 0]]
  },
  z: {
    1: [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    '-1': [[0, 1, 0], [-1, 0, 0], [0, 0, 1]]
  }
};

const LOCAL_DIR = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1]
];

// 每面 3x3 格 -> 该格所在 cubie 的世界坐标；normal 为该面朝外法向
const FACE_DEFS = {
  U: { normal: [0, 1, 0], at: (r, c) => [c - 1, 1, r - 1] },
  R: { normal: [1, 0, 0], at: (r, c) => [1, 1 - r, 1 - c] },
  F: { normal: [0, 0, 1], at: (r, c) => [c - 1, 1 - r, 1] },
  D: { normal: [0, -1, 0], at: (r, c) => [c - 1, -1, 1 - r] },
  L: { normal: [-1, 0, 0], at: (r, c) => [-1, 1 - r, c - 1] },
  B: { normal: [0, 0, -1], at: (r, c) => [1 - c, 1 - r, -1] }
};

function mul(A, B) {
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += A[i][k] * B[k][j];
      out[i][j] = s;
    }
  }
  return out;
}

function applyVec(M, v) {
  return [
    M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
    M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
    M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]
  ];
}

function identity() {
  return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
}

function makeCubies() {
  const cubies = [];
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        if (x === 0 && y === 0 && z === 0) continue; // 中心块不可见
        const home = [x, y, z];
        const stickers = [
          x === 1 ? 'R' : null,
          x === -1 ? 'L' : null,
          y === 1 ? 'U' : null,
          y === -1 ? 'D' : null,
          z === 1 ? 'F' : null,
          z === -1 ? 'B' : null
        ];
        cubies.push({ home, pos: home.slice(), ori: identity(), stickers });
      }
    }
  }
  return cubies;
}

/** token -> { axis, layer, steps }，steps 为 90° 的步数（带符号） */
function tokenToTurn(token) {
  const move = parseMove(token);
  const steps = Math.round(animationAngle(move) / (Math.PI / 2));
  return { axis: move.axis, layer: move.layer, steps };
}

function createModel() {
  let cubies = makeCubies();

  function rotateLayer(axis, sign, layer) {
    const R = ROT[axis][sign > 0 ? 1 : '-1'];
    const idx = AXIS_INDEX[axis];
    for (const cubie of cubies) {
      if (cubie.pos[idx] !== layer) continue;
      cubie.pos = applyVec(R, cubie.pos);
      cubie.ori = mul(R, cubie.ori);
    }
  }

  function applyTurn(turn) {
    const sign = turn.steps > 0 ? 1 : -1;
    const times = Math.abs(turn.steps);
    for (let i = 0; i < times; i++) rotateLayer(turn.axis, sign, turn.layer);
  }

  function applyToken(token) {
    applyTurn(tokenToTurn(token));
  }

  function reset() {
    cubies = makeCubies();
  }

  /** 由「还原序列」反推打乱态：solved 逆序执行每个 token 的逆操作 */
  function setScramble(solutionTokens) {
    reset();
    for (let i = solutionTokens.length - 1; i >= 0; i--) {
      applyToken(invertToken(solutionTokens[i]));
    }
    return getFacelets();
  }

  function getFacelets() {
    const out = [];
    for (const face of COLOR_ORDER) {
      const def = FACE_DEFS[face];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          const at = def.at(r, c);
          const cubie = cubies.find(
            (item) => item.pos[0] === at[0] && item.pos[1] === at[1] && item.pos[2] === at[2]
          );
          let color = '?';
          if (cubie) {
            let best = -Infinity;
            let bestIdx = -1;
            for (let i = 0; i < 6; i++) {
              const world = applyVec(cubie.ori, LOCAL_DIR[i]);
              const dot =
                world[0] * def.normal[0] +
                world[1] * def.normal[1] +
                world[2] * def.normal[2];
              if (dot > best) {
                best = dot;
                bestIdx = i;
              }
            }
            color = cubie.stickers[bestIdx] || '?';
          }
          out.push(color);
        }
      }
    }
    return out.join('');
  }

  return {
    reset,
    applyToken,
    applyTokens: (tokens) => tokens.forEach(applyToken),
    setScramble,
    getFacelets,
    isSolved: () => getFacelets() === SOLVED,
    cubies: () => cubies,
    layerOf: (token) => {
      const t = tokenToTurn(token);
      return (cubie) => cubie.pos[AXIS_INDEX[t.axis]] === t.layer;
    },
    turnOf: tokenToTurn
  };
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

const FACE_OF_NORMAL = {
  '1,0,0': 'R',
  '-1,0,0': 'L',
  '0,1,0': 'U',
  '0,-1,0': 'D',
  '0,0,1': 'F',
  '0,0,-1': 'B'
};

/**
 * 把「绕这一面朝外法向正转或反转」换成 R、R' 这样的记号。
 * positiveAroundOutward 为 true 时，右手拇指朝外。法向不是坐标轴时返回 null。
 */
function faceToken(normal, positiveAroundOutward) {
  const face = FACE_OF_NORMAL[normal[0] + ',' + normal[1] + ',' + normal[2]];
  if (!face) return null;
  const axisSign = normal[0] || normal[1] || normal[2];
  // 朝外的正转，换算成绕世界正轴的正转还是反转
  const worldPositive = positiveAroundOutward ? axisSign > 0 : axisSign < 0;
  const plainIsPositive = tokenToTurn(face).steps > 0;
  return plainIsPositive === worldPositive ? face : face + "'";
}

const LAYER_FACE = {
  x: { 1: 'R', 0: 'M', '-1': 'L' },
  y: { 1: 'U', 0: 'E', '-1': 'D' },
  z: { 1: 'F', 0: 'S', '-1': 'B' }
};

// 不带撇的记号是否绕世界正轴正转。中间层 M/E/S 分别与 L/D/F 同向。
const PLAIN_WORLD_POSITIVE = {
  R: false, L: true, M: true,
  U: false, D: true, E: true,
  F: false, B: true, S: false
};

/**
 * 按手指拖动，转动色块所在的那一层，让色块跟着走。
 * 点在面上时，拖动方向选出转轴，色块在这条轴上的坐标决定是外层、中间层还是里层。
 * normal、pos、drag 都是世界坐标。拖动贴着法向、没有面上分量时返回 null。
 */
function turnToken(normal, pos, drag) {
  const along = dot(normal, drag);
  const plane = [
    drag[0] - normal[0] * along,
    drag[1] - normal[1] * along,
    drag[2] - normal[2] * along
  ];
  if (dot(plane, plane) < 1e-12) return null;
  const axisVec = cross(normal, plane);
  let axisIndex = 0;
  if (Math.abs(axisVec[1]) > Math.abs(axisVec[axisIndex])) axisIndex = 1;
  if (Math.abs(axisVec[2]) > Math.abs(axisVec[axisIndex])) axisIndex = 2;
  const axisName = axisIndex === 0 ? 'x' : axisIndex === 1 ? 'y' : 'z';
  const layer = Math.round(pos[axisIndex]);
  const face = LAYER_FACE[axisName][layer];
  if (!face) return null;
  const axisUnit = [0, 0, 0];
  axisUnit[axisIndex] = 1;
  // 绕正轴正转时，这个色块往哪边动。色块正好在轴上时，用法向外侧一点做参照。
  let ref = pos;
  const spin = cross(axisUnit, pos);
  if (dot(spin, spin) < 0.01) {
    ref = [pos[0] + normal[0], pos[1] + normal[1], pos[2] + normal[2]];
  }
  const worldPositive = dot(cross(axisUnit, ref), plane) >= 0;
  return PLAIN_WORLD_POSITIVE[face] === worldPositive ? face : face + "'";
}

module.exports = {
  createModel,
  tokenToTurn,
  faceToken,
  turnToken,
  FACE_DEFS,
  LOCAL_DIR,
  ROT,
  mul,
  applyVec,
  identity
};

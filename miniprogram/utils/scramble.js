// 随机打乱生成器（主包）：从已还原态随机执行 N 步合法转动，生成一个「每次不同、
// 且必然可求解」的 54 位打乱字符串（顺序 U R F D L B，每面 9 格）。
//
// 为什么这样做：旧实现用固定常量 SCRAMBLED，导致「示例打乱」每次点都得到同一个
// 打乱态，体感上像随机乱填、且按钮无反馈。改成真随机打乱后，每次点击给出一个新的
// 合法打乱，供用户反复练习。
//
// 转动数学与 packageFollow/utils/cube3d-core.js 完全一致（同一套 ROT / FACE_DEFS），
// 因此生成的打乱态可被 3D 模型精确重建与还原，方向约定与 rubik-solver 一致。
const { parseMove, invertToken, animationAngle } = require('./turns.js');
const { COLOR_ORDER, SOLVED } = require('./colors.js');

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
        if (x === 0 && y === 0 && z === 0) continue;
        const pos = [x, y, z];
        const stickers = [
          x === 1 ? 'R' : null,
          x === -1 ? 'L' : null,
          y === 1 ? 'U' : null,
          y === -1 ? 'D' : null,
          z === 1 ? 'F' : null,
          z === -1 ? 'B' : null
        ];
        cubies.push({ pos, ori: identity(), stickers });
      }
    }
  }
  return cubies;
}

/** token -> { axis, layer, sign, times }，与 cube3d-core 的 tokenToTurn 一致 */
function tokenToTurn(token) {
  const move = parseMove(token);
  const steps = Math.round(animationAngle(move) / (Math.PI / 2));
  return { axis: move.axis, layer: move.layer, steps };
}

/** 对当前 cubies 状态执行一个转动（原地修改） */
function applyTurn(cubies, turn) {
  const sign = turn.steps > 0 ? 1 : -1;
  const times = Math.abs(turn.steps);
  const R = ROT[turn.axis][sign > 0 ? 1 : '-1'];
  const idx = AXIS_INDEX[turn.axis];
  for (let i = 0; i < times; i++) {
    for (const cubie of cubies) {
      if (cubie.pos[idx] !== turn.layer) continue;
      cubie.pos = applyVec(R, cubie.pos);
      cubie.ori = mul(R, cubie.ori);
    }
  }
}

/** 从 cubies 状态读取 54 位 facelets 字符串（顺序 U R F D L B） */
function readFacelets(cubies) {
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

// 六个面 + 三种转动（顺/逆/半周）的可选 token 集合
const MOVE_FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
const MOVE_SUFFIX = ['', "'", '2'];

/**
 * 生成一个随机合法打乱。
 * @param {number} [moveCount] 打乱步数，默认 22（约等于常见打乱长度）
 * @param {() => number} [rng] 可选随机源，便于自检注入固定种子；默认 Math.random
 * @returns {string} 54 位打乱字符串（顺序 U R F D L B）
 */
function randomScramble(moveCount = 22, rng = Math.random) {
  const cubies = makeCubies();
  const tokens = [];
  let prevFace = null;

  for (let i = 0; i < moveCount; i++) {
    // 避免连续转动同一面（相邻两步同面会退化，降低打乱质量）
    let face;
    do {
      face = MOVE_FACES[Math.floor(rng() * MOVE_FACES.length)];
    } while (face === prevFace);
    prevFace = face;
    const suffix = MOVE_SUFFIX[Math.floor(rng() * MOVE_SUFFIX.length)];
    const token = face + suffix;
    tokens.push(token);
    applyTurn(cubies, tokenToTurn(token));
  }

  return { state: readFacelets(cubies), tokens };
}

module.exports = {
  randomScramble,
  tokenToTurn,
  readFacelets,
  makeCubies,
  applyTurn,
  MOVE_FACES,
  MOVE_SUFFIX
};

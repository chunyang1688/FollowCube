import { Cube, initSolver, solve } from "rubik-solver";
import { SCRAMBLED } from "./state.js";
import { animationAngle, parseMove, invertToken } from "./turns.js";

const SOLVED = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";

function rot90(v, axis, q) {
  const [x, y, z] = v;
  if (axis === 0) return q === 1 ? [x, -z, y] : [x, z, -y];
  if (axis === 1) return q === 1 ? [z, y, -x] : [-z, y, x];
  return q === 1 ? [-y, x, z] : [y, -x, z];
}

const AXIS = { x: 0, y: 1, z: 2 };
const FACE_POS = {
  U: [0, 1, 0],
  D: [0, -1, 0],
  R: [1, 0, 0],
  L: [-1, 0, 0],
  F: [0, 0, 1],
  B: [0, 0, -1],
};
const ORDER = ["U", "R", "F", "D", "L", "B"];

function solvedCubies() {
  const cubies = [];
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        const colors = new Map();
        if (x === 1) colors.set("1,0,0", "R");
        if (x === -1) colors.set("-1,0,0", "L");
        if (y === 1) colors.set("0,1,0", "U");
        if (y === -1) colors.set("0,-1,0", "D");
        if (z === 1) colors.set("0,0,1", "F");
        if (z === -1) colors.set("0,0,-1", "B");
        cubies.push({ pos: [x, y, z], colors });
      }
    }
  }
  return cubies;
}

function applyToken(cubies, token) {
  const move = parseMove(token);
  const axis = AXIS[move.axis];
  const angle = animationAngle(move);
  const steps = Math.round(Math.abs(angle) / (Math.PI / 2));
  const q = angle < 0 ? -1 : 1;
  for (let n = 0; n < steps; n++) {
    for (const cubie of cubies) {
      if (cubie.pos[axis] !== move.layer) continue;
      const next = new Map();
      for (const [dir, color] of cubie.colors) {
        const turned = rot90(dir.split(",").map(Number), axis, q);
        next.set(turned.join(","), color);
      }
      cubie.colors = next;
      cubie.pos = rot90(cubie.pos, axis, q).map((value) => Math.round(value));
    }
  }
}

function faceIndex(face, x, y, z) {
  if (face === "U") return (z + 1) * 3 + (x + 1);
  if (face === "D") return (1 - z) * 3 + (x + 1);
  if (face === "R") return (1 - y) * 3 + (1 - z);
  if (face === "L") return (1 - y) * 3 + (z + 1);
  if (face === "F") return (1 - y) * 3 + (x + 1);
  return (1 - y) * 3 + (1 - x);
}

function asString(cubies) {
  const out = Array(54).fill("?");
  for (const cubie of cubies) {
    for (const [dir, color] of cubie.colors) {
      const parts = dir.split(",").map(Number);
      const face = ORDER.find((name) => FACE_POS[name].every((value, i) => value === parts[i]));
      const [x, y, z] = cubie.pos;
      out[ORDER.indexOf(face) * 9 + faceIndex(face, x, y, z)] = color;
    }
  }
  return out.join("");
}

const t0 = performance.now();
initSolver();
const initMs = performance.now() - t0;

for (const alg of ["R", "U", "F", "D", "L", "B", "R'", "U2"]) {
  const cubies = solvedCubies();
  for (const token of alg.split(" ")) applyToken(cubies, token);
  const expect = new Cube().move(alg).asString();
  if (asString(cubies) !== expect) throw new Error("转动方向和求解器不一致: " + alg);
}

const cube = Cube.fromString(SCRAMBLED);
const verdict = cube.verify();
if (verdict !== true) throw new Error("打乱状态不合法: " + verdict);

const solution = solve(cube);
if (!solution) throw new Error("求解失败");
const moves = solution.split(/\s+/).filter(Boolean);
if (moves.length < 15 || moves.length > 22) {
  throw new Error("步数不在 15–22: " + moves.length + " " + solution);
}

const check = Cube.fromString(SCRAMBLED);
check.move(solution);
if (!check.isSolved()) throw new Error("解法不能还原: " + solution);

const picture = solvedCubies();
for (const token of [...moves].reverse()) applyToken(picture, invertToken(token));
if (asString(picture) !== SCRAMBLED) throw new Error("逆解没有摆出打乱状态");
for (const token of moves) applyToken(picture, token);
if (asString(picture) !== SOLVED) throw new Error("按解法转完没有还原");

console.log(`ok  init ${initMs.toFixed(0)}ms  ${moves.length} moves  ${solution}`);

import {
  AmbientLight,
  BoxGeometry,
  DirectionalLight,
  Group,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { Cube } from "rubik-solver";
import {
  COLOR_HEX,
  COLOR_NAME,
  COLOR_ORDER,
  FACE_SLOTS,
  FACE_TITLE,
  KEY_TO_COLOR,
  NET_LAYOUT,
  PHOTO_STEPS,
  SOLVED,
  centersOk,
  countColors,
  countError,
  diagnoseFacelets,
  emptyFacelets,
  explainVerify,
  solvedFacelets,
} from "./colors.js";
import { turnToken } from "./gesture.js";
import { animationAngle, describeMove, invertToken, parseMove } from "./turns.js";
import {
  clampGuideRect,
  defaultPalette,
  detectFaceRect,
  drawFacePreview,
  guideCenter,
  loadImageFile,
  recognizeAtRect,
  rotateHandleLocal,
  rotatePoint,
  unrotatePoint,
} from "./vision.js";

const statusEl = document.querySelector("#status");
const stepEl = document.querySelector("#step");
const stepDescEl = document.querySelector("#step-desc");
const formulaEl = document.querySelector("#formula");
const guideEl = document.querySelector("#guide");
const successEl = document.querySelector("#success");
const countsEl = document.querySelector("#counts");
const paletteEl = document.querySelector("#palette");
const netEl = document.querySelector("#net");
const speedEl = document.querySelector("#speed");
const btnSolve = document.querySelector("#btn-solve");
const btnAuto = document.querySelector("#btn-auto");
const btnPrev = document.querySelector("#btn-prev");
const btnNext = document.querySelector("#btn-next");
const btnRestart = document.querySelector("#btn-restart");
const photoPanel = document.querySelector("#photo-panel");
const photoHint = document.querySelector("#photo-hint");
const photoOrderEl = document.querySelector("#photo-order");
const photoCanvas = document.querySelector("#photo-canvas");
const photoInput = document.querySelector("#photo-input");
const photoProgress = document.querySelector("#photo-progress");
const btnPhoto = document.querySelector("#btn-photo");
const btnPhotoShot = document.querySelector("#btn-photo-shot");
const btnPhotoConfirm = document.querySelector("#btn-photo-confirm");
const btnPhotoSmaller = document.querySelector("#btn-photo-smaller");
const btnPhotoBigger = document.querySelector("#btn-photo-bigger");
const photoSizeEl = document.querySelector("#photo-size");
const btnPhotoRotLeft = document.querySelector("#btn-photo-rot-left");
const btnPhotoRotRight = document.querySelector("#btn-photo-rot-right");
const btnPhotoRetake = document.querySelector("#btn-photo-retake");
const btnPhotoNext = document.querySelector("#btn-photo-next");
const btnPhotoCancel = document.querySelector("#btn-photo-cancel");

let brush = "R";
let facelets = solvedFacelets();
let activeFace = "U";
let slotIndex = 0; // FACE_SLOTS 里的下标
let errorCells = new Set(); // 求解失败时标红的格
let solverReady = false;
let tokens = [];
let pending = [];
let cursor = -1;
let phase = "edit"; // edit | ready | play | done
let screen = "home";
let solveMode = "follow";
let practiceMode = "free";
let demoQueue = null;
let cubeDirty = false;
let autoPlay = false;
let twist = null;
let moveDuration = 900;

const SPEED_MS = {
  slow: { next: 1100, auto: 1100 },
  medium: { next: 560, auto: 560 },
  fast: { next: 260, auto: 260 },
};
const FACE_FLOW = NET_LAYOUT.map((item) => item.face);

function currentSpeed() {
  return SPEED_MS[speedEl.value] || SPEED_MS.medium;
}

// ——— 填色展开图 ———

const PALETTE_KEYS = ["R", "L", "D", "U", "B", "F"];

/** 色板按红橙黄白蓝绿排列，和填色页的点选顺序一致。 */
function renderPalette() {
  paletteEl.replaceChildren();
  PALETTE_KEYS.forEach((color) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip" + (brush === color ? " on" : "");
    button.setAttribute("aria-label", COLOR_NAME[color]);
    const dot = document.createElement("i");
    dot.style.background = COLOR_HEX[color];
    const name = document.createElement("span");
    name.textContent = COLOR_NAME[color];
    button.append(dot, name);
    button.addEventListener("click", () => {
      brush = color;
      renderPalette();
    });
    paletteEl.append(button);
  });
}

/** 把还没填完、或颜色对不上的情况写到填色页顶部。 */
function renderCounts() {
  const problem = countError(facelets);
  const diag = diagnoseFacelets(facelets);
  let hint = "颜色齐了，点「还原」求出步骤";
  if (problem) {
    hint = problem.indexOf("没填") >= 0 ? problem + "，上下滑可以看背面" : problem;
  } else if (diag.message) {
    hint = "有格子对不上，转一转看标红的贴纸";
  }
  const paintHint = document.querySelector("#paint-hint");
  if (paintHint) paintHint.textContent = hint;
  countsEl.textContent = hint;
}

function selectFace(face, localSlot) {
  activeFace = face;
  if (localSlot != null && localSlot !== 4) {
    slotIndex = FACE_SLOTS.indexOf(localSlot);
    if (slotIndex < 0) slotIndex = 0;
  }
  renderNet();
  renderCounts();
}

function paintAt(index, color) {
  if (index % 9 === 4) return;
  brush = color;
  facelets[index] = color;
  invalidateSolution();
  renderPalette();
  renderNet();
  renderCounts();
}

function paintCell(index) {
  const faceIndex = Math.floor(index / 9);
  activeFace = COLOR_ORDER[faceIndex];
  slotIndex = FACE_SLOTS.indexOf(index % 9);
  if (slotIndex < 0) slotIndex = 0;
  paintAt(index, brush);
  advanceSlot();
  renderNet();
  renderCounts();
}

function advanceSlot() {
  slotIndex += 1;
  if (slotIndex < FACE_SLOTS.length) return;
  slotIndex = 0;
  const at = FACE_FLOW.indexOf(activeFace);
  activeFace = FACE_FLOW[(at + 1) % FACE_FLOW.length];
}

function fillByKey(color) {
  if (!activeFace) {
    statusEl.textContent = "先在填色页点一个面，再按 1–6 填色";
    return;
  }
  const faceIndex = COLOR_ORDER.indexOf(activeFace);
  const index = faceIndex * 9 + FACE_SLOTS[slotIndex];
  paintAt(index, color);
  advanceSlot();
  renderNet();
  renderCounts();
}

function renderNet() {
  netEl.replaceChildren();
  for (const item of NET_LAYOUT) {
    const face = document.createElement("div");
    face.className = "face" + (item.face === activeFace ? " active" : "");
    face.style.gridRow = String(item.row + 1);
    face.style.gridColumn = String(item.col + 1);
    face.tabIndex = 0;
    face.setAttribute("aria-label", FACE_TITLE[item.face]);
    face.addEventListener("click", (event) => {
      if (event.target.closest(".cell") && !event.target.classList.contains("center")) {
        return;
      }
      selectFace(item.face, FACE_SLOTS[0]);
      if (photoPanel.classList.contains("open")) {
        selectPhotoFace(COLOR_ORDER.indexOf(item.face), { force: true });
      }
    });
    const title = document.createElement("h2");
    title.textContent = FACE_TITLE[item.face];
    const grid = document.createElement("div");
    grid.className = "grid";
    const faceIndex = COLOR_ORDER.indexOf(item.face);
    const targetLocal =
      item.face === activeFace ? FACE_SLOTS[slotIndex] : -1;
    for (let i = 0; i < 9; i++) {
      const index = faceIndex * 9 + i;
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className =
        "cell" +
        (i === 4 ? " center" : "") +
        (i === targetLocal ? " target" : "") +
        (errorCells.has(index) ? " bad" : "");
      cell.style.background = COLOR_HEX[facelets[index]] || COLOR_HEX["?"];
      if (i !== 4) {
        cell.addEventListener("click", (event) => {
          event.stopPropagation();
          paintCell(index);
        });
      }
      grid.append(cell);
    }
    face.append(title, grid);
    netEl.append(face);
  }
  syncPaintCube();
}

function setFacelets(next) {
  facelets = next.slice();
  for (let i = 0; i < 6; i++) facelets[i * 9 + 4] = COLOR_ORDER[i];
  activeFace = "U";
  slotIndex = 0;
  invalidateSolution();
  renderNet();
  renderCounts();
}

document.addEventListener("keydown", (event) => {
  if (screen !== "paint") return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const tag = event.target && event.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  const color = KEY_TO_COLOR[event.key];
  if (!color) return;
  event.preventDefault();
  fillByKey(color);
});

// ——— 3D ———

const canvas = document.querySelector("#view");
const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0xfff6ea, 1);

const scene = new Scene();
const camera = new PerspectiveCamera(40, 1, 0.1, 100);
const orbitTarget = new Vector3(0, 0, 0);
const DEFAULT_CAM = { x: 4.2, y: 4.2, z: 6 };
const orbit = {
  radius: Math.hypot(DEFAULT_CAM.x, DEFAULT_CAM.y, DEFAULT_CAM.z),
  theta: Math.atan2(DEFAULT_CAM.x, DEFAULT_CAM.z),
  phi: Math.acos(DEFAULT_CAM.y / Math.hypot(DEFAULT_CAM.x, DEFAULT_CAM.y, DEFAULT_CAM.z)),
  dragging: false,
  moved: false,
  lx: 0,
  ly: 0,
};

function applyOrbitCamera() {
  const { radius, theta, phi } = orbit;
  camera.position.set(
    orbitTarget.x + radius * Math.sin(phi) * Math.sin(theta),
    orbitTarget.y + radius * Math.cos(phi),
    orbitTarget.z + radius * Math.sin(phi) * Math.cos(theta),
  );
  camera.lookAt(orbitTarget);
}

function resetOrbitCamera() {
  orbit.radius = Math.hypot(DEFAULT_CAM.x, DEFAULT_CAM.y, DEFAULT_CAM.z);
  orbit.theta = Math.atan2(DEFAULT_CAM.x, DEFAULT_CAM.z);
  orbit.phi = Math.acos(DEFAULT_CAM.y / orbit.radius);
  applyOrbitCamera();
}

resetOrbitCamera();
scene.add(new AmbientLight(0xffffff, 0.65));
const key = new DirectionalLight(0xffffff, 1.1);
key.position.set(3, 5, 4);
scene.add(key);

const COLORS3 = {
  U: 0xf5f5f5,
  D: 0xffd500,
  R: 0xb71234,
  L: 0xff6b1a,
  F: 0x009b48,
  B: 0x0046ad,
  X: 0x222222,
};
const geometry = new BoxGeometry(0.92, 0.92, 0.92);
const materials = {
  U: new MeshLambertMaterial({ color: COLORS3.U }),
  D: new MeshLambertMaterial({ color: COLORS3.D }),
  R: new MeshLambertMaterial({ color: COLORS3.R }),
  L: new MeshLambertMaterial({ color: COLORS3.L }),
  F: new MeshLambertMaterial({ color: COLORS3.F }),
  B: new MeshLambertMaterial({ color: COLORS3.B }),
  X: new MeshLambertMaterial({ color: COLORS3.X }),
};

const cubies = [];
for (let x = -1; x <= 1; x++) {
  for (let y = -1; y <= 1; y++) {
    for (let z = -1; z <= 1; z++) {
      const mesh = new Mesh(geometry, [
        x === 1 ? materials.R : materials.X,
        x === -1 ? materials.L : materials.X,
        y === 1 ? materials.U : materials.X,
        y === -1 ? materials.D : materials.X,
        z === 1 ? materials.F : materials.X,
        z === -1 ? materials.B : materials.X,
      ]);
      mesh.userData.home = { x, y, z };
      mesh.position.set(x, y, z);
      scene.add(mesh);
      cubies.push(mesh);
    }
  }
}

const pivot = new Group();
scene.add(pivot);
const snapMatrix = new Matrix4();

// ponytail: 矩阵元素取整到 -1/0/1，只对 90° 层转成立。
function snapCubie(cubie) {
  cubie.updateMatrix();
  snapMatrix.copy(cubie.matrix);
  const e = snapMatrix.elements;
  for (let i = 0; i < 15; i++) e[i] = Math.round(e[i]);
  e[15] = 1;
  cubie.quaternion.setFromRotationMatrix(snapMatrix);
  cubie.position.set(e[12], e[13], e[14]);
}

function resetSolvedPose() {
  if (twist) {
    for (const cubie of [...pivot.children]) scene.attach(cubie);
    pivot.rotation.set(0, 0, 0);
    twist = null;
  }
  for (const cubie of cubies) {
    const { x, y, z } = cubie.userData.home;
    cubie.position.set(x, y, z);
    cubie.quaternion.identity();
  }
}

function applyInstant(move) {
  const layer = cubies.filter((cubie) => Math.round(cubie.position[move.axis]) === move.layer);
  pivot.rotation.set(0, 0, 0);
  for (const cubie of layer) pivot.attach(cubie);
  pivot.rotation[move.axis] = animationAngle(move);
  for (const cubie of [...pivot.children]) {
    scene.attach(cubie);
    snapCubie(cubie);
  }
  pivot.rotation.set(0, 0, 0);
}

function startTwist(move, now) {
  const layer = cubies.filter((cubie) => Math.round(cubie.position[move.axis]) === move.layer);
  pivot.rotation.set(0, 0, 0);
  for (const cubie of layer) pivot.attach(cubie);
  twist = {
    axis: move.axis,
    angle: animationAngle(move),
    t0: now,
    dur: moveDuration,
  };
}

const FACE_DIR = [
  { axis: "x", at: 1, dir: new Vector3(1, 0, 0), mat: materials.R },
  { axis: "x", at: -1, dir: new Vector3(-1, 0, 0), mat: materials.L },
  { axis: "y", at: 1, dir: new Vector3(0, 1, 0), mat: materials.U },
  { axis: "y", at: -1, dir: new Vector3(0, -1, 0), mat: materials.D },
  { axis: "z", at: 1, dir: new Vector3(0, 0, 1), mat: materials.F },
  { axis: "z", at: -1, dir: new Vector3(0, 0, -1), mat: materials.B },
];
const LOCAL_DIR = [
  new Vector3(1, 0, 0),
  new Vector3(-1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, -1, 0),
  new Vector3(0, 0, 1),
  new Vector3(0, 0, -1),
];
const worldDir = new Vector3();

function materialFacing(cubie, dir) {
  let best = null;
  let bestDot = -Infinity;
  for (let i = 0; i < 6; i++) {
    worldDir.copy(LOCAL_DIR[i]).applyQuaternion(cubie.quaternion);
    const dot = worldDir.dot(dir);
    if (dot > bestDot) {
      bestDot = dot;
      best = cubie.material[i];
    }
  }
  return best;
}

const followRay = new Raycaster();
const followPointer = new Vector2();

/** 把射线打到的法向收成 ±1，避免浮点对不上六个面。 */
function snap3(v) {
  return [v.x, v.y, v.z].map((n) => (Math.abs(n) < 0.5 ? 0 : n > 0 ? 1 : -1));
}

/** 练一练：找到手指点中的那一块，返回世界法向和块心。点空返回 null。 */
function pickFollowFace(event) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  followPointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  followPointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  followRay.setFromCamera(followPointer, camera);
  const hits = followRay.intersectObjects(cubies, false);
  if (!hits.length || !hits[0].face) return null;
  const mesh = hits[0].object;
  const local = LOCAL_DIR[hits[0].face.materialIndex];
  if (!local) return null;
  worldDir.copy(local).applyQuaternion(mesh.quaternion);
  const normal = snap3(worldDir);
  if (normal.filter((n) => n !== 0).length !== 1) return null;
  return {
    normal,
    pos: [Math.round(mesh.position.x), Math.round(mesh.position.y), Math.round(mesh.position.z)],
  };
}

/** 屏幕拖动换成转动记号。dx 向右为正，dy 向下为正。太短则不转。 */
function turnFromFollowDrag(pick, dx, dy) {
  if (!pick || Math.hypot(dx, dy) < 24) return null;
  camera.updateMatrixWorld(true);
  const e = camera.matrixWorld.elements;
  const drag = [
    e[0] * dx - e[4] * dy,
    e[1] * dx - e[5] * dy,
    e[2] * dx - e[6] * dy,
  ];
  return turnToken(pick.normal, pick.pos, drag);
}

const CELL_AT = {
  U: (r, c) => [c - 1, 1, r - 1],
  R: (r, c) => [1, 1 - r, 1 - c],
  F: (r, c) => [c - 1, 1 - r, 1],
  D: (r, c) => [c - 1, -1, 1 - r],
  L: (r, c) => [-1, 1 - r, c - 1],
  B: (r, c) => [1 - c, 1 - r, -1],
};
const CELL_N = {
  U: new Vector3(0, 1, 0),
  R: new Vector3(1, 0, 0),
  F: new Vector3(0, 0, 1),
  D: new Vector3(0, -1, 0),
  L: new Vector3(-1, 0, 0),
  B: new Vector3(0, 0, -1),
};

/** 从跟做模型读出 54 色。练一练求解和示例打乱都靠它，不再使用固定打乱串。 */
function readCubeFacelets() {
  let out = "";
  for (const face of COLOR_ORDER) {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const [x, y, z] = CELL_AT[face](r, c);
        const cubie = cubies.find(
          (mesh) =>
            Math.round(mesh.position.x) === x &&
            Math.round(mesh.position.y) === y &&
            Math.round(mesh.position.z) === z,
        );
        if (!cubie) {
          out += "?";
          continue;
        }
        const mat = materialFacing(cubie, CELL_N[face]);
        const key = COLOR_ORDER.find((name) => materials[name] === mat);
        out += key || "?";
      }
    }
  }
  return out;
}

/** 随机合法转动。相邻两步不转同一面，避免打乱被抵消。 */
function randomMoveTokens(count) {
  const faces = ["U", "R", "F", "D", "L", "B"];
  const suffix = ["", "'", "2"];
  const out = [];
  let prev = "";
  for (let i = 0; i < count; i++) {
    let face = prev;
    while (face === prev) face = faces[Math.floor(Math.random() * faces.length)];
    prev = face;
    out.push(face + suffix[Math.floor(Math.random() * suffix.length)]);
  }
  return out;
}

function visualSolved() {
  for (const face of FACE_DIR) {
    for (const cubie of cubies) {
      if (Math.round(cubie.position[face.axis]) !== face.at) continue;
      if (materialFacing(cubie, face.dir) !== face.mat) return false;
    }
  }
  return true;
}

function resizeRenderer() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

let viewGesture = null;

/** 练一练里点在色块上是转这一面，点在空白处才转视角。跟做页始终转视角。 */
canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  const turning =
    screen === "practice" && practiceMode === "free" && !twist && !demoQueue;
  const pick = turning ? pickFollowFace(event) : null;
  viewGesture = {
    x: event.clientX,
    y: event.clientY,
    pick,
  };
  if (pick) {
    canvas.setPointerCapture(event.pointerId);
    return;
  }
  orbit.dragging = true;
  orbit.moved = false;
  orbit.lx = event.clientX;
  orbit.ly = event.clientY;
  canvas.classList.add("orbiting");
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (viewGesture && viewGesture.pick) return;
  if (!orbit.dragging) return;
  const dx = event.clientX - orbit.lx;
  const dy = event.clientY - orbit.ly;
  if (Math.abs(dx) + Math.abs(dy) > 2) orbit.moved = true;
  orbit.lx = event.clientX;
  orbit.ly = event.clientY;
  orbit.theta -= dx * 0.01;
  orbit.phi = Math.min(Math.PI - 0.08, Math.max(0.08, orbit.phi + dy * 0.01));
  applyOrbitCamera();
});
function endOrbitDrag(event) {
  const gesture = viewGesture;
  viewGesture = null;
  if (gesture && gesture.pick) {
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    const token = turnFromFollowDrag(gesture.pick, dx, dy);
    if (token) {
      moveDuration = 320;
      startTwist(parseMove(token), performance.now());
    }
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {
      // 指针已经松开时不必再释放
    }
    return;
  }
  if (!orbit.dragging) return;
  orbit.dragging = false;
  canvas.classList.remove("orbiting");
  try {
    canvas.releasePointerCapture(event.pointerId);
  } catch {
    // ignore
  }
}
canvas.addEventListener("pointerup", endOrbitDrag);
canvas.addEventListener("pointercancel", endOrbitDrag);
canvas.addEventListener("dblclick", () => {
  resetOrbitCamera();
});
canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    orbit.radius = Math.min(16, Math.max(4, orbit.radius * (event.deltaY > 0 ? 1.08 : 0.92)));
    applyOrbitCamera();
  },
  { passive: false },
);
document.querySelector("#btn-view-reset").addEventListener("click", () => {
  resetOrbitCamera();
});

// ——— 跟做状态 ———

function setControls() {
  const canFollow = phase === "ready" || phase === "play";
  const busy = Boolean(twist) || (phase === "play" && autoPlay);
  const canPrev =
    tokens.length > 0 &&
    cursor >= 0 &&
    !busy &&
    (phase === "ready" || phase === "play" || phase === "done");
  btnAuto.disabled = !(canFollow && pending.length && !busy);
  btnNext.disabled = !(canFollow && pending.length && !busy);
  btnPrev.disabled = !canPrev;
  btnRestart.disabled = !(
    tokens.length &&
    (phase === "ready" || phase === "play" || phase === "done")
  );
  btnSolve.disabled = !solverReady || Boolean(twist);
  setPracticeChrome();
  updateFollowTip();
}

function showStep(token, desc) {
  stepEl.textContent = token || "";
  stepDescEl.textContent = desc || "";
}

function renderFormula() {
  if (!tokens.length) {
    formulaEl.textContent = "";
    guideEl.replaceChildren();
    return;
  }
  const highlight =
    phase === "done"
      ? -1
      : phase === "play"
        ? cursor
        : pending.length
          ? cursor + 1
          : cursor;
  const doneCount = phase === "done" ? tokens.length : Math.max(0, cursor + 1);

  formulaEl.replaceChildren();
  tokens.forEach((token, index) => {
    const span = document.createElement("span");
    span.textContent = token + (index < tokens.length - 1 ? " " : "");
    if (index === highlight) span.className = "current";
    formulaEl.append(span);
  });
  formulaEl.append(document.createTextNode("\n" + doneCount + "/" + tokens.length + " 步"));

  guideEl.replaceChildren();
  tokens.forEach((token, index) => {
    const li = document.createElement("li");
    if (index === highlight) li.className = "current";
    else if (phase === "done" || index < highlight || (highlight < 0 && index <= cursor)) {
      li.className = "done";
    }
    const n = document.createElement("span");
    n.textContent = String(index + 1) + ".";
    const code = document.createElement("span");
    code.textContent = token;
    const text = document.createElement("span");
    text.textContent = describeMove(token);
    li.append(n, code, text);
    guideEl.append(li);
  });
  updatePracticeStep();
}

function hideSuccess() {
  successEl.classList.remove("show");
}

function showSuccess() {
  successEl.classList.add("show");
  statusEl.textContent = "还原完成";
  showStep("成功", "六个面颜色都对齐了");
  phase = "done";
  autoPlay = false;
  if (screen === "practice") {
    const hint = document.querySelector("#prac-hint");
    if (hint) hint.textContent = "还原完成";
    setPracticeChrome();
  }
  cursor = tokens.length - 1;
  pending = [];
  renderFormula();
  setControls();
}

function invalidateSolution() {
  tokens = [];
  pending = [];
  cursor = -1;
  phase = "edit";
  autoPlay = false;
  hideSuccess();
  showStep("", "");
  formulaEl.textContent = "";
  guideEl.replaceChildren();
  if (errorCells.size) {
    errorCells = new Set();
    renderNet();
  }
  if (solverReady) statusEl.textContent = "改色后需要重新求解";
  resetSolvedPose();
  setControls();
}

function poseScramble() {
  resetSolvedPose();
  for (const token of [...tokens].reverse()) applyInstant(parseMove(invertToken(token)));
  pending = tokens.map(parseMove);
  cursor = -1;
  phase = "ready";
  autoPlay = false;
  hideSuccess();
  statusEl.textContent =
    "已摆成你的魔方状态。看文字说明，点「下一步」跟着转；没看清可点「上一步」。";
  const first = tokens[0];
  showStep(first || "准备好了", first ? "下一步：" + describeMove(first) : "");
  renderFormula();
  setControls();
}

function finishMove() {
  if (demoQueue) {
    if (demoQueue.length) {
      const token = demoQueue.shift();
      startTwist(parseMove(token), performance.now());
      return;
    }
    demoQueue = null;
    const pracHint = document.querySelector("#prac-hint");
    if (pracHint) pracHint.textContent = "打乱好了。可以自己转回去，也可以点「还原」看步骤";
    return;
  }
  if (!pending.length) {
    if (screen === "practice" && practiceMode === "free") {
      const pracHint = document.querySelector("#prac-hint");
      if (visualSolved()) {
        if (pracHint) pracHint.textContent = "自己转回来了";
      } else if (pracHint) {
        pracHint.textContent = "滑动色块转这一面，滑动空白处换个角度看";
      }
      return;
    }
    if (visualSolved()) showSuccess();
    else {
      statusEl.textContent = "步骤播完了，但画面没有对齐，请点「从头再跟」";
      phase = "done";
      autoPlay = false;
      setControls();
    }
    return;
  }
  if (autoPlay) {
    phase = "play";
    setControls();
    return;
  }
  phase = "ready";
  const next = pending[0];
  statusEl.textContent =
    "请在实体魔方上完成：" + describeMove(tokens[cursor]) + "。看清后点「下一步」。";
  showStep(next.token, "下一步：" + describeMove(next.token));
  renderFormula();
  setControls();
}

function playOne(now) {
  if (!pending.length || twist) return;
  const move = pending.shift();
  cursor = tokens.length - pending.length - 1;
  phase = "play";
  const desc = describeMove(move.token);
  statusEl.textContent = autoPlay
    ? "自动还原 " + (cursor + 1) + "/" + tokens.length + " · " + desc
    : "跟做 " + (cursor + 1) + "/" + tokens.length + " · " + desc;
  showStep(move.token, desc);
  renderFormula();
  startTwist(move, now);
  setControls();
}

function stepBack() {
  if (twist || cursor < 0 || !tokens.length) return;
  autoPlay = false;
  hideSuccess();
  const token = tokens[cursor];
  applyInstant(parseMove(invertToken(token)));
  pending.unshift(parseMove(token));
  cursor -= 1;
  phase = "ready";
  statusEl.textContent = "已回到上一步。请重新看：" + describeMove(token);
  showStep(token, describeMove(token));
  renderFormula();
  setControls();
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

function frame(now) {
  resizeRenderer();
  if (twist) {
    const u = Math.min(1, (now - twist.t0) / twist.dur);
    pivot.rotation[twist.axis] = easeInOutCubic(u) * twist.angle;
    if (u >= 1) {
      pivot.rotation[twist.axis] = twist.angle;
      for (const cubie of [...pivot.children]) {
        scene.attach(cubie);
        snapCubie(cubie);
      }
      pivot.rotation.set(0, 0, 0);
      twist = null;
      finishMove();
    }
  } else if (autoPlay && phase === "play" && pending.length) {
    playOne(now);
  }
  renderer.render(scene, camera);
  paintTick();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// ——— 求解 Worker ———

const worker = new Worker("./worker.js", { type: "module" });

worker.onerror = (event) => {
  statusEl.textContent = "Worker 失败：" + (event.message || "未知错误");
  solverReady = false;
  setControls();
};

worker.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === "init-start") {
    statusEl.textContent = "求解器建表中…";
    return;
  }
  if (msg.type === "ready") {
    solverReady = true;
    statusEl.textContent = "求解器就绪（建表 " + msg.initMs.toFixed(0) + "ms）。填色后点求解。";
    setControls();
    return;
  }
  if (msg.type === "error") {
    const tip = explainVerify(msg.message) || msg.message;
    statusEl.textContent = tip;
    stepEl.textContent = "";
    phase = "edit";
    setControls();
    return;
  }
  if (msg.type !== "result") return;
  if (!msg.solved) {
    statusEl.textContent = "求出了公式，但回放校验失败";
    return;
  }
  tokens = msg.solution.split(/\s+/).filter(Boolean);
  statusEl.textContent = "求出 " + msg.moveCount + " 步，用时 " + msg.solveMs.toFixed(0) + "ms";
  poseScramble();
  cubeDirty = false;
  if (solveMode === "practice") {
    practiceMode = "guide";
    const pracHint = document.querySelector("#prac-hint");
    if (pracHint) pracHint.textContent = "看清这一步再转。速度可以随时换";
    setPracticeChrome();
    updatePracticeStep();
    showScreen("practice", { keepCube: true });
  } else {
    showScreen("follow");
  }
  updateFollowTip();
};

function requestSolve() {
  hideSuccess();
  const countTip = countError(facelets);
  if (countTip) {
    errorCells = new Set();
    renderNet();
    statusEl.textContent = countTip;
    return;
  }
  if (!centersOk(facelets)) {
    errorCells = new Set();
    renderNet();
    statusEl.textContent = "中心色被改坏了，请点「从已还原开始」重置";
    return;
  }
  const detail = diagnoseFacelets(facelets);
  errorCells = new Set(detail.cells);
  renderNet();
  const state = facelets.join("");
  try {
    const verdict = Cube.fromString(state).verify();
    const tip = explainVerify(verdict, detail);
    if (tip) {
      statusEl.textContent = tip;
      return;
    }
  } catch (err) {
    statusEl.textContent = detail.message || String(err.message || err);
    return;
  }
  errorCells = new Set();
  renderNet();
  if (state === SOLVED) {
    statusEl.textContent = "已经是还原状态";
    const hint = document.querySelector(solveMode === "practice" ? "#prac-hint" : "#paint-hint");
    if (hint) hint.textContent = "已经是还原状态";
    return;
  }
  statusEl.textContent = "求解中…";
  stepEl.textContent = "";
  btnSolve.disabled = true;
  worker.postMessage({ type: "solve", state });
}

// ——— 拍照填色（实验） ———

let photoIndex = 0;
let photoPalette = defaultPalette();
let photoPending = null; // 当前面识别结果，点「下一张」才锁定进度
let photoImage = null; // 当前待对齐的照片
let guideRect = null; // 可拖动的九宫格
let guideDrag = null; // { mode:'move'|'resize', corner, ox, oy, start }

function photoFace() {
  return PHOTO_STEPS[photoIndex].face;
}

function photoStep() {
  return PHOTO_STEPS[photoIndex];
}

function faceFullyFilled(face) {
  const base = COLOR_ORDER.indexOf(face) * 9;
  for (let i = 0; i < 9; i++) {
    if (i !== 4 && facelets[base + i] === "?") return false;
  }
  return true;
}

function nextUnfilledPhotoIndex(afterIndex) {
  for (let i = 1; i <= 6; i++) {
    const idx = (afterIndex + i) % 6;
    if (!faceFullyFilled(PHOTO_STEPS[idx].face)) return idx;
  }
  return -1;
}

function nextPhotoLabel() {
  const next = nextUnfilledPhotoIndex(photoIndex);
  if (next < 0) return "完成并关闭";
  const step = PHOTO_STEPS[next];
  if (faceFullyFilled(photoFace()) && next !== (photoIndex + 1) % 6) {
    return "去拍" + step.centerColor + "心";
  }
  return "下一张（去拍" + step.centerColor + "心）";
}

function clearPhotoStage() {
  photoPending = null;
  photoImage = null;
  guideRect = null;
  guideDrag = null;
  photoInput.value = "";
  const ctx = photoCanvas.getContext("2d");
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, photoCanvas.width, photoCanvas.height);
}

/** 点选某一面：单独重拍 / 补拍，不清空其它面。 */
function selectPhotoFace(index, opts = {}) {
  const next = Math.max(0, Math.min(5, index));
  const same = next === photoIndex;
  if (same && photoImage && !photoPending && !opts.force) return;
  photoIndex = next;
  clearPhotoStage();
  activeFace = photoFace();
  updatePhotoChrome();
  statusEl.textContent =
    "已选中【" +
    photoStep().centerColor +
    "心·" +
    photoStep().title +
    "】，点「拍照 / 选图」只改这一面";
}

function renderPhotoOrder() {
  photoOrderEl.replaceChildren();
  for (const step of PHOTO_STEPS) {
    const idx = step.step - 1;
    const item = document.createElement("button");
    item.type = "button";
    const filled = faceFullyFilled(step.face);
    const pendingHere = idx === photoIndex && photoPending;
    item.className =
      "shot" +
      (idx === photoIndex ? " current" : "") +
      (filled || pendingHere ? " done" : "");
    item.title = "点此单独拍/重拍 " + step.label;
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = COLOR_HEX[step.face];
    const text = document.createElement("span");
    text.textContent =
      step.label + (filled ? " ✓" : "") + (idx === photoIndex && !filled ? " ·选中" : "");
    item.append(dot, text);
    item.addEventListener("click", () => {
      selectPhotoFace(idx, { force: true });
    });
    photoOrderEl.append(item);
  }
}

function applyFaceColors(face, colors) {
  const base = COLOR_ORDER.indexOf(face) * 9;
  for (let i = 0; i < 9; i++) facelets[base + i] = i === 4 ? face : colors[i];
  invalidateSolution();
  activeFace = face;
  renderNet();
  renderCounts();
}

function clearFaceStickers(face) {
  const base = COLOR_ORDER.indexOf(face) * 9;
  for (let i = 0; i < 9; i++) facelets[base + i] = i === 4 ? face : "?";
  invalidateSolution();
  activeFace = face;
  renderNet();
  renderCounts();
}

function redrawGuide(showHandles = true) {
  if (!photoImage || !guideRect) return;
  drawFacePreview(photoCanvas, photoImage, guideRect, { handles: showHandles });
}

function canvasPoint(event) {
  const box = photoCanvas.getBoundingClientRect();
  return {
    x: ((event.clientX - box.left) / box.width) * photoCanvas.width,
    y: ((event.clientY - box.top) / box.height) * photoCanvas.height,
  };
}

function guideLocalPoint(p, rect) {
  const c = guideCenter(rect);
  return unrotatePoint(p.x, p.y, c.x, c.y, rect.angle || 0);
}

function hitGuideCorner(p, rect) {
  const local = guideLocalPoint(p, rect);
  const hs = Math.max(14, rect.w * 0.05);
  const corners = [
    { name: "tl", x: rect.x, y: rect.y },
    { name: "tr", x: rect.x + rect.w, y: rect.y },
    { name: "bl", x: rect.x, y: rect.y + rect.h },
    { name: "br", x: rect.x + rect.w, y: rect.y + rect.h },
  ];
  for (const corner of corners) {
    if (Math.abs(local.x - corner.x) <= hs && Math.abs(local.y - corner.y) <= hs) {
      return corner.name;
    }
  }
  return null;
}

function hitRotateHandle(p, rect) {
  const c = guideCenter(rect);
  const local = rotateHandleLocal(rect);
  const world = rotatePoint(local.x, local.y, c.x, c.y, rect.angle || 0);
  const dx = p.x - world.x;
  const dy = p.y - world.y;
  return dx * dx + dy * dy <= 20 * 20;
}

function syncSizeSlider() {
  if (!guideRect || !photoSizeEl) return;
  const pct = Math.round((guideRect.w / photoCanvas.width) * 100);
  photoSizeEl.value = String(Math.max(10, Math.min(98, pct)));
}

function setGuideSide(side) {
  if (!guideRect || !photoImage || photoPending) return;
  const cx = guideRect.x + guideRect.w / 2;
  const cy = guideRect.y + guideRect.h / 2;
  guideRect = clampGuideRect(
    {
      x: cx - side / 2,
      y: cy - side / 2,
      w: side,
      h: side,
      angle: guideRect.angle || 0,
    },
    photoCanvas.width,
  );
  syncSizeSlider();
  redrawGuide(true);
}

function scaleGuide(factor) {
  if (!guideRect) return;
  setGuideSide(guideRect.w * factor);
}

function nudgeGuideRotate(deltaRad) {
  if (!guideRect || !photoImage || photoPending) return;
  guideRect = clampGuideRect(
    { ...guideRect, angle: (guideRect.angle || 0) + deltaRad },
    photoCanvas.width,
  );
  syncSizeSlider();
  redrawGuide(true);
}

function updatePhotoChrome() {
  const step = photoStep();
  const aligning = Boolean(photoImage) && !photoPending;
  if (photoPending) {
    photoHint.textContent =
      "第 " +
      step.step +
      "/6 张【" +
      step.centerColor +
      "心】已识别，可点「" +
      nextPhotoLabel() +
      "」";
  } else if (aligning) {
    photoHint.textContent =
      "正在改【" +
      step.centerColor +
      "心】：拖黄框对齐后点「确认识别」。也可点上方其它面改拍。";
  } else {
    photoHint.textContent =
      "请拍【" +
      step.centerColor +
      "心】（" +
      step.title +
      "）。点上方清单可切换要改的面。";
  }
  photoProgress.textContent = photoPending
    ? "【" + step.centerColor + "心】已识别 → 「" + nextPhotoLabel() + "」或点其它面重拍"
    : aligning
      ? "对齐【" + step.centerColor + "心】后点「确认识别」"
      : "当前：第 " + step.step + "/6 · " + step.label;
  btnPhotoNext.textContent = nextPhotoLabel();
  btnPhotoConfirm.disabled = !aligning;
  btnPhotoSmaller.disabled = !aligning;
  btnPhotoBigger.disabled = !aligning;
  photoSizeEl.disabled = !aligning;
  btnPhotoRotLeft.disabled = !aligning;
  btnPhotoRotRight.disabled = !aligning;
  if (aligning) syncSizeSlider();
  btnPhotoRetake.disabled = !(photoImage || photoPending);
  btnPhotoNext.disabled = !photoPending;
  btnPhotoShot.disabled = false;
  activeFace = step.face;
  renderPhotoOrder();
  renderNet();
  renderCounts();
}

function openPhotoFlow() {
  photoPalette = defaultPalette();
  clearPhotoStage();
  const anyFilled = COLOR_ORDER.some((face) => faceFullyFilled(face));
  if (!anyFilled) {
    photoIndex = 0;
    setFacelets(emptyFacelets());
  } else {
    const prefer = COLOR_ORDER.indexOf(activeFace);
    const start = prefer >= 0 ? prefer : 0;
    const unfilled = faceFullyFilled(COLOR_ORDER[start])
      ? nextUnfilledPhotoIndex(start - 1)
      : start;
    photoIndex = unfilled >= 0 ? unfilled : start;
  }
  photoPanel.classList.add("open");
  updatePhotoChrome();
  statusEl.textContent = anyFilled
    ? "可点上方某一面单独重拍；不必六面重来"
    : "按①白②红③绿④黄⑤橙⑥蓝开拍；也可随时点清单跳到某一面";
}

function closePhotoFlow() {
  photoPanel.classList.remove("open");
  clearPhotoStage();
  if (screen === "camera") showScreen("paint");
}

async function handlePhotoFile(file) {
  if (!file) return;
  try {
    const img = await loadImageFile(file);
    photoImage = img;
    photoPending = null;
    paintAndInitGuide();
    statusEl.textContent =
      "已载入第 " +
      photoStep().step +
      "/6 张，请拖动黄框对准九个色块，再点「确认识别」";
    updatePhotoChrome();
  } catch (err) {
    statusEl.textContent = String(err.message || err);
  }
}

function paintAndInitGuide() {
  drawFacePreview(photoCanvas, photoImage, null, { handles: false });
  guideRect = clampGuideRect(detectFaceRect(photoCanvas), photoCanvas.width);
  // 自动框常偏小，默认再放大一点，方便用户微调
  const cx = guideRect.x + guideRect.w / 2;
  const cy = guideRect.y + guideRect.h / 2;
  const side = Math.min(photoCanvas.width * 0.9, guideRect.w * 1.12);
  guideRect = clampGuideRect(
    { x: cx - side / 2, y: cy - side / 2, w: side, h: side, angle: 0 },
    photoCanvas.width,
  );
  syncSizeSlider();
  redrawGuide(true);
}

function confirmPhotoRecognize() {
  if (!photoImage || !guideRect || photoPending) return;
  const face = photoFace();
  const result = recognizeAtRect(
    photoCanvas,
    photoImage,
    face,
    photoPalette,
    guideRect,
  );
  guideRect = result.rect;
  photoPalette = result.palette;
  photoPending = result;
  applyFaceColors(face, result.colors);
  const tips = [];
  if (result.centerMismatch) {
    tips.push(
      "中心色不太像" +
        COLOR_NAME[face] +
        "，可拖框重认或重拍；确认无拍也可下一张",
    );
  }
  if (result.uncertain) tips.push("有 " + result.uncertain + " 格不太确定，可手改");
  statusEl.textContent =
    "第 " +
    photoStep().step +
    "/6 张【" +
    photoStep().centerColor +
    "心】识别完成" +
    (tips.length ? "。" + tips.join("；") : "");
  updatePhotoChrome();
}

photoCanvas.addEventListener("pointerdown", (event) => {
  if (!photoImage || photoPending || !guideRect) return;
  const p = canvasPoint(event);
  const c = guideCenter(guideRect);
  if (hitRotateHandle(p, guideRect)) {
    event.preventDefault();
    photoCanvas.setPointerCapture(event.pointerId);
    photoCanvas.classList.add("dragging");
    guideDrag = {
      mode: "rotate",
      startAngle: guideRect.angle || 0,
      pointerAngle: Math.atan2(p.y - c.y, p.x - c.x),
      start: { ...guideRect },
    };
    return;
  }
  const corner = hitGuideCorner(p, guideRect);
  const local = guideLocalPoint(p, guideRect);
  const inside =
    local.x >= guideRect.x &&
    local.x <= guideRect.x + guideRect.w &&
    local.y >= guideRect.y &&
    local.y <= guideRect.y + guideRect.h;
  if (!corner && !inside) return;
  event.preventDefault();
  photoCanvas.setPointerCapture(event.pointerId);
  photoCanvas.classList.add("dragging");
  guideDrag = {
    mode: corner ? "resize" : "move",
    corner,
    ox: p.x,
    oy: p.y,
    start: { ...guideRect, angle: guideRect.angle || 0 },
  };
});

photoCanvas.addEventListener("pointermove", (event) => {
  if (!guideDrag || !guideRect) return;
  const p = canvasPoint(event);
  const s = guideDrag.start;
  const angle = s.angle || 0;
  if (guideDrag.mode === "rotate") {
    const c = guideCenter(s);
    const now = Math.atan2(p.y - c.y, p.x - c.x);
    guideRect = clampGuideRect(
      { ...s, angle: guideDrag.startAngle + (now - guideDrag.pointerAngle) },
      photoCanvas.width,
    );
    redrawGuide(true);
    return;
  }
  const dx = p.x - guideDrag.ox;
  const dy = p.y - guideDrag.oy;
  if (guideDrag.mode === "move") {
    guideRect = clampGuideRect(
      { x: s.x + dx, y: s.y + dy, w: s.w, h: s.h, angle },
      photoCanvas.width,
    );
  } else {
    // 在未旋转坐标系里缩放，再写回并保留 angle
    const localNow = unrotatePoint(p.x, p.y, s.x + s.w / 2, s.y + s.h / 2, angle);
    const localOrigin = unrotatePoint(
      guideDrag.ox,
      guideDrag.oy,
      s.x + s.w / 2,
      s.y + s.h / 2,
      angle,
    );
    const ldx = localNow.x - localOrigin.x;
    const ldy = localNow.y - localOrigin.y;
    let x1 = s.x;
    let y1 = s.y;
    let x2 = s.x + s.w;
    let y2 = s.y + s.h;
    if (guideDrag.corner.includes("l")) x1 = s.x + ldx;
    if (guideDrag.corner.includes("r")) x2 = s.x + s.w + ldx;
    if (guideDrag.corner.includes("t")) y1 = s.y + ldy;
    if (guideDrag.corner.includes("b")) y2 = s.y + s.h + ldy;
    const side = Math.max(48, Math.max(x2 - x1, y2 - y1));
    let next;
    if (guideDrag.corner === "br") next = { x: x1, y: y1, w: side, h: side, angle };
    else if (guideDrag.corner === "bl") next = { x: x2 - side, y: y1, w: side, h: side, angle };
    else if (guideDrag.corner === "tr") next = { x: x1, y: y2 - side, w: side, h: side, angle };
    else next = { x: x2 - side, y: y2 - side, w: side, h: side, angle };
    guideRect = clampGuideRect(next, photoCanvas.width);
    syncSizeSlider();
  }
  if (guideDrag.mode === "move") syncSizeSlider();
  redrawGuide(true);
});

function endGuideDrag(event) {
  if (!guideDrag) return;
  try {
    photoCanvas.releasePointerCapture(event.pointerId);
  } catch (_) {
    /* ignore */
  }
  photoCanvas.classList.remove("dragging");
  guideDrag = null;
}

photoCanvas.addEventListener("pointerup", endGuideDrag);
photoCanvas.addEventListener("pointercancel", endGuideDrag);

btnPhoto.addEventListener("click", () => {
  openPhotoFlow();
  showScreen("camera");
});
btnPhotoCancel.addEventListener("click", () => {
  closePhotoFlow();
  statusEl.textContent = "已取消拍照，可继续在立体魔方上改颜色";
});
btnPhotoShot.addEventListener("click", () => {
  photoInput.click();
});
photoInput.addEventListener("change", () => {
  const file = photoInput.files && photoInput.files[0];
  photoInput.value = "";
  handlePhotoFile(file);
});
btnPhotoConfirm.addEventListener("click", () => {
  confirmPhotoRecognize();
});
btnPhotoSmaller.addEventListener("click", () => {
  scaleGuide(0.88);
});
btnPhotoBigger.addEventListener("click", () => {
  scaleGuide(1.14);
});
photoSizeEl.addEventListener("input", () => {
  if (!guideRect || !photoImage || photoPending) return;
  const side = (Number(photoSizeEl.value) / 100) * photoCanvas.width;
  setGuideSide(side);
});
btnPhotoRotLeft.addEventListener("click", () => {
  nudgeGuideRotate(-Math.PI / 36); // 5°
});
btnPhotoRotRight.addEventListener("click", () => {
  nudgeGuideRotate(Math.PI / 36);
});
btnPhotoRetake.addEventListener("click", () => {
  clearFaceStickers(photoFace());
  clearPhotoStage();
  updatePhotoChrome();
  statusEl.textContent =
    "已清空【" + photoStep().centerColor + "心】，请重新拍照 / 选图";
});
btnPhotoNext.addEventListener("click", () => {
  if (!photoPending) return;
  const next = nextUnfilledPhotoIndex(photoIndex);
  clearPhotoStage();
  if (next < 0) {
    closePhotoFlow();
    const unsure = countColors(facelets)["?"] || 0;
    statusEl.textContent = unsure
      ? "六面识别完成，还有 " + unsure + " 格不确定，请点灰格手改后再求解"
      : "六面识别完成，已填进立体魔方。转一转核对后再点还原";
    return;
  }
  photoIndex = next;
  updatePhotoChrome();
  statusEl.textContent =
    "请拍【" +
    photoStep().centerColor +
    "心】（" +
    photoStep().title +
    "），或点上方清单改选其它面";
});

document.querySelector("#btn-solved").addEventListener("click", () => {
  closePhotoFlow();
  setFacelets(solvedFacelets());
  statusEl.textContent = "已填入还原色，可直接改乱的格子";
});
document.querySelector("#btn-clear").addEventListener("click", () => {
  closePhotoFlow();
  setFacelets(emptyFacelets());
  statusEl.textContent = "已清空，中心色保留，请填其余 48 格";
});
document.querySelector("#btn-sample").addEventListener("click", () => {
  if (twist) return;
  resetSolvedPose();
  for (const token of randomMoveTokens(22)) applyInstant(parseMove(token));
  const state = readCubeFacelets();
  resetSolvedPose();
  setFacelets(state.split(""));
  statusEl.textContent = "已填入示例打乱，可直接点还原";
});
btnSolve.addEventListener("click", () => {
  solveMode = "follow";
  requestSolve();
});

btnAuto.addEventListener("click", () => {
  if (!pending.length || twist) return;
  autoPlay = true;
  moveDuration = currentSpeed().auto;
  phase = "play";
  statusEl.textContent = "自动还原中…";
  setControls();
  playOne(performance.now());
});

btnPrev.addEventListener("click", () => {
  stepBack();
});

btnNext.addEventListener("click", () => {
  if (!pending.length || twist || autoPlay) return;
  moveDuration = currentSpeed().next;
  playOne(performance.now());
});

btnRestart.addEventListener("click", () => {
  if (!tokens.length) return;
  poseScramble();
});

speedEl.addEventListener("change", () => {
  if (!twist) moveDuration = currentSpeed().next;
});

const paintCanvas = document.querySelector("#paint-view");
const paintRenderer = new WebGLRenderer({ canvas: paintCanvas, antialias: true });
paintRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
paintRenderer.setClearColor(0xfff6ea, 1);
const paintScene = new Scene();
const paintCamera = new PerspectiveCamera(38, 1, 0.1, 100);
paintScene.add(new AmbientLight(0xffffff, 0.85));
const paintLight = new DirectionalLight(0xffffff, 0.55);
paintLight.position.set(4, 6, 5);
paintScene.add(paintLight);
const paintGeo = new BoxGeometry(0.9, 0.9, 0.9);
const paintPieces = [];
for (let x = -1; x <= 1; x++) {
  for (let y = -1; y <= 1; y++) {
    for (let z = -1; z <= 1; z++) {
      if (x === 0 && y === 0 && z === 0) continue;
      const mats = LOCAL_DIR.map(() => new MeshLambertMaterial({ color: 0xe4ddd4 }));
      const mesh = new Mesh(paintGeo, mats);
      mesh.position.set(x, y, z);
      mesh.userData.pos = [x, y, z];
      paintScene.add(mesh);
      paintPieces.push(mesh);
    }
  }
}
const paintRay = new Raycaster();
const paintPointer = new Vector2();
const PAINT_UP = Math.acos(1 / Math.sqrt(3));
let paintTheta = Math.PI / 4;
let paintPhi = PAINT_UP;
let paintAnim = null;
let paintGesture = null;

/** 填色魔方每次只停在看得到三个面的角上，避免斜看时点不准。 */
function applyPaintCamera() {
  const radius = 7.4;
  paintCamera.position.set(
    radius * Math.sin(paintPhi) * Math.sin(paintTheta),
    radius * Math.cos(paintPhi),
    radius * Math.sin(paintPhi) * Math.cos(paintTheta),
  );
  paintCamera.lookAt(0, 0, 0);
  const seeing = document.querySelector("#paint-seeing");
  if (!seeing) return;
  const x = Math.sin(paintPhi) * Math.sin(paintTheta);
  const y = Math.cos(paintPhi);
  const z = Math.sin(paintPhi) * Math.cos(paintTheta);
  seeing.textContent =
    "正在看 " +
    [y >= 0 ? "上面" : "下面", z >= 0 ? "前面" : "后面", x >= 0 ? "右面" : "左面"].join(" · ");
}

function resizePaint() {
  const width = paintCanvas.clientWidth;
  const height = paintCanvas.clientHeight;
  if (!width || !height) return;
  paintRenderer.setSize(width, height, false);
  paintCamera.aspect = width / height;
  paintCamera.updateProjectionMatrix();
}

function paintColorHex(key) {
  if (key === "U") return 0xf5f5f5;
  if (key === "D") return 0xffd500;
  if (key === "R") return 0xb71234;
  if (key === "L") return 0xff6b1a;
  if (key === "F") return 0x009b48;
  if (key === "B") return 0x0046ad;
  return 0xe4ddd4;
}

/** 按 54 格给填色魔方上色，不合法的格子加一点红。展开图仍隐藏，只给旧逻辑用。 */
function syncPaintCube() {
  if (!paintPieces.length) return;
  COLOR_ORDER.forEach((face, faceIndex) => {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const gi = faceIndex * 9 + r * 3 + c;
        const pos = CELL_AT[face](r, c);
        const mesh = paintPieces.find(
          (item) => item.userData.pos[0] === pos[0] && item.userData.pos[1] === pos[1] && item.userData.pos[2] === pos[2],
        );
        if (!mesh) continue;
        const normal = CELL_N[face];
        const matIndex = LOCAL_DIR.findIndex(
          (dir) => dir.x === normal.x && dir.y === normal.y && dir.z === normal.z,
        );
        if (matIndex < 0) continue;
        mesh.material[matIndex].color.setHex(paintColorHex(facelets[gi]));
        mesh.material[matIndex].emissive.setHex(errorCells.has(gi) ? 0x662222 : 0x000000);
      }
    }
  });
}

function paintTick() {
  if (!paintCanvas.clientWidth) return;
  if (paintAnim) {
    const u = Math.min(1, (performance.now() - paintAnim.t0) / 260);
    const k = u < 0.5 ? 4 * u * u * u : 1 - ((-2 * u + 2) ** 3) / 2;
    paintTheta = paintAnim.theta + (paintAnim.toTheta - paintAnim.theta) * k;
    paintPhi = paintAnim.phi + (paintAnim.toPhi - paintAnim.phi) * k;
    if (u >= 1) paintAnim = null;
  }
  resizePaint();
  applyPaintCamera();
  paintRenderer.render(paintScene, paintCamera);
}

function paintTurn(dir) {
  if (paintAnim) return;
  paintAnim = {
    theta: paintTheta,
    phi: paintPhi,
    toTheta: paintTheta + dir * (Math.PI / 2),
    toPhi: paintPhi,
    t0: performance.now(),
  };
}

function paintFlip() {
  if (paintAnim) return;
  paintAnim = {
    theta: paintTheta,
    phi: paintPhi,
    toTheta: paintTheta,
    toPhi: Math.abs(paintPhi - PAINT_UP) < 0.01 ? Math.PI - PAINT_UP : PAINT_UP,
    t0: performance.now(),
  };
}

/** 点在贴纸上就填当前颜色。中心色固定，用来认面。 */
function paintAtPointer(event) {
  const rect = paintCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height || paintAnim) return;
  paintPointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  paintPointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  paintRay.setFromCamera(paintPointer, paintCamera);
  const hits = paintRay.intersectObjects(paintPieces, false);
  if (!hits.length || !hits[0].face) return;
  const mesh = hits[0].object;
  const local = LOCAL_DIR[hits[0].face.materialIndex];
  if (!local) return;
  const pos = mesh.userData.pos;
  let face = "";
  COLOR_ORDER.forEach((name) => {
    const normal = CELL_N[name];
    if (normal.x === local.x && normal.y === local.y && normal.z === local.z) face = name;
  });
  if (!face) return;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const at = CELL_AT[face](r, c);
      if (at[0] !== pos[0] || at[1] !== pos[1] || at[2] !== pos[2]) continue;
      if (r === 1 && c === 1) {
        statusEl.textContent = "中心色固定";
        return;
      }
      const gi = COLOR_ORDER.indexOf(face) * 9 + r * 3 + c;
      facelets[gi] = brush;
      invalidateSolution();
      renderNet();
      renderCounts();
      return;
    }
  }
}

paintCanvas.addEventListener("pointerdown", (event) => {
  paintGesture = { x: event.clientX, y: event.clientY, moved: false };
  paintCanvas.setPointerCapture(event.pointerId);
});
paintCanvas.addEventListener("pointermove", (event) => {
  if (!paintGesture) return;
  if (Math.abs(event.clientX - paintGesture.x) > 14 || Math.abs(event.clientY - paintGesture.y) > 14) {
    paintGesture.moved = true;
  }
});
paintCanvas.addEventListener("pointerup", (event) => {
  const start = paintGesture;
  paintGesture = null;
  if (!start) return;
  const dx = event.clientX - start.x;
  const dy = event.clientY - start.y;
  if (!start.moved) {
    paintAtPointer(event);
    return;
  }
  if (Math.abs(dx) > Math.abs(dy)) paintTurn(dx > 0 ? 1 : -1);
  else paintFlip();
});

/** 切换四个主页面。练一练默认从还原好的魔方开始；跟着转没有步骤时留在首页。 */
function showScreen(name, opts = {}) {
  if (name === "follow") {
    if (!tokens.length) {
      updateFollowTip();
      return;
    }
    if (cubeDirty) {
      poseScramble();
      cubeDirty = false;
    }
  }
  if (name === "practice" && !opts.keepCube) enterPractice();
  screen = name;
  document.querySelectorAll(".screen").forEach((el) => {
    el.classList.toggle("active", el.dataset.screen === name);
  });
  if (name === "practice") document.querySelector("#practice-stage").appendChild(canvas);
  if (name === "follow") document.querySelector("#follow-stage").appendChild(canvas);
  const host = document.querySelector("#screen-" + name + " .status-host");
  if (host) host.appendChild(statusEl);
}

/** 打开练一练时把模型收回还原态。原来的跟做步骤先留着，回到跟着转时再摆回去。 */
function enterPractice() {
  autoPlay = false;
  demoQueue = null;
  practiceMode = "free";
  resetSolvedPose();
  cubeDirty = true;
  setPracticeChrome();
  const hint = document.querySelector("#prac-hint");
  if (hint) hint.textContent = "这是还原好的魔方。滑动色块转这一面，滑动空白处换个角度看";
}

function updateFollowTip() {
  const tip = document.querySelector("#follow-tip");
  if (!tip) return;
  tip.textContent = tokens.length
    ? "已有 " + tokens.length + " 步，点这里一步步转"
    : "先填色或拍照，求出步骤后再来";
}

function updatePracticeStep() {
  const el = document.querySelector("#prac-step");
  if (!el) return;
  if (practiceMode !== "guide" || !tokens.length) {
    el.textContent = "";
    return;
  }
  if (!pending.length) {
    el.textContent = "已经还原";
    return;
  }
  const index = tokens.length - pending.length + 1;
  el.textContent = "第 " + index + " / " + tokens.length + " 步 · " + describeMove(pending[0].token);
}

function setPracticeChrome() {
  const free = document.querySelector("#prac-free");
  const guide = document.querySelector("#prac-guide");
  if (free) free.hidden = practiceMode === "guide";
  if (guide) guide.hidden = practiceMode !== "guide";
  const autoBtn = document.querySelector("#prac-auto");
  if (autoBtn) autoBtn.textContent = autoPlay ? "停止" : "自动";
  const prev = document.querySelector("#prac-prev");
  const next = document.querySelector("#prac-next");
  if (prev) prev.disabled = cursor < 0 || Boolean(twist) || autoPlay;
  if (next) next.disabled = !pending.length || Boolean(twist) || autoPlay;
}

function leavePracticeGuide() {
  autoPlay = false;
  practiceMode = "free";
  pending = [];
  cursor = -1;
  phase = "edit";
  setPracticeChrome();
  const hint = document.querySelector("#prac-hint");
  if (hint) {
    hint.textContent = visualSolved()
      ? "已经还原。可以再随机打乱，或自己转着玩"
      : "滑动色块转这一面，滑动空白处换个角度看";
  }
}

document.querySelector("#prac-scramble").addEventListener("click", () => {
  if (twist || demoQueue) return;
  resetSolvedPose();
  cubeDirty = true;
  const moves = randomMoveTokens(15);
  demoQueue = moves.slice(1);
  moveDuration = 150;
  const hint = document.querySelector("#prac-hint");
  if (hint) hint.textContent = "正在打乱…";
  startTwist(parseMove(moves[0]), performance.now());
});
document.querySelector("#prac-solve").addEventListener("click", () => {
  if (twist || demoQueue) return;
  solveMode = "practice";
  facelets = readCubeFacelets().split("");
  requestSolve();
});
document.querySelector("#prac-prev").addEventListener("click", stepBack);
document.querySelector("#prac-next").addEventListener("click", () => {
  if (!pending.length || twist || autoPlay) return;
  moveDuration = currentSpeed().next;
  playOne(performance.now());
});
document.querySelector("#prac-back").addEventListener("click", leavePracticeGuide);
document.querySelector("#prac-auto").addEventListener("click", () => {
  if (autoPlay) {
    autoPlay = false;
    setPracticeChrome();
    return;
  }
  if (!pending.length || twist) return;
  autoPlay = true;
  moveDuration = currentSpeed().auto;
  phase = "play";
  setPracticeChrome();
  playOne(performance.now());
});

document.body.addEventListener("click", (event) => {
  const speedBtn = event.target.closest("button[data-speed]");
  if (speedBtn) {
    speedEl.value = speedBtn.dataset.speed;
    document.querySelectorAll("button[data-speed]").forEach((btn) => {
      btn.classList.toggle("on", btn.dataset.speed === speedEl.value);
    });
    if (!twist) moveDuration = currentSpeed().next;
    return;
  }
  const go = event.target.closest("[data-go]");
  if (!go) return;
  const dest = go.dataset.go;
  if (dest === "camera") {
    openPhotoFlow();
    showScreen("camera");
    return;
  }
  showScreen(dest);
});

applyPaintCamera();
renderPalette();
setFacelets(emptyFacelets());
setControls();
statusEl.textContent = "求解器准备中…";
showScreen("home");

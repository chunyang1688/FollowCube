import { Cube, initSolver, solve } from "./node_modules/rubik-solver/dist/index.mjs";

let ready = false;
let initMs = 0;

function fail(message) {
  postMessage({ type: "error", message });
}

function handleSolve(state) {
  if (!ready) {
    fail("求解器还没准备好");
    return;
  }
  try {
    if (typeof state !== "string" || state.length !== 54) {
      fail("颜色状态必须是 54 个格子");
      return;
    }
    const cube = Cube.fromString(state);
    const verdict = cube.verify();
    if (verdict !== true) {
      fail(verdict);
      return;
    }
    const t1 = performance.now();
    const solution = solve(cube);
    const solveMs = performance.now() - t1;
    if (!solution) {
      fail("在限定步数内没有找到解法");
      return;
    }
    const check = Cube.fromString(state);
    check.move(solution);
    const moves = solution.split(/\s+/).filter(Boolean);
    postMessage({
      type: "result",
      state,
      solution,
      moveCount: moves.length,
      solved: check.isSolved(),
      initMs,
      solveMs,
    });
  } catch (err) {
    fail(String(err && err.message ? err.message : err));
  }
}

try {
  postMessage({ type: "init-start" });
  const t0 = performance.now();
  initSolver();
  initMs = performance.now() - t0;
  ready = true;
  postMessage({ type: "ready", initMs });
} catch (err) {
  fail(String(err && err.message ? err.message : err));
}

onmessage = (event) => {
  const msg = event.data || {};
  if (msg.type === "solve") handleSolve(msg.state);
};

// 3D 渲染层：把 cube3d-core 的整数状态画到 <canvas type="webgl">。
// 依赖 vendor 的 threejs-miniprogram（CommonJS 产物，已放进分包，无需「构建 npm」）。
// 状态真值始终在 core；本层只负责按状态摆 26 个 cubie，并在层转时叠加临时旋转。
const { createScopedThreejs } = require('../vendor/threejs-miniprogram/index.js');
const { createModel, tokenToTurn, applyVec, LOCAL_DIR, turnToken } = require('./cube3d-core.js');
const { invertToken } = require('../../utils/turns.js');

const COLORS3 = {
  U: 0xf5f5f5,
  D: 0xffd500,
  R: 0xb71234,
  L: 0xff6b1a,
  F: 0x009b48,
  B: 0x0046ad,
  X: 0x242424
};
const AXIS_VEC = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const AXIS_INDEX = { x: 0, y: 1, z: 2 };
const DEFAULT_CAM = [4.2, 4.2, 6];

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function makeRaf(canvas) {
  if (canvas && typeof canvas.requestAnimationFrame === 'function') {
    return {
      schedule: (cb) => canvas.requestAnimationFrame(cb),
      cancel: (id) => {
        if (typeof canvas.cancelAnimationFrame === 'function') canvas.cancelAnimationFrame(id);
      }
    };
  }
  return {
    schedule: (cb) => setTimeout(() => cb(Date.now()), 16),
    cancel: (id) => clearTimeout(id)
  };
}

/**
 * @param {{canvas:object,width:number,height:number,pixelRatio?:number,moveDuration?:number}} opts
 * @returns {object|null} 初始化失败返回 null，由页面降级到文字跟做
 */
function createCubeScene(opts) {
  const canvas = opts.canvas;
  const pixelRatio = Math.min(opts.pixelRatio || 1, 2);
  const pxW = Math.max(1, Math.round(opts.width * pixelRatio));
  const pxH = Math.max(1, Math.round(opts.height * pixelRatio));

  let THREE;
  let renderer;
  try {
    THREE = createScopedThreejs(canvas);
    canvas.width = pxW;
    canvas.height = pxH;
    // 部分机型开抗锯齿会创建上下文失败，退回关闭后再试一次
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch (err) {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    }
    renderer.setPixelRatio(1); // 像素尺寸已经乘过 dpr，这里避免二次放大
    renderer.setSize(pxW, pxH, false);
    renderer.setClearColor(0xfff6ea, 1);
  } catch (err) {
    return null;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, pxW / pxH, 0.1, 100);
  const orbit = {
    radius: Math.hypot(DEFAULT_CAM[0], DEFAULT_CAM[1], DEFAULT_CAM[2]),
    theta: Math.atan2(DEFAULT_CAM[0], DEFAULT_CAM[2]),
    phi: Math.acos(DEFAULT_CAM[1] / Math.hypot(DEFAULT_CAM[0], DEFAULT_CAM[1], DEFAULT_CAM[2]))
  };

  function applyCamera() {
    camera.position.set(
      orbit.radius * Math.sin(orbit.phi) * Math.sin(orbit.theta),
      orbit.radius * Math.cos(orbit.phi),
      orbit.radius * Math.sin(orbit.phi) * Math.cos(orbit.theta)
    );
    camera.lookAt(0, 0, 0);
  }
  applyCamera();

  scene.add(new THREE.AmbientLight(0xffffff, 0.72));
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(3, 5, 4);
  scene.add(key);

  const Box = THREE.BoxBufferGeometry || THREE.BoxGeometry;
  const geometry = new Box(0.92, 0.92, 0.92);
  const materialCache = {};
  Object.keys(COLORS3).forEach((name) => {
    materialCache[name] = new THREE.MeshLambertMaterial({ color: COLORS3[name] });
  });

  const model = createModel();
  const cubies = model.cubies();
  const meshes = cubies.map((cubie, index) => {
    // BoxGeometry 材质组顺序：+x -x +y -y +z -z，与 core 的 LOCAL_DIR 一致
    const mats = cubie.stickers.map((color) =>
      materialCache[color || 'X']
    );
    const mesh = new THREE.Mesh(geometry, mats);
    mesh.userData.cubieIndex = index;
    scene.add(mesh);
    return mesh;
  });

  const raf = makeRaf(canvas);
  let rafId = null;
  let twist = null;
  let disposed = false;
  let moveDuration = opts.moveDuration || 480;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const tmpM = new THREE.Matrix4();
  const rotM = new THREE.Matrix4();
  const tmpV = new THREE.Vector3();

  function oriToMatrix4(ori) {
    return tmpM.set(
      ori[0][0], ori[0][1], ori[0][2], 0,
      ori[1][0], ori[1][1], ori[1][2], 0,
      ori[2][0], ori[2][1], ori[2][2], 0,
      0, 0, 0, 1
    );
  }

  /** anim: {axis, layer, angle, mask}；无 anim 时完全按 core 状态摆放 */
  function syncMeshes(anim) {
    const list = model.cubies();
    for (let i = 0; i < meshes.length; i++) {
      const cubie = list[i];
      const mesh = meshes[i];
      if (anim && anim.mask[i]) {
        const v = AXIS_VEC[anim.axis];
        rotM.makeRotationAxis(tmpV.set(v[0], v[1], v[2]), anim.angle);
        const pos = tmpV.set(cubie.pos[0], cubie.pos[1], cubie.pos[2]).applyMatrix4(rotM);
        mesh.position.copy(pos);
        const base = oriToMatrix4(cubie.ori).clone();
        mesh.quaternion.setFromRotationMatrix(rotM.clone().multiply(base));
      } else {
        mesh.position.set(cubie.pos[0], cubie.pos[1], cubie.pos[2]);
        mesh.quaternion.setFromRotationMatrix(oriToMatrix4(cubie.ori));
      }
    }
  }

  function frame() {
    rafId = null;
    if (disposed) return;
    if (twist) {
      // 小程序 canvas.requestAnimationFrame 不传入时间戳，不能用回调参数。
      // 一律用 Date.now()，否则 (undefined - t0) 为 NaN，动画永不结束，下一步会卡在「转动中」。
      const now = Date.now();
      const u = clamp((now - twist.t0) / twist.duration, 0, 1);
      const angle = easeInOutCubic(u) * twist.totalAngle;
      syncMeshes({ axis: twist.axis, layer: twist.layer, angle, mask: twist.mask });
      if (u >= 1) completeTwist();
    }
    renderer.render(scene, camera);
    if (twist) requestRender();
  }

  /** 一步转动只在这里落地：清定时器、写入状态、兑现 Promise。重复调用直接返回。 */
  function completeTwist() {
    if (!twist) return;
    const done = twist;
    twist = null;
    if (done.watchdog) clearTimeout(done.watchdog);
    model.applyToken(done.token);
    syncMeshes(null);
    requestRender();
    if (done.settle) done.settle();
  }

  function requestRender() {
    if (disposed || rafId !== null) return;
    rafId = raf.schedule(frame);
  }

  /**
   * 播放一步转动。返回的 Promise 在动画结束或兜底超时后兑现。
   * 正在转动时拒绝，避免调用方把没转的一步当成已完成。
   */
  function playMove(token) {
    if (disposed) return Promise.resolve();
    if (twist) return Promise.reject(new Error('转动进行中'));
    const turn = tokenToTurn(token);
    const idx = AXIS_INDEX[turn.axis];
    const mask = model.cubies().map((c) => c.pos[idx] === turn.layer);
    return new Promise((resolve) => {
      twist = {
        token,
        axis: turn.axis,
        layer: turn.layer,
        totalAngle: (turn.steps * Math.PI) / 2,
        mask,
        t0: Date.now(),
        duration: moveDuration,
        settle: resolve
      };
      // 帧回调若一直不来，到点仍推进状态，避免「下一步」永久停在转动中
      twist.watchdog = setTimeout(completeTwist, moveDuration + 500);
      requestRender();
    });
  }

  function instantMove(token) {
    model.applyToken(token);
    syncMeshes(null);
    requestRender();
  }

  function setScramble(solutionTokens) {
    const state = model.setScramble(solutionTokens);
    syncMeshes(null);
    requestRender();
    return state;
  }

  function resetSolved() {
    model.reset();
    syncMeshes(null);
    requestRender();
  }

  function orbitBy(dx, dy) {
    orbit.theta -= dx * 0.008;
    orbit.phi = clamp(orbit.phi - dy * 0.008, 0.18, Math.PI - 0.18);
    applyCamera();
    requestRender();
  }

  function zoomBy(factor) {
    orbit.radius = clamp(orbit.radius * factor, 4.6, 15);
    applyCamera();
    requestRender();
  }

  /** 下一步动画用这个时长。练一练的低中高速靠它切换，不影响已经开始的那一步。 */
  function setMoveDuration(ms) {
    const next = Number(ms);
    if (next > 0) moveDuration = next;
  }

  /** 把浮点法向收成 ±1 的坐标轴，避免射线误差对不上六个面。 */
  function snapAxis(v) {
    return v.map((n) => (Math.abs(n) < 0.5 ? 0 : (n > 0 ? 1 : -1)));
  }

  /**
   * 用画布内的 css 坐标做射线，找到被点中的色块。
   * 返回世界坐标下的法向和块心；点空或正在转动时返回 null。
   */
  function pickFace(localX, localY, width, height) {
    if (disposed || twist || !width || !height) return null;
    pointer.x = (localX / width) * 2 - 1;
    pointer.y = -(localY / height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length || !hits[0].face) return null;
    const mesh = hits[0].object;
    const cubie = model.cubies()[mesh.userData.cubieIndex];
    const localN = LOCAL_DIR[hits[0].face.materialIndex];
    if (!cubie || !localN) return null;
    const normal = snapAxis(applyVec(cubie.ori, localN));
    const ones = normal.filter((n) => n !== 0).length;
    if (ones !== 1) return null;
    return { normal, pos: cubie.pos.slice() };
  }

  /**
   * 把屏幕上的拖动换成这一面的转动记号。dx 向右为正，dy 向下为正。
   * 拖动太短时返回 null，调用方就不要转。
   */
  function turnFromDrag(pick, dx, dy) {
    if (!pick || Math.hypot(dx, dy) < 24) return null;
    camera.updateMatrixWorld(true);
    const e = camera.matrixWorld.elements;
    const right = [e[0], e[1], e[2]];
    const up = [e[4], e[5], e[6]];
    const drag = [
      right[0] * dx - up[0] * dy,
      right[1] * dx - up[1] * dy,
      right[2] * dx - up[2] * dy
    ];
    return turnToken(pick.normal, pick.pos, drag);
  }

  function resetCamera() {
    orbit.radius = Math.hypot(DEFAULT_CAM[0], DEFAULT_CAM[1], DEFAULT_CAM[2]);
    orbit.theta = Math.atan2(DEFAULT_CAM[0], DEFAULT_CAM[2]);
    orbit.phi = Math.acos(DEFAULT_CAM[1] / orbit.radius);
    applyCamera();
    requestRender();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (twist) {
      if (twist.watchdog) clearTimeout(twist.watchdog);
      if (twist.settle) twist.settle();
      twist = null;
    }
    if (rafId !== null) raf.cancel(rafId);
    rafId = null;
    try {
      geometry.dispose();
      Object.keys(materialCache).forEach((k) => materialCache[k].dispose());
      renderer.dispose();
    } catch (err) {
      // 释放失败不阻断页面退出
    }
  }

  syncMeshes(null);
  requestRender();
  // 首帧可能赶在画布挂上屏幕之前，补两帧，避免进去是空白、一点才出现
  setTimeout(() => {
    if (!disposed) requestRender();
  }, 50);
  setTimeout(() => {
    if (!disposed) requestRender();
  }, 200);

  return {
    playMove,
    instantMove,
    setScramble,
    resetSolved,
    setMoveDuration,
    pickFace,
    turnFromDrag,
    orbitBy,
    zoomBy,
    resetCamera,
    dispose,
    isAnimating: () => !!twist,
    getState: () => model.getFacelets(),
    isSolved: () => model.isSolved(),
    invertToken
  };
}

module.exports = { createCubeScene, COLORS3 };

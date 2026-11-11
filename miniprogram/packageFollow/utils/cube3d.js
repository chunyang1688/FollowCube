// 3D 渲染层：把 cube3d-core 的整数状态画到 <canvas type="webgl">。
// 依赖 vendor 的 threejs-miniprogram（CommonJS 产物，已放进分包，无需「构建 npm」）。
// 状态真值始终在 core；本层只负责按状态摆 26 个 cubie，并在层转时叠加临时旋转。
const { createScopedThreejs } = require('../vendor/threejs-miniprogram/index.js');
const { createModel, tokenToTurn } = require('./cube3d-core.js');
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
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(1); // 像素尺寸已经乘过 dpr，这里避免二次放大
    renderer.setSize(pxW, pxH, false);
    renderer.setClearColor(0xf7f8fa, 1);
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
  const meshes = cubies.map((cubie) => {
    // BoxGeometry 材质组顺序：+x -x +y -y +z -z，与 core 的 LOCAL_DIR 一致
    const mats = cubie.stickers.map((color) =>
      materialCache[color || 'X']
    );
    const mesh = new THREE.Mesh(geometry, mats);
    scene.add(mesh);
    return mesh;
  });

  const raf = makeRaf(canvas);
  let rafId = null;
  let twist = null;
  let disposed = false;
  const moveDuration = opts.moveDuration || 480;
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

  function frame(now) {
    rafId = null;
    if (disposed) return;
    if (twist) {
      const u = clamp((now - twist.t0) / twist.duration, 0, 1);
      const angle = easeInOutCubic(u) * twist.totalAngle;
      syncMeshes({ axis: twist.axis, layer: twist.layer, angle, mask: twist.mask });
      if (u >= 1) {
        const done = twist;
        twist = null;
        model.applyToken(done.token);
        syncMeshes(null);
        if (done.resolve) done.resolve();
      }
    }
    renderer.render(scene, camera);
    if (twist) requestRender();
  }

  function requestRender() {
    if (disposed || rafId !== null) return;
    rafId = raf.schedule(frame);
  }

  /** 播放一步转动（返回 Promise）；正在转动时直接返回一个已完成的 Promise */
  function playMove(token) {
    if (disposed) return Promise.resolve();
    if (twist) return Promise.resolve();
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
        resolve
      };
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
    if (twist && twist.resolve) twist.resolve();
    twist = null;
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

  return {
    playMove,
    instantMove,
    setScramble,
    resetSolved,
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

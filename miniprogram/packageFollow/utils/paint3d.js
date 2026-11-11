// 填色用的立体魔方：块不转动，只把相机停在看得到三个面的角上。
// 点贴纸改的是 54 格颜色，不走层转状态机。跟做页的 createCubeScene 仍负责动画。
const { FACE_DEFS } = require('./cube3d-core.js');

const COLOR_ORDER = ['U', 'R', 'F', 'D', 'L', 'B'];
const COLORS3 = {
  U: 0xf5f5f5,
  D: 0xffd500,
  R: 0xb71234,
  L: 0xff6b1a,
  F: 0x009b48,
  B: 0x0046ad,
  '?': 0xe4ddd4
};
// 材质顺序与 Three BoxGeometry 一致：+x -x +y -y +z -z
const LOCAL_DIR = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1]
];
const RADIUS = 7.4;
const PHI_UP = Math.acos(1 / Math.sqrt(3));
const PHI_DOWN = Math.PI - PHI_UP;
const THETA0 = Math.PI / 4;

function sameVec(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/**
 * 由小块坐标和被点中的面法向，找到 54 格下标。
 * 中心格 center 为 true，调用方不得改色。找不到返回 null。
 */
function stickerAt(pos, normal) {
  let face = '';
  COLOR_ORDER.forEach((name) => {
    if (sameVec(FACE_DEFS[name].normal, normal)) face = name;
  });
  if (!face) return null;
  const def = FACE_DEFS[face];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      if (!sameVec(def.at(row, col), pos)) continue;
      const gi = COLOR_ORDER.indexOf(face) * 9 + row * 3 + col;
      return { gi, center: row === 1 && col === 1, face };
    }
  }
  return null;
}

/** 相机停在某个角时，用户正对的三个面（中文，给页面顶上那一行用） */
function facingLabel(theta, phi) {
  const x = Math.sin(phi) * Math.sin(theta);
  const y = Math.cos(phi);
  const z = Math.sin(phi) * Math.cos(theta);
  return [
    y >= 0 ? '上面' : '下面',
    z >= 0 ? '前面' : '后面',
    x >= 0 ? '右面' : '左面'
  ].join(' · ');
}

function ease(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * 创建可点选上色的立体魔方。初始化失败返回 null。
 * setFacelets 整盘上色；setSticker 改一格；hit 用画布内的 css 坐标做射线。
 * turnYaw(±1) 水平转 90°，turnPitch() 在看顶面和看底面之间切换。
 */
function createPaintCube(opts) {
  const canvas = opts.canvas;
  const pixelRatio = Math.min(opts.pixelRatio || 1, 2);
  const pxW = Math.max(1, Math.round(opts.width * pixelRatio));
  const pxH = Math.max(1, Math.round(opts.height * pixelRatio));
  let THREE;
  let renderer;
  try {
    const { createScopedThreejs } = require('../vendor/threejs-miniprogram/index.js');
    THREE = createScopedThreejs(canvas);
    canvas.width = pxW;
    canvas.height = pxH;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch (err) {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    }
    renderer.setPixelRatio(1);
    renderer.setSize(pxW, pxH, false);
    renderer.setClearColor(0xfff6ea, 1);
  } catch (err) {
    return null;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, pxW / pxH, 0.1, 100);
  scene.add(new THREE.AmbientLight(0xffffff, 0.82));
  const key = new THREE.DirectionalLight(0xffffff, 0.55);
  key.position.set(4, 6, 5);
  scene.add(key);

  const Box = THREE.BoxBufferGeometry || THREE.BoxGeometry;
  const geometry = new Box(0.9, 0.9, 0.9);
  const pieces = [];
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        if (x === 0 && y === 0 && z === 0) continue;
        const materials = LOCAL_DIR.map(() => new THREE.MeshLambertMaterial({ color: COLORS3['?'] }));
        const mesh = new THREE.Mesh(geometry, materials);
        mesh.position.set(x, y, z);
        mesh.userData.pos = [x, y, z];
        scene.add(mesh);
        if (THREE.EdgesGeometry && THREE.LineSegments) {
          const lines = new THREE.LineSegments(
            new THREE.EdgesGeometry(geometry),
            new THREE.LineBasicMaterial({ color: 0x2a2a2a })
          );
          mesh.add(lines);
        }
        pieces.push(mesh);
      }
    }
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let theta = THETA0;
  let phi = PHI_UP;
  let thetaFrom = theta;
  let phiFrom = phi;
  let thetaTo = theta;
  let phiTo = phi;
  let animStart = 0;
  let animating = false;
  let disposed = false;
  let rafId = null;
  const stickers = [];

  function applyCamera() {
    camera.position.set(
      RADIUS * Math.sin(phi) * Math.sin(theta),
      RADIUS * Math.cos(phi),
      RADIUS * Math.sin(phi) * Math.cos(theta)
    );
    camera.lookAt(0, 0, 0);
  }

  function schedule() {
    if (disposed || rafId !== null) return;
    const raf = canvas.requestAnimationFrame
      ? (cb) => canvas.requestAnimationFrame(cb)
      : (cb) => setTimeout(cb, 16);
    rafId = raf(frame);
  }

  function frame() {
    rafId = null;
    if (disposed) return;
    if (animating) {
      const u = Math.min(1, (Date.now() - animStart) / 260);
      const k = ease(u);
      theta = thetaFrom + (thetaTo - thetaFrom) * k;
      phi = phiFrom + (phiTo - phiFrom) * k;
      if (u >= 1) animating = false;
    }
    applyCamera();
    renderer.render(scene, camera);
    if (animating) schedule();
  }

  function paintMaterial(pos, normal, colorKey) {
    const mesh = pieces.find((item) => sameVec(item.userData.pos, pos));
    if (!mesh) return;
    const matIndex = LOCAL_DIR.findIndex((dir) => sameVec(dir, normal));
    if (matIndex < 0) return;
    const hex = COLORS3[colorKey] == null ? COLORS3['?'] : COLORS3[colorKey];
    mesh.material[matIndex].color.setHex(hex);
    mesh.material[matIndex].emissive && mesh.material[matIndex].emissive.setHex(0x000000);
  }

  /** 按 54 位字符串给六个面重新上色，并记下每格对应的小块，方便之后标红 */
  function setFacelets(state) {
    stickers.length = 0;
    COLOR_ORDER.forEach((face, faceIndex) => {
      const def = FACE_DEFS[face];
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          const gi = faceIndex * 9 + row * 3 + col;
          const pos = def.at(row, col);
          paintMaterial(pos, def.normal, state[gi] || '?');
          stickers[gi] = { pos, normal: def.normal };
        }
      }
    });
    schedule();
  }

  function setSticker(gi, colorKey) {
    const item = stickers[gi];
    if (!item) return;
    paintMaterial(item.pos, item.normal, colorKey);
    schedule();
  }

  /** 不合法的格子加一点红，其余恢复。cells 是 54 格下标 */
  function markErrors(cells) {
    const bad = {};
    (cells || []).forEach((gi) => {
      bad[gi] = true;
    });
    stickers.forEach((item, gi) => {
      const mesh = pieces.find((piece) => sameVec(piece.userData.pos, item.pos));
      if (!mesh) return;
      const matIndex = LOCAL_DIR.findIndex((dir) => sameVec(dir, item.normal));
      if (matIndex < 0 || !mesh.material[matIndex].emissive) return;
      mesh.material[matIndex].emissive.setHex(bad[gi] ? 0x662222 : 0x000000);
    });
    schedule();
  }

  /**
   * 触点相对画布左上角的 css 像素。点中贴纸返回 {gi, center, face}，点空返回 null。
   */
  function hit(localX, localY, width, height) {
    if (!width || !height) return null;
    pointer.x = (localX / width) * 2 - 1;
    pointer.y = -(localY / height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pieces, false);
    if (!hits.length || !hits[0].face) return null;
    const mesh = hits[0].object;
    const normal = LOCAL_DIR[hits[0].face.materialIndex];
    if (!normal || !mesh.userData.pos) return null;
    return stickerAt(mesh.userData.pos, normal);
  }

  function animateTo(nextTheta, nextPhi) {
    thetaFrom = theta;
    phiFrom = phi;
    thetaTo = nextTheta;
    phiTo = nextPhi;
    animStart = Date.now();
    animating = true;
    schedule();
  }

  applyCamera();
  schedule();

  return {
    setFacelets,
    setSticker,
    markErrors,
    hit,
    facing: () => facingLabel(thetaTo, phiTo),
    /** 相机还在转到下一角时，页面不要拿旧画面做点击 */
    isAnimating: () => animating,
    /** dir 为 1 或 -1，绕竖直方向转 90° */
    turnYaw(dir) {
      if (animating) return;
      animateTo(thetaTo + dir * (Math.PI / 2), phiTo);
    },
    /** 在看顶面和看底面之间切换，这样六个面都能点到 */
    turnPitch() {
      if (animating) return;
      animateTo(thetaTo, phiTo === PHI_UP ? PHI_DOWN : PHI_UP);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try {
        geometry.dispose();
        pieces.forEach((mesh) => mesh.material.forEach((mat) => mat.dispose()));
        renderer.dispose();
      } catch (err) {
        // 页面退出时释放失败不影响返回
      }
    }
  };
}

module.exports = { createPaintCube, stickerAt, facingLabel, COLOR_ORDER };

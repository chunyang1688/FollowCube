/* eslint-disable no-console */
/**
 * 拍照识别算法自检：用 Node 合成 RGBA 图像，验证色彩分类、九宫格采样、
 * 中心色校准、不确定格标记与自动框检测。
 * 运行：cd tools && npm run verify:vision（不需要 rubik-solver）
 */
const {
  COLOR_HEX,
  COLOR_ORDER,
  COLOR_NAME
} = require('../miniprogram/utils/colors.js');
const V = require('../miniprogram/packageCamera/utils/vision.js');

let failed = 0;
function check(name, ok, detail) {
  if (ok) console.log('  PASS  ' + name);
  else {
    failed += 1;
    console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : ''));
  }
}

const SIZE = 300;
const RECT = { x: 30, y: 30, w: 240, h: 240, angle: 0 };

function makeImage(colors, opts) {
  const options = opts || {};
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  const bg = options.bg || [17, 17, 17];
  for (let i = 0; i < SIZE * SIZE; i++) {
    data[i * 4] = bg[0];
    data[i * 4 + 1] = bg[1];
    data[i * 4 + 2] = bg[2];
    data[i * 4 + 3] = 255;
  }
  const cell = RECT.w / 3;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const hex = COLOR_HEX[colors[row * 3 + col]] || '#000000';
      const rgb = [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16)
      ];
      const gap = 6;
      const x0 = Math.floor(RECT.x + col * cell + gap);
      const y0 = Math.floor(RECT.y + row * cell + gap);
      const x1 = Math.floor(RECT.x + (col + 1) * cell - gap);
      const y1 = Math.floor(RECT.y + (row + 1) * cell - gap);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * SIZE + x) * 4;
          data[i] = rgb[0];
          data[i + 1] = rgb[1];
          data[i + 2] = rgb[2];
        }
      }
    }
  }
  return { data, width: SIZE, height: SIZE };
}

function main() {
  // 1. 六个标准色必须各自分类正确
  const palette = V.defaultPalette();
  for (const color of COLOR_ORDER) {
    const rgb = V.hexToRgb(COLOR_HEX[color]);
    const hit = V.classifySticker(rgb, palette);
    check(
      '标准色 ' + COLOR_NAME[color] + '(' + color + ') 分类正确',
      hit.color === color,
      '实际=' + hit.color + ' conf=' + hit.conf.toFixed(2)
    );
  }

  // 2. 合成一整面：中心为 U(白)，其余八格铺六种颜色，应逐格识别一致
  const faceColors = ['R', 'F', 'D', 'L', 'U', 'B', 'R', 'F', 'D'];
  const image = makeImage(faceColors);
  const result = V.analyzeFace(image, 'U', V.defaultPalette(), RECT);
  const expected = faceColors.slice();
  expected[4] = 'U';
  check(
    '九宫格逐格识别与合成图一致',
    result.colors.join('') === expected.join(''),
    '实际=' + result.colors.join('') + ' 期望=' + expected.join('')
  );
  check('中心色匹配时 centerMismatch 为 false', result.centerMismatch === false);
  check('确定格数 uncertain 为 0', result.uncertain === 0, '实际=' + result.uncertain);
  check('返回 9 个采样点', result.points.length === 9);

  // 3. 中心放蓝却声明为白面 -> 应报告中心不匹配
  const wrongCenter = ['R', 'F', 'D', 'L', 'B', 'B', 'R', 'F', 'D'];
  const mismatch = V.analyzeFace(makeImage(wrongCenter), 'U', V.defaultPalette(), RECT);
  check('中心色不符时给出 centerMismatch', mismatch.centerMismatch === true);

  // 4. 自动框检测：应覆盖到彩色区域，且落在画布内
  const detected = V.detectFaceRect(image, { dx: 0, dy: 0, dw: SIZE, dh: SIZE });
  check(
    '自动检测框接近真实魔方面',
    detected.w > 180 && detected.w < 300 && detected.x < 60 && detected.y < 60,
    JSON.stringify(detected)
  );
  check(
    '自动框再取样仍能得到 9 格',
    V.sampleFaceColors(image, detected).samples.length === 9
  );

  // 5. 旋转九宫格采样不崩且仍产出 9 个样本
  const rotated = Object.assign({}, RECT, { angle: 0.12 });
  const rotatedResult = V.analyzeFace(image, 'U', V.defaultPalette(), rotated);
  check('带角度的九宫格仍可采样识别', rotatedResult.colors.length === 9);

  // 6. clamp 后不越界
  const clamped = V.clampGuideRect({ x: -100, y: -100, w: 500, h: 500, angle: 0.3 }, SIZE);
  check(
    'clampGuideRect 把越界框收进画布',
    clamped.x >= 0 && clamped.y >= 0 && clamped.x + clamped.w <= SIZE + 1,
    JSON.stringify(clamped)
  );

  // 7. 灰度/暗色会被标为不确定或白，不应崩
  const darkRgb = { r: 20, g: 20, b: 20 };
  const dark = V.classifySticker(darkRgb, V.defaultPalette());
  check('极暗贴纸仍有确定分类结果', COLOR_ORDER.indexOf(dark.color) >= 0 || dark.color === '?');

  console.log('\n' + (failed ? '✗ ' + failed + ' 项失败' : '✓ 全部通过'));
  process.exit(failed ? 1 : 0);
}

main();

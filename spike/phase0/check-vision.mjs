import { classifySticker, defaultPalette, recognizeFace } from "./vision.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const palette = defaultPalette();

// 白 vs 绿：暖光下的绿也不该进白
const white = classifySticker({ r: 230, g: 225, b: 210 }, palette);
assert(white.color === "U", "白识别失败: " + white.color);
const green = classifySticker({ r: 40, g: 140, b: 70 }, palette);
assert(green.color === "F", "绿识别失败: " + green.color);
const greenWarm = classifySticker({ r: 90, g: 150, b: 60 }, palette);
assert(greenWarm.color === "F", "暖光绿识别失败: " + greenWarm.color);

const red = classifySticker({ r: 180, g: 30, b: 40 }, palette);
assert(red.color === "R", "红识别失败: " + red.color);
const blue = classifySticker({ r: 30, g: 70, b: 170 }, palette);
assert(blue.color === "B", "蓝识别失败: " + blue.color);

// 模拟用户图：绿白绿 / 红白红 / 蓝白蓝，中心白 → 当作 U 面
const samples = [
  { r: 50, g: 145, b: 65 },
  { r: 235, g: 230, b: 220 },
  { r: 55, g: 140, b: 70 },
  { r: 175, g: 35, b: 45 },
  { r: 240, g: 235, b: 225 },
  { r: 170, g: 30, b: 40 },
  { r: 35, g: 75, b: 165 },
  { r: 230, g: 225, b: 215 },
  { r: 40, g: 80, b: 170 },
];
const u = recognizeFace(samples, "U", defaultPalette());
assert(u.colors[0] === "F", "左上应是绿，得到 " + u.colors[0]);
assert(u.colors[2] === "F", "右上应是绿，得到 " + u.colors[2]);
assert(u.colors[1] === "U", "上中应是白，得到 " + u.colors[1]);
assert(u.colors[3] === "R" && u.colors[5] === "R", "中行两侧应是红");
assert(u.colors[6] === "B" && u.colors[8] === "B", "下行两侧应是蓝");
assert(u.colors[4] === "U", "中心应是 U");
assert(u.colors[7] === "U", "下中应是白，得到 " + u.colors[7]);

// 拍错面：中心是白却声称是 R
const wrong = recognizeFace(samples, "R", defaultPalette());
assert(wrong.centerMismatch, "中心不是红时应标记 centerMismatch");

console.log("ok vision", u.colors.join(""), "mismatch", wrong.centerMismatch);

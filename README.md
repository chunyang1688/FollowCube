# FollowCube

跟着还原魔方：把当前魔方颜色填进网页 → 求解 → 在 3D 动画里一步步跟着转，对照实体魔方还原。

当前可运行演示在 `spike/phase0/`（浏览器 H5 原型）。

微信小程序版在 `miniprogram/`（微信原生，功能已补齐：手工填色 / 拍照识别六面 → Kociemba 求解 → 3D 模型 + 中文步骤跟做）。用微信开发者工具导入 `miniprogram/` 目录即可预览；导入前把 `project.config.json` 里的 `appid` 占位值换成自己的 AppID（或用游客模式）。3D 引擎已随分包附带，**无需在开发者工具里「构建 npm」**。

构建与自检（Node 18+）：

```bash
cd tools
npm install
npm run build:solver     # 重建求解 Worker（可选，产物已随仓库提供）
npm run build:threejs    # 重新 vendor threejs-miniprogram（可选）
npm run verify:all       # 求解器 / 3D 状态机 / 视觉识别 / 项目静态检查
```

开发进度、接口清单、隐私合规前置与提审待办见《小程序项目档案.md》。

## 功能

- **手工填色**：展开图点格改色；键盘 `1–6` 快捷填色（白红绿黄橙蓝）；中心色固定
- **拍照填色（实验）**
  - 按中心色顺序拍六面：白 → 红 → 绿 → 黄 → 橙 → 蓝
  - 载入照片后可拖动 / 缩放 / 旋转九宫格再「确认识别」
  - 可点清单或展开图**单独重拍某一面**，不必六面重来
- **合法性检查**：颜色数量、角块/棱块组合错误时，会提示具体面与格位，并在展开图标红
- **Kociemba 求解**：Web Worker 后台求解，不卡界面
- **3D 跟着还原**
  - 上一步 / 下一步 / 自动还原 / 转速（慢中快）
  - 中文步骤说明（如「右面顺时针转 90°」）
  - 拖动旋转视角、滚轮缩放、「复位视角」

## 环境要求

- Node.js 18+（安装依赖、跑自检）
- Python 3（本地静态预览，或用任意静态服务器）
- 现代浏览器（需支持 ES Module、Web Worker、WebGL）

## 启动方法

```bash
git clone https://github.com/chunyang1688/FollowCube.git
cd FollowCube/spike/phase0
npm install
./start.sh
```

浏览器打开：<http://127.0.0.1:8765/>

换端口：

```bash
PORT=9000 ./start.sh
```

也可用：

```bash
cd spike/phase0
python3 -m http.server 8765
```

> 请用 HTTP 打开页面（不要直接双击 `index.html`），否则 Worker / 模块加载可能失败。

### 自检（可选）

```bash
cd spike/phase0
npm run check          # 求解与转动一致性
npm run check:vision   # 颜色识别基础用例
```

## 使用说明

### 1. 填色

1. 推荐点 **拍照填色**：按提示依次拍六个中心色对应的面；每张图拖黄框对齐九个色块后点 **确认识别**，再 **下一张**。
2. 某面识别不准：点上方色心清单（或展开图该面）→ 只重拍这一面。
3. 也可用 **填入示例打乱** 直接体验求解与跟做；或手工点格 / 按 `1–6` 填色。
4. 颜色齐后点 **求解**。若提示角块/棱块不合法，按右侧说明改展开图上标红的格。

### 2. 跟着还原

1. 求解成功后，3D 区进入待跟做状态。
2. 对照实体魔方，按 **下一步** 一步步转；或用 **自动还原** 连续播放。
3. **上一步** 可回退；**从头再跟** 回到解法开头。
4. 拖动 3D 画布可旋转查看各面；滚轮缩放；双击或 **复位视角** 恢复默认角度。
5. 全部步骤完成后会提示还原成功。

## 目录结构

```
FollowCube/
├── README.md
├── 小程序项目档案.md       # 小程序进度、接口清单、待办与提审记录
├── .gitignore
├── miniprogram/           # 微信小程序项目根（开发者工具导入此目录）
│   ├── pages/index/       # 主包：手工填色 + 求解
│   ├── packageFollow/     # 分包：3D 跟做（含 vendor/threejs-miniprogram）
│   ├── packageCamera/     # 分包：拍照识别六面
│   ├── utils/ services/   # 纯逻辑层 / Worker 适配层
│   └── workers/solver/    # 求解 Worker 单文件产物
├── tools/                 # Worker 源码、3D vendor 脚本、四组自检脚本
└── spike/phase0/          # 浏览器 H5 原型（保留）
    ├── index.html         # 页面与样式
    ├── main.js            # 填色、拍照流程、3D 跟做
    ├── worker.js          # 求解 Worker
    ├── vision.js          # 拍照识别与九宫格
    ├── colors.js          # 颜色/面序/合法性诊断
    ├── turns.js           # 公式与中文步骤文案
    ├── state.js           # 示例打乱状态
    ├── start.sh           # 一键本地预览
    ├── package.json
    └── check*.mjs         # 自检脚本
```

## 产品阶段

| 阶段 | 目标 | H5 原型 | 小程序 |
|------|------|---------|--------|
| 0 | 技术验证 | 已完成 | — |
| 1 | 手工填色 + 求解 | 已完成 | 已完成 |
| 2 | 3D 跟着还原 | 已完成 | 已完成 |
| 3 | 拍照识别 + 纠错 | 已完成 | 已完成 |
| 4 | 真机双端验收、体验打磨 | — | 待进行 |
| 5 | 备案 / 提审 / 发布 | — | 待进行 |

小程序仍需在微信开发者工具与 iOS / Android 真机走完整流程后再提审，详见《小程序项目档案.md》的提审前差距清单。

## 技术栈

- 前端：原生 HTML / CSS / ES Module
- 3D：Three.js
- 求解：`rubik-solver`（Kociemba，跑在 Worker）

## License

ISC

# HANDOFF

## Goal
微信小程序「跟着还原魔方」：手工填色或拍照识别六面，本地求解，再在 3D 模型里一步步跟做。功能代码已齐，下一步是真机双端验收和提审材料。

## Context
- 远程：`https://github.com/chunyang1688/FollowCube`，分支 `main`
- 小程序根目录是 `miniprogram/`，用微信开发者工具导入该目录
- 浏览器 H5 原型仍在 `spike/phase0/`，保留不改
- 详细进度、接口和提审差距以《小程序项目档案.md》为准；本文件只作入口
- 流水：`agent_memory/progress.md`

## Key Files
- `miniprogram/`：小程序源码（主包填色求解、`packageFollow` 3D 跟做、`packageCamera` 拍照）
- `miniprogram/services/solver.js`：Worker 先注册监听再 ping，避免 ready 消息丢失
- `miniprogram/utils/scramble.js`：首页「示例打乱」的随机合法打乱
- `tools/`：求解 Worker 构建与 `npm run verify:all`
- `小程序项目档案.md`：技术决策、接口清单、提审差距
- `真机验收清单.md`：真机检查项

## Working Tree
`main` 已包含小程序、工具脚本和文档。`.workbuddy/` 是本地会话记录，未纳入版本库。

## Next Steps
1. 用微信开发者工具导入 `miniprogram/`，AppID 用自己的或游客模式预览。
2. 在 iOS 与 Android 各走一遍：填色或拍照 → 求解 → 3D 跟做。重点看 WebGL、相机、Canvas 取像素、分包和 Worker。
3. 完成备案和《用户隐私保护指引》后再提审。差距见《小程序项目档案.md》的 P0 / P1。

## Resume Checklist
- 先读本文件、`agent_memory/progress.md` 和《小程序项目档案.md》
- 在 `tools/` 执行 `npm run verify:all`，确认自检仍通过
- 未明确要求时不要 commit 或 push

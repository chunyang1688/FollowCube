# HANDOFF

## Goal
微信小程序和浏览器 H5 都是「跟着还原魔方」：首页有填色、拍照、练一练、跟着转。下一步是真机确认点贴纸、手动转面和实拍。

## Context
- 远程：`https://github.com/chunyang1688/FollowCube`，分支 `main`
- 小程序根目录是 `miniprogram/`，用微信开发者工具导入该目录
- 浏览器 H5 在 `spike/phase0/`，页面和功能已与小程序对齐。本地预览：在该目录执行 `python -m http.server 8765`
- 详细进度、接口和提审差距以《小程序项目档案.md》为准；本文件只作入口
- 流水：`agent_memory/progress.md`
- 填色页必须留在 `packageFollow`，因为 3D 引擎在这个分包里，主包不能引用分包代码

## Key Files
- `miniprogram/pages/index/`：首页四个入口
- `miniprogram/packageFollow/pages/paint/`：立体填色、求解
- `miniprogram/packageFollow/pages/practice/`：练一练，自己转或按步骤看还原
- `miniprogram/packageFollow/utils/paint3d.js`：只转相机、可点贴纸的模型
- `miniprogram/packageFollow/pages/follow/`：3D 跟做
- `miniprogram/packageCamera/pages/camera/`：拍照，完成后回到立体魔方
- `miniprogram/services/solver.js`：本地求解
- `spike/phase0/`：H5 页面。`npm run check` 与 `npm run check:vision`
- `tools/`：`npm run verify:all`
- `小程序项目档案.md`、`真机验收清单.md`

## Working Tree
已推送 `fbe7035`。工作区只剩不入库的 `.workbuddy/`。`tools/node_modules/` 与 `spike/phase0/node_modules/` 被 gitignore，不入库。

## Next Steps
1. 模拟器里练一练已走过：还原好的魔方、随机打乱、求出步骤、下一步和上一步、切换高速、返回自己转。手指转面要在真机上确认，模拟器自动化拿不到触摸坐标。
2. 模拟器里首页、立体填色、示例打乱后求解、跟做一步、拍照页入口已走过。点贴纸同样要在真机上确认。
3. 模拟器或真机实拍一张魔方照片，确认识别结果能回到立体魔方。
4. 在 iOS 与 Android 各走一遍。重点看 WebGL、相机、Canvas 取像素、分包和 Worker。
5. 完成备案和《用户隐私保护指引》后再提审。差距见《小程序项目档案.md》的 P0 / P1。

## Resume Checklist
- 先读本文件、`agent_memory/progress.md` 和《小程序项目档案.md》
- 在 `tools/` 执行 `npm run verify:all`，确认自检仍通过
- 未明确要求时不要 commit 或 push

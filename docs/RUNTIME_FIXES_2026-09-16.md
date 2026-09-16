# 运行时审核修复 / Runtime review fixes — 2026-09-16

基于 `main` 的 `7b5fbce24e4fced3c80957308741eff55312ccd1`。本次只修改网页代码、测试与文档，不修改 native102 的 MOC3、CMO3、PNG、参数定义或资产清单。

## 修改范围

### 公开口型事件

`main.ts` 改为在 `window` 的捕获阶段注册一次 `hikari:mouth-input` 监听器。

- README 的 `window.dispatchEvent(...)` 示例现在与实现一致。
- 兼容已有 `document.dispatchEvent(...)`，包括不冒泡的事件；冒泡事件也只处理一次。
- 不增加全局模型访问入口，不申请麦克风权限，不改变输入数值校验与 TTL。
- 模型尚未加载时不缓存事件；原有引擎替换逻辑继续生效。

### 帧率与时间步

新增 `web/src/frame-time.ts`：动画与动作收到真实帧间隔，长时间停顿最多接受 100ms；原生物理消耗同一段时间，但拆成不超过 1/60 秒的小步。环境附加偏移仍每个显示帧应用一次，避免在物理子步中重复累加。

首帧、暂停恢复、可见性变化与复位使用 `null` 时间基准，首帧不凭空增加 1/60 秒。正常 15/30/60/120 FPS 不再被统一裁为 1/30 秒；超过 100ms 的停顿仍会有意丢弃多余时间，以避免恢复时跳变和无限追帧。它不是任意低帧率下无限追赶墙钟的实现。

### 纹理解码与资源清理

新增 `web/src/decode-image.ts`：解码成功、失败、超时或中止后，统一释放定时器与 abort 监听器。销毁舞台可以中止解码等待，外层 `finally` 继续撤销 Blob URL 并清空图片来源。

`createTexture()` 返回空值时给出明确错误；成功分配后立即登记资源所有权，使上传抛错时 `destroy()` 仍能删除该纹理。未修改高清纹理尺寸、下载方式、并发度或 CDN 配置；不能据此宣称 32MB 主纹理的网络问题已经解决。

## 自动验证

从 `web/` 执行：

```sh
npm ci --ignore-scripts
npm run verify
npm run test:controller
npm run test:runtime
npx playwright install chromium
npm run test:mouth-event
```

`test:runtime` 使用 TypeScript AST 从实际 `runtime.ts` 提取方法，而不是复制一份运行时算法。它在模型和 GL 替身上运行帧循环、暂停、可见性切换、口型输入和纹理加载循环，并用真实 AbortSignal 与受控定时器测试解码清理。新增工具模块执行独立的严格类型检查。**这不是 SDK 全量类型检查、真实物理模拟或渲染验收。**

`test:mouth-event` 在真实 Chromium 中执行 `main.ts` 的实际监听器和中文 README 的完整口型示例；覆盖 window/document/元素、冒泡与非冒泡、重复处理和引擎暂不可用。**它不加载 Live2D 模型，不验证口型所有权的最终画面。**

可用 `BROWSER_CHANNEL=msedge` 选择本机 Edge，或用 `BROWSER_EXECUTABLE_PATH` 指定浏览器可执行文件。未提供浏览器时测试应报错，不应静默跳过。

新增 `.github/workflows/sdk-free-regression.yml` 在 PR、main/fix 分支推送和手动触发时运行资产校验、原有动作测试及新增测试。权限仅为 `contents: read`，不自动下载 Live2D SDK、不提交代码、不部署网站。

## 本次本地执行记录

- `test:runtime`：51 项通过。
- `test:mouth-event`：9 项通过，真实 Chromium 144.0.7559.96。
- 负对照：分别恢复修改前的 `runtime.ts` 和 `main.ts` 后，对应测试失败；还原修复后再次通过。
- 环境：Node.js 22.16.0、预装 TypeScript 5.8.3、预装 Playwright 1.57.0-beta-1764944708000。

当前执行环境无法直接联网安装仓库锁定依赖，因此上述本地结果**并非**仓库锁定的 TypeScript 5.9.3 / Playwright 1.58.2 环境结果。CI 配置通过 `npm ci` 使用仓库锁文件；其运行结论以实际 GitHub 检查结果为准。本次本地未执行完整 `npm run build`、原生模型渲染、资产全量校验或既有完整控制器测试，不沿用旧发布的 62 项结果充当本补丁验收。

## 合并与发布前

在已有合法 SDK 的完整检出环境中执行 `npm ci`、`npm run build` 和现有页面 smoke。再检查三套服装、低帧率动作、嘴部输入/咀嚼交接、暂停恢复、后台返回、重试和 WebGL 上下文丢失。特别需要肉眼验收物理步长变化后的头发与衣物表现。

本次不调整眼球网格补偿、肩部限幅、原生双眼/肩颈绑定、模型画质、暂停按需重绘或整体 strict 配置，也不宣称已更新线上网站。修改以独立分支和 PR 交付。

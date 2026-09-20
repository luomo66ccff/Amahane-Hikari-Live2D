# v2.0.0 制作与发布工作流

这份文档记录从美术输入到 native102 网页发布包的可复现流程。每一步都保留独立证据，避免把有限截图、参数枚举或某次构建误写成完整能力。

本项目由 Codex 代理主导制作任务拆解、工具编排、代码与验证脚本实现，维护者提供需求和效果反馈并负责采纳与发布授权。各阶段 AI 分工、生成素材来源与可核查提交见 [AI 开发与生成记录](AI_DEVELOPMENT.zh-CN.md)。下列 Photoshop、Cubism 和运行时门禁同样适用于 AI 产出的候选。

## 1. 固定源文件并定义变更

先保护 PSD、CMO3 和上一版已验收运行包，再写清要改的参数、drawable 或纹理范围。发现一个参数 ID 只能算候选；必须确认它的实际绑定、有效范围、中性读回和目标姿态中的可见变化。

当前发布源工程是 `model/source/Cubism/SuJiangXue_HairFlow_WIP_t102.cmo3`。仓库保留的 Photoshop 文件是 WIP 美术输入和局部补丁，并不覆盖三套服装的全部图层，因此不能把它们描述成完整最终母版。

## 2. 先完成 Photoshop 素材检查

涉及素材时，在 Photoshop 中检查透明度、配准、画布尺寸、色彩模式和目标图层。只做局部改动，保存新的源版本并记录可见区域，然后再进入 Cubism 替换或重新导入对应纹理。

除非任务明确要求改绑定，否则保留现有 ArtMesh 拓扑、UV、绘制顺序和变形器结构。只替换一张 PNG，不能证明 Cubism 使用了正确的 ArtMesh，也不能证明关键形状保持不变。

## 3. 在 Cubism 中编辑并导出

用 Cubism Editor 5.3.01 打开 CMO3，编辑前先保存回退副本。使用当前模型实际枚举出的对象名和参数 ID；点选或移动点前让模型处于中性态，每个独立编辑后都重新选择并读回数值。

保存、关闭、重开，再导出 model3、MOC3、physics、CDI、纹理、表情和 motion。对导出物重新读回参数、drawable、part、拓扑、UV、绘制顺序、物理和不受影响的状态。native102 验收把这些作为独立门禁，截图不能替代 Core 读回。

## 4. 同步并构建网页运行包

从 `web/` 安装锁定依赖并提供官方 SDK：

```sh
npm ci
npm run setup:sdk -- "/path/to/CubismSdkForWeb-5-r.5"
npm run verify
npm run build
```

如果本机没有 Playwright Chromium，再执行 `npx playwright install chromium`；已安装并准备使用 Edge 时可以跳过。`setup:sdk` 只从本地 SDK 复制需要的文件，保持源 SDK 不变；`verify` 检查资产清单和相对运行资源引用；`build` 先做 TypeScript 检查并同步模型，再输出 Vite 构建。

候选构建使用新的版本化目录，比较时不能覆盖已验收目录。SDK 源包不进入源码模型下载；生成的网页构建若包含 SDK 运行组件，必须同时保留适用的第三方说明和授权。

## 5. 分层验证运行时

先让 `npm run preview` 在一个终端持续运行，再在第二个终端运行真实页面检查：

```sh
npm run test:controller
npm run test:smoke -- http://127.0.0.1:5188/Amahane_Hikari/ ./reports/page-smoke
```

默认 smoke 使用 Chromium；要使用已安装的 Edge，可设置 `BROWSER_CHANNEL=msedge`。`test:controller` 是纯动作意图、时间曲线和取消/暂停/复位的确定性检查，不覆盖口型 handoff 或 TTL。`test:smoke` 检查普通生产页面的入口、真实资源、UI 交互和无 DEV 全局，不向页面注入内部模型控制器。口型所有权、chew 优先级和 TTL 必须用单独的真实浏览器验收覆盖。

性能比较必须让两版使用同一浏览器、视口、DPR、画布尺寸、缩放、输入时序和模型路由，读取实际 `drawModel` 时间戳间隔；不能用 RAF 频率、屏幕刷新率、录像 FPS 或单张截图代替。

## 6. 审阅、发布并保留回退

审阅源代码差异、生成文件清单和最终 manifest。哈希只写入活动清单，公开文案引用清单即可。保留上一版源、运行包和失败报告，用于回退和审计。

只有源文件读回、Core 结果、网页验证和发布检查都完成后才发布。仓库 URL 只是来源引用；没有独立核实外部状态时，不把 fork、PR 或 merge 写成已完成。

## 7. 固定边界

有限样本不能变成通用保证。VTube Studio 导入、摄像头追踪、摄像头/麦克风输入、任意设备和未测姿态都要单独验证。当前模型素材只到大腿上部。模型美术变更应与网页动作和口型输入分开，以免运行时修复悄悄改变原生资产。

## 这次部署如何回退

发布时先校验旧站清单，再把新构建放进独立版本目录；原有模型 URL 和带哈希的 JS/CSS 继续保留。校验新目录与构建清单一致后，用原子符号链接切换入口，并从实际 HTTP 读取健康状态和首页。切换、健康检查或最终发布记录保存任一步失败，都切回旧版。公网再检查桌面与窄屏交互并读回模型和代码文件。GitHub 正式发布目标固定为 luomo66ccff/Amahane-Hikari-Live2D。Hermes 可以提交改动和 PR；正式 Release 必须在指定仓库发布。写权限不足时保留待合并 PR，不另设公开发布仓库。

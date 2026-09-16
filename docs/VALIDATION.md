# v2.0.0 验证说明

下面记录 native102 发布实际测过的内容和证据边界。它们是有限验收，不代表任意设备、姿态或宿主软件都得到相同结果。

## 复现公开检查

从 `web/` 执行，先安装 Node.js 22.12+ 或 24 和 Cubism SDK for Web 5-r.5：

```sh
npm ci
npm run setup:sdk -- "/path/to/CubismSdkForWeb-5-r.5"
npx playwright install chromium
npm run verify
npm run build
```

如果使用已安装的 Edge，可跳过 Chromium 安装并设置 `BROWSER_CHANNEL=msedge`。让 `npm run preview` 在一个终端持续运行，再在第二个终端执行：

```sh
npm run test:controller
npm run test:smoke -- http://127.0.0.1:5188/Amahane_Hikari/ ./reports/page-smoke
```

`verify` 检查 manifest 和相对模型引用；`test:controller` 是纯动作意图与时序检查；`test:smoke` 是真实无头浏览器的普通页面检查。每次复跑都应使用新的报告目录，不覆盖既有证据，也不要把 production build 和 DEV-only 报告混在一起。

## 验收矩阵

| 层级 | 检查内容 | v2.0.0 证据边界 |
| --- | --- | --- |
| 原生源工程 | Cubism 保存、关闭、重开、导出 | native102 CMO3 和运行包在采纳前完成读回 |
| 原生清单 | 参数、drawable、part、纹理、物理和引用 | 该导出为 66 参数、226 drawable、59 part、8 张纹理 |
| 原生嘴部绑定 | 得意右嘴角控制和中性保持 | 新右嘴角绑定真实存在；值为 0 时旧组合保持，正向值是受限的局部变化 |
| Controller | 好奇、害羞、得意、左右咀嚼、取消、重入、暂停、复位 | 21 个确定性意图/时序用例通过，覆盖 15/30/60/120 Hz 采样和打断；不覆盖口型 handoff 或 TTL |
| 口型所有权 | 外部口型、chew 优先级、TTL、动作交接 | 22 项真实浏览器所有权验收单独覆盖了事件和 idle/cancel 边界 |
| 普通页面 | 模型、表情、服装、动作、复位、缩放和响应式布局 | 本地及公网最终各 62 项 smoke 检查通过桌面和 390px 窄屏；不向页面注入模型内部控制器，production 没有 `window.__hikariQa` |
| 生命周期 | pagehide、destroy、重复 teardown | pagehide 后 draw 停止，重复 destroy 没有新错误 |
| 换装回归 | 动作和口型后 0 → 1 → 2 → 0 | 66 参数回到各服装中性状态，缩放保持稳定 |

内部审计链使用的报告 ID 包括 `hikari_final_root_review_t001`、`native102_smirk_core_t002`、`hikari_smirk_controller_qa_t001`、`hikari_mouth_ownership_browser_t001`、`hikari_final_switch_release_t001` 以及页面 smoke 报告。公开仓库提供可复现脚本和相对资源，不公开原始 UI 日志、工作站路径或私有报告文件。

## 性能比较

Q7 将已完成头肩升级的 native101 作为 before，将 native102 public-actions build 作为 after。在同一套无头 Microsoft Edge 153、Intel ANGLE D3D11 环境下，视口 1100×1450、DPR 1、画布 1000×1200、缩放 1.15；三套服装各运行 10 秒，输入顺序相同：好奇 → 害羞 → 得意 → 跟随。

| 服装 | Before 平均 / 中位 / p95 | After 平均 / 中位 / p95 | 平均变化 | p95 变化 |
| --- | --- | --- | ---: | ---: |
| 0 | 4.165 / 4.2 / 4.4 ms | 4.245 / 4.2 / 4.8 ms | +1.91% | +0.4 ms |
| 1 | 4.166 / 4.2 / 4.4 ms | 4.229 / 4.2 / 4.6 ms | +1.52% | +0.2 ms |
| 2 | 4.166 / 4.2 / 4.4 ms | 4.166 / 4.2 / 4.4 ms | −0.009% | 0 ms |

样本来自 `getFrameTelemetry().intervals`，定义为实际 `drawModel` 调用前记录的时间戳之间的毫秒差。该运行没有页面、控制台、请求或 WebGL 设置错误。它只是固定环境下的对照，不是 240 FPS 承诺、设备无关保证，也不能把差异因果归到某一行网页代码或模型复杂度。

## 明确未覆盖

- 模型素材目前只到大腿上部；完整画布不代表存在小腿和脚。
- 仓库 PSD 是 WIP 和局部补丁输入，不是三套服装的完整最终 PSD。
- 媒体复核使用有限、带标签的帧和短序列，没有检查每个录像帧或全部参数组合。
- 本版未完成 VTube Studio 重新导入、摄像头追踪、摄像头输入或麦克风输入验收。
- 原生和网页检查只证明指定导出、构建和浏览器设置，不证明任意 Cubism Core、浏览器、GPU 或宿主软件兼容。

## 本次公网连接记录

公网首轮默认连接的 34 项检查通过。后续重复加载时，32.7 MB 主纹理曾触发应用的 60 秒请求超时；同一资源用 curl 下载完整，字节与原构建一致。最终以 Edge、HTTP/1.1 完成 62 项检查，报告见 [browser-smoke.json](browser-smoke.json)。这证明该连接方式的页面验收，不证明其他网络或 HTTP/2/3 的稳定性；超时记录保留，未改写为成功。

正常运行不需要修改浏览器协议。如需复现本次网络对照，在测试进程设置 `BROWSER_CHANNEL=msedge` 和 `BROWSER_HTTP1=1`；该选项只影响测试浏览器，不修改网页。

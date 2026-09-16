# 网页加载优化 · v2.0.1

本次保留 native102 原生模型和源 PNG，将网页传输纹理改为无损 WebP，提前并行下载独立资源，并修正版本化模型的缓存。网站构建为 v2.0.1-t028。

## 实测结果

以下是同一台机器、Edge 153、1440×1000、DPR 1、无网络节流、强制 HTTP/1.1 的前后各一组公网测量。每组先清浏览器缓存，再在同一 context 中打开两次；记录真实 canvas 的 `data-ready`，不是把 HTML 首屏或 LCP 当作模型完成。

| 指标 | 优化前 | 最终版本 |
| --- | ---: | ---: |
| 首次模型就绪 | 70.03 s | 16.48 s |
| 再次打开模型就绪 | 35.82 s | 2.61 s |
| 首次网络传输 | 46,674,094 B | 14,044,366 B |
| 再次打开网络传输 | 40,846,557 B | 1,177 B |
| 首次文字/页面 FCP | 1.080 s | 0.752 s |
| 纹理文件总大小 | 45,967,274 B | 13,336,594 B |

纹理文件减少 70.99%。8 张图均经解码后的完整 RGBA 比对，尺寸、透明度和像素一致。原 `model/runtime/` 的 PNG、MOC3、CMO3 与资产清单保持不变。编码固定 Sharp 0.35.4；跨平台编码字节相等不作保证，已有产物通过哈希复用，内容不同则必须递增网页模型版本。

这是单机实验室样本，没有采集真实用户 Core Web Vitals，也不是所有网络的速度保证。测量期间保留过主纹理超时、旧候选复访失败和默认连接着色器超时，不能只据最终一次成功宣称网络稳定。公开精简数据见 [web-performance.json](web-performance.json)，纹理身份见 [web-texture-manifest.json](web-texture-manifest.json)。

## 实现与纠正

- `scripts/prepare-web-model.mjs` 使用 `lossless: true`、`exact: true`，逐张比较 RGBA；生成 `model/hikari_t002/`，不覆盖已发布的模型 URL。
- `runtime.ts` 将模型、表情、物理、着色器预检查和纹理下载并行安排，纹理最多三路；只保存压缩字节，逐张解码并上传，避免同时持有八张完整 RGBA 位图。
- `model/v1` 的旧缓存规则未覆盖 `model/hikari_t001`。服务器现在让版本化模型命中一年缓存，并保留原有安全响应头。
- 实测最大 WebP 在再次打开时仍可能不命中 HTTP 缓存。最终版用 `hikari-textures-hikari_t002` Cache Storage 保存这一版纹理；不缓存 DEV 的其他模型路由。存储不可用或配额不足时继续使用网络结果；解码失败会移除相应缓存，供重试重新下载。
- 保留上游 PR #2/#3 的完整参数链分步计时、口型事件分发、可取消解码及 GPU 纹理所有权修复。
- 着色器正式加载保留在纹理解码之后；提前启动会使解码失败后的销毁与 SDK 未取消请求产生额外竞态。

服务器缓存配置示例（按自己的站点路径调整）：

```nginx
location ~ ^/Amahane_Hikari/(assets|model/(v[0-9]+|hikari_t[0-9]+)|vendor)/ {
    expires 1y;
    try_files $uri =404;
}
```

这里使用 `expires`，没有在该 location 新增会改变上层继承关系的 `add_header`。HTML 继续重新验证，健康文件不缓存。缓存规则只适用于内容不再修改的版本目录。

一次候选部署在 Nginx reload 后立即检查缓存头，未见新头而自动回滚。正则匹配已确认正确；证据支持新 worker 尚未接管的时序问题。后续版本用有限时长的新连接轮询确认配置生效，超时仍回滚，失败候选保留。

## 复现和验证边界

从仓库根目录执行，报告目录必须尚不存在：

```sh
node scripts/measure-load.mjs https://live2d.luomo.moe/Amahane_Hikari/ reports/load-run
node scripts/test-loading.mjs http://127.0.0.1:5188/Amahane_Hikari/ reports/loading-recovery
```

设置 `BROWSER_HTTP1=1` 可复现上表协议条件；`BROWSER_CHANNEL=msedge` 使用已安装的 Edge；`MEASURE_MBPS` 可另做节流实验，但不能和无节流样本混为同一条件。一次只运行一个网络测速，避免其他下载影响比较。

构建、35 项资产闭包、52 项控制器/运行时/资源检查和两组各 9 项真实 DOM 事件检查通过。本地 64 项页面检查通过。加载恢复覆盖 HTTP 503、错误图像、复访时阻断全部纹理网络以及存储配额不足：四种情况均通过，其中复访纹理网络请求为 0。最终公网在浏览器默认连接下 64 项交互检查通过、无资源或脚本错误；测试替身、真实 DOM 与真实模型画面分别保留边界。

模型制作的历史 Core、绑定和视觉证据继续见 [VALIDATION.md](VALIDATION.md)。本次没有重做原生绑定或重新验收 VTube Studio、摄像头和麦克风。

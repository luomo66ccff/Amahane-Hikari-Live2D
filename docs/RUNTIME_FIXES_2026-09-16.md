# PR #2 运行时修复说明（历史记录）

这份日期化文档对应 PR #2 的 `6ee34c5fdd866102d93b235a717ed01eef3e629c`，不是 PR #3 与当前主分支整合后的运行时规范。为避免两套时间步说明互相矛盾，当前实现、验证命令与边界统一见 [RUNTIME_FIXES.md](RUNTIME_FIXES.md)。

[PR #2 原始完整说明与测试环境记录](https://github.com/luomo66ccff/Amahane-Hikari-Live2D/blob/6ee34c5fdd866102d93b235a717ed01eef3e629c/docs/RUNTIME_FIXES_2026-09-16.md)保留在 Git 历史中。

历史版采用 100ms 长停顿上限、单独的原生物理分步、`frame-time.ts` 和 `decode-image.ts`。整合版采用 PR #3 的 250ms 上限、完整参数计算链分步、`frame-timing.ts` 和 `async-utils.ts`。旧资源清理场景已迁移到 `test:resources`，原有 `test:mouth-event` 命令继续可用。

历史版的 51 项本地运行时检查和旧发布的模型 PASS 记录不应当作本次整合版本的复测结果；请查看对应整合提交的 GitHub Actions。

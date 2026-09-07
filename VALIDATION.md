# 验证范围

## 可重复检查

- `node --test tests/*.test.js`：19 项测试，覆盖窗口稳定、冷却、候选歧义、输入状态、进程身份复用、手动恢复、失败处理、并发请求及退出清理。使用模拟窗口，不修改真实窗口。
- Renderer 和 Node 入口使用 esbuild 0.25.9 分别进行浏览器和 Node 构建，无 npm 运行时依赖。
- Windows PowerShell 5.1 使用 `Add-Type` 编译 `native/PetWindowAgent.cs`，检查 C# 与系统编译器的兼容性。

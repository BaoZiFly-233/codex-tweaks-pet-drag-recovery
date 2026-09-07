# Codex Tweaks Pet Drag Recovery

自动恢复 Windows 版 Codex 宠物浮窗的拖动和点击，并在设置页提供手动恢复入口。这是基于社区方法的第三方功能包。

## 功能

- 每 2 秒检查新出现的浮窗，在窗口稳定且鼠标松开后执行一次恢复。
- 可暂停自动恢复，或在同一窗口再次失去响应时点击“立即恢复”。
- 多个候选窗口时不操作；恢复失败或结果不明确时停止自动尝试并显示错误。

恢复时临时清除窗口的 `WS_EX_LAYERED` 样式，约 3 秒后恢复原始样式，期间可能短暂闪烁。自动操作至少间隔 30 秒，手动操作至少间隔 10 秒。

## 安装与使用

1. 在 Codex Tweaks 功能包页面通过 Git 安装 [本仓库](https://github.com/BaoZiFly-233/codex-tweaks-pet-drag-recovery)，选择已发布的 `v1.0.0` 标签；后续更新可使用 `latestSemverTag`。
2. 新安装的功能包默认未启用。阅读权限说明，完成宿主的 Node 授权并启用本包。
3. 打开宠物，松开鼠标并等待恢复完成，再拖动确认效果。
4. 在 Codex 设置的“宠物拖动恢复”页面查看状态、暂停自动恢复或手动恢复。显示等待窗口稳定或冷却结束时，稍后再试。

也可导入源码目录或 ZIP，确保 `package.json` 位于根目录或唯一的顶层目录内。停用和卸载通过 Codex Tweaks 功能包管理完成。

## 权限与数据

- **Renderer**：仅创建本包设置页，显示恢复状态、读取开关和按钮操作，不读取聊天内容。
- **Node**：启动隐藏的 Windows PowerShell 辅助进程，读取当前会话中进程身份、窗口属性、桌面可用性及鼠标按钮状态，调用 Windows 原生 API 临时调整匹配浮窗的样式。在宿主提供的本包私有数据目录中保存 `preferences.json`，记录自动恢复开关。Node 授权授予当前用户级完整代码执行能力。
- **网络**：无运行时网络请求，无 npm 依赖或安装脚本。

辅助进程通过互斥锁防止重复运行，通过临时窗口属性防止句柄复用导致误操作。停用本包、父进程退出或管道关闭时会恢复样式并退出；请通过宿主停用，直接强制结束辅助进程可能阻止样式恢复。

## 兼容性与限制

- Codex Tweaks API v3，使用 Node 后端和可选的 `settingsSections` API v1。缺少设置适配器时，自动恢复仍可运行，但手动设置页不可用。
- 目标平台为 Windows x64 和 Windows PowerShell 5.1；仅识别 WindowsApps 下 `OpenAI.Codex_…\app\ChatGPT.exe` 的可见浮窗。不支持 macOS/Linux，未验证 ARM64。
- 宠物与语音浮窗可能具有相同的窗口属性：多个候选时拒绝操作，唯一候选为语音浮窗时也可能处理它。使用语音浮窗时可暂停自动恢复。
- 仅在宿主连接并运行本包期间自动处理；窗口隐藏后重新出现、进程重启或窗口重建后可再次处理。
- 恢复方法依赖客户端的原生窗口样式，客户端更新可能影响效果。开发检查见 [VALIDATION.md](VALIDATION.md)。

## 开发

无需安装 npm 依赖，使用 Node.js 20 或更新版本运行测试：

```powershell
node --test tests/*.test.js
```

由 Codex Tweaks 编译两个入口并执行正常授权。手动检查构建时，esbuild 版本应与宿主锁定版本一致；以下以 0.25.9 为例：

```powershell
npx.cmd --yes esbuild@0.25.9 src/index.js --bundle --platform=browser --format=cjs --target=chrome120 --outfile=dist/renderer.cjs
npx.cmd --yes esbuild@0.25.9 src/node.js --bundle --platform=node --format=cjs --target=node20 --packages=external --outfile=dist/node.cjs
```

原生辅助程序由系统 PowerShell 的 `Add-Type` 编译，无需 .NET SDK。只读探测命令：

```powershell
powershell.exe -NoLogo -NoProfile -NonInteractive -File native/agent.ps1 -ParentProcessId $PID -Probe
```

## 参考

- [社区问题与恢复方法](https://github.com/openai/codex/issues/41513)
- [Codex Tweaks 功能包开发规范](https://github.com/codex-tweaks/codex-tweaks/blob/main/Skills/develop-codex-tweaks-package/SKILL.md)

## 许可证

[MIT](LICENSE)。

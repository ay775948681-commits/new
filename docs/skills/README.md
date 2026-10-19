# Superpowers Skills

来源：https://github.com/obra/superpowers

固定上游提交：`bb92a77741419a4ab5f06e711a283343f1ada0c3`

许可证：MIT，见 [SUPERPOWERS-LICENSE](SUPERPOWERS-LICENSE)。

## 录入内容

完整复制上游 `skills/` 下的 Skill、参考资料和配套脚本，未修改上游内容。

- [brainstorming](../../.agents/skills/brainstorming/SKILL.md)
- [diagnosing-superpowers](../../.agents/skills/diagnosing-superpowers/SKILL.md)
- [dispatching-parallel-agents](../../.agents/skills/dispatching-parallel-agents/SKILL.md)
- [executing-plans](../../.agents/skills/executing-plans/SKILL.md)
- [finishing-a-development-branch](../../.agents/skills/finishing-a-development-branch/SKILL.md)
- [receiving-code-review](../../.agents/skills/receiving-code-review/SKILL.md)
- [requesting-code-review](../../.agents/skills/requesting-code-review/SKILL.md)
- [subagent-driven-development](../../.agents/skills/subagent-driven-development/SKILL.md)
- [systematic-debugging](../../.agents/skills/systematic-debugging/SKILL.md)
- [test-driven-development](../../.agents/skills/test-driven-development/SKILL.md)
- [using-git-worktrees](../../.agents/skills/using-git-worktrees/SKILL.md)
- [using-superpowers](../../.agents/skills/using-superpowers/SKILL.md)
- [verification-before-completion](../../.agents/skills/verification-before-completion/SKILL.md)
- [writing-plans](../../.agents/skills/writing-plans/SKILL.md)
- [writing-skills](../../.agents/skills/writing-skills/SKILL.md)

## 使用

在支持仓库级 `.agents/skills/` 的 Codex 中打开本仓库的新会话，检查 Skills 列表后使用。
建议执行端使用 `receiving-code-review`、`systematic-debugging`，审核端使用
`requesting-code-review`、`verification-before-completion`。具体角色分工仍以用户指令为准。

本次为 Skill 文件录入，未安装完整 Superpowers 插件或自动启动钩子，未验证新会话自动发现，
也未验证 WorkBuddy 的加载目录或兼容性。完整 Codex 插件应通过官方插件市场安装。
不代表 GitHub PR 自动审核或 WorkBuddy 自动调度已经启用。

云任务使用当前已有 checkout；除非用户明确要求，不要创建 Git worktree。
Skill 中的工具、并行代理、分支和合并操作须遵守宿主能力及用户授权。

## 更新

从官方仓库选择明确提交，检查变更后替换已录入的 Skill 文件，并更新这里的提交号；保留许可证。
不要将克隆目录中的 `.git`、个人设置或凭据复制进来。

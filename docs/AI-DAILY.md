# 每日 AI 日报 → 个人微信

每天北京时间 09:00（UTC 01:00）由 GitHub Actions 运行。GitHub 定时任务可能延迟，不保证准点。

内容：过去24小时的官方 AI 新闻和 Codex、Claude Code、Ollama 发布动态，按时间排序最多8条。
原文标题与链接可能是英文；这是不需要模型 API 的版本，没有中文翻译或模型摘要。
某来源不可用会在日报中明确标记；全部来源不可用时任务失败，不推送空日报。

## 只需完成的配置

1. 在 https://www.pushplus.plus/ 按服务指引微信登录并绑定接收公众号，取得自己的推送 Token。
   查看当前服务支持的微信接收方式、消息额度及账号要求。
2. 在本 GitHub 仓库 Settings → Secrets and variables → Actions → New repository secret，
   名称填 `PUSHPLUS_TOKEN`，值填自己的 Token。不要提交到仓库或发在聊天中。
3. 将本分支合并到默认分支 `main`，定时触发只从默认分支运行。
4. 打开仓库 Actions → AI Daily to WeChat → Run workflow，手动试发一次，并在微信确认收到。

第三方推送服务会收到日报内容与推送 Token。服务接口成功只代表接受发送请求，不代表微信已送达。
公共仓库长期不活跃时 GitHub 可能停用定时任务；如停用，请在 Actions 中重新启用。

## 本地验证

```bash
python -m unittest discover -s tests -p test_ai_daily.py -v
python scripts/ai_daily.py --output /tmp/ai-daily-preview.html
```

发送使用 `python scripts/ai_daily.py --send`，从环境变量读取 Token。不要把 Token 写进命令参数。
脚本不依赖任何第三方 Python 包。

## 当前验证结果

已通过3项解析/日期窗口/转义测试，并实际生成日报。
当前 Codex 云环境可获取3个 GitHub 发布源，其他3个官网来源受当前网络策略限制。
GitHub Actions 网络环境不同，须以首次运行日志为准。未验证 PushPlus 请求或微信送达。

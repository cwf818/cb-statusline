# cb-statusline

CodeBuddy Code 自定义状态栏(statusline)脚本。

## 显示内容

一行输出，从左到右：

```
[模型] 项目名 ⎇分支 成本 ctx ch ↑输入↓输出 credit
```

| 段 | 含义 | 颜色 |
|---|---|---|
| `[模型]` | 当前模型 | 蓝 |
| `项目名` | 当前工作目录最后一段 | 黄 |
| `⎇ 分支` | Git 分支；dirty 时追加 `*` | 绿=clean / 橙=dirty |
| `$成本` | 会话累计成本 (USD) | 紫 |
| `ctx` | 上下文窗口大小 + 占用百分比 | 青 |
| `ch` | 缓存命中率 Σhit/Σprompt (逐调用汇总自 transcript) | ≥95 亮绿 / ≥90 绿 / ≥80 黄 / ≥60 橙 / 红 |
| `↑输入 ↓输出` | 会话累计 token | 紫 |
| `credit` | 账号剩余积分 (+ 到期天数) | 绿/黄/红(按到期紧迫度) |

## 部署

1. 将 `statusline.js` 复制到 `~/.codebuddy/`（`statusline.cmd` / `statusline.sh` 所在处）。
2. CodeBuddy 状态栏的 Status hook 会自动调用；无需重启。

## 积分缓存

积分查询走网络接口，带 5 分钟本地缓存（`~/.codebuddy/statusline-credits.json`）；缓存过期时在同进程内联刷新，2.5s 超时兜底，超时则显示暗灰 stale 数据。

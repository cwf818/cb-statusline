# cb-statusline

![License: MIT](https://img.shields.io/github/license/cwf818/cb-statusline)
![Stars](https://img.shields.io/github/stars/cwf818/cb-statusline)
![Version](https://img.shields.io/github/v/tag/cwf818/cb-statusline)
![Top language](https://img.shields.io/github/languages/top/cwf818/cb-statusline)
![Last commit](https://img.shields.io/github/last-commit/cwf818/cb-statusline)

CodeBuddy Code 自定义状态栏(statusline)脚本。

## 需求

最近领了 WorkBuddy 不少积分，其中刚好有常用的 DS Flash（速度很快） 和 GLM Flash（积分消耗少），也可以用一些免费的如 Hy3，CodeBuddy 在使用习惯上和 Claude Code 非常接近，所以就转过来用了。

但是习惯上如果看不到【Git状态、上下文状态、缓存命中率、Token速度和额度信息】，会不够自在，所以写了这个状态栏脚本，供 CodeBuddy 使用。

【Token速度】一直没有好的解决方案，目前实现了一个**实验性质**的基于 stdin payload 的版本，有 input 和网络延迟的干扰，目测可靠性尚可，但体感速度值（观察执行界面中的 token 状态）慢一半，比较两个模型差异应该还是能将就的，通过环境变量 `CB_STATUSLINE_EXPERIMENT_ON=1` 来控制开启。

## 显示内容

一行输出，从左到右：

```
[模型] 项目名 ⎇分支 ctx ch ↑输入↓输出 credit
```

| 段            | 含义                                              | 颜色                                     |
| ------------- | ------------------------------------------------- | ---------------------------------------- |
| `[模型]`      | 当前模型                                          | 蓝                                       |
| `项目名`      | 当前工作目录最后一段                              | 黄                                       |
| `⎇ 分支`      | Git 分支；dirty 时追加 `*`                        | 绿=clean / 橙=dirty                      |
| `ctx`         | 上下文占用 已用/总量, 按占用波段着色(先到为准)     | 青 / 黄 / 橙 / 亮红                     |
| `ch`          | 缓存命中率 Σhit/Σprompt (逐调用汇总自 transcript) | ≥95 亮绿 / ≥90 绿 / ≥80 黄 / ≥60 橙 / 红 |
| `↑输入 ↓输出` | 会话累计 token                                    | 紫                                       |
| `credit`      | 账号剩余积分 (+ 到期天数)                         | 绿/黄/红(按到期紧迫度)                   |

`ctx` 波段色：双条件先到为准取高档——已用占比 ≥50/60/70% 或已用绝对量 ≥100K/160K/260K 任一先达到，即进入对应档（黄/橙/亮红），两档都未到保持青色。

## 部署

1. 将 `statusline.js` 复制到 `~/.codebuddy/`（`statusline.cmd` / `statusline.sh` 所在处），然后让 CodeBuddy 把它配置为statusline（推荐）。或者，在 CodeBuddy 的 `~/.codebuddy/config.json` 中添加：

```json
"statusLine": {
  "_comment": "调用 statusline.js 脚本，也可以封装到statusline.cmd / statusline.sh 中调用",
  "command": "node /path/to/statusline.js",
  "type": "command",
  "padding": 0,
},
```

2. CodeBuddy 状态栏的 Status hook 会自动调用；无需重启。

## 积分缓存

积分查询走网络接口，带 5 分钟本地缓存（`~/.codebuddy/statusline-credits.json`）；缓存过期时在同进程内联刷新，2.5s 超时兜底，超时则显示暗灰 stale 数据。

## 安全

积分查询使用了 WorkBuddy 的 AuthToken 文件，不需要提供额外的 Cookie 或 Token，但要求安装 WorkBuddy。没有需求可以不用该功能。

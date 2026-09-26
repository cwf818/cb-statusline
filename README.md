# cb-statusline

![License: MIT](https://img.shields.io/github/license/cwf818/cb-statusline)
![Stars](https://img.shields.io/github/stars/cwf818/cb-statusline)
![Version](https://img.shields.io/github/v/tag/cwf818/cb-statusline)
![Top language](https://img.shields.io/github/languages/top/cwf818/cb-statusline)
![Last commit](https://img.shields.io/github/last-commit/cwf818/cb-statusline)

CodeBuddy Code 自定义状态栏(statusline)脚本。

## 需求

最近领了 WorkBuddy 不少积分，其中刚好有常用的 DS Flash（速度很快） 和 GLM Flash（积分消耗少），也可以用一些免费的如 Hy3，CodeBuddy 在使用习惯上和 Claude Code 非常接近，所以就转过来用了。

但是习惯上如果看不到【Git状态、上下文状态、缓存命中率、内存占用、Token速度和额度信息】，会不够自在，所以写了这个状态栏脚本，供 CodeBuddy 使用。

【Token速度】一直没有好的解决方案，目前实现了一个**实验性质**的基于 stdin payload 的版本，有 input 和网络延迟的干扰，目测可靠性尚可，但体感速度值（观察执行界面中的 token 状态）慢一半，比较两个模型差异应该还是能将就的，通过环境变量 `CB_STATUSLINE_EXPERIMENT_ON=1` 来控制开启。

## 显示内容

一行输出，从左到右：

```
[模型] 项目名 ⎇分支 ↑输入↓输出 ◔已用/总量 ◉命中率 ⬓内存 ✦总额度·最近到期天数（临期≤7天：✦总额度·最近到期额度·天数）
```

| 段               | 含义                                              | 颜色                                     |
| ---------------- | ------------------------------------------------- | ---------------------------------------- |
| `[模型]`         | 当前模型                                          | 蓝                                       |
| `项目名`         | 当前工作目录最后一段                              | 黄                                       |
| `⎇ 分支`         | Git 分支；dirty 时追加 `*`                        | 绿=clean / 橙=dirty                      |
| `↑输入 ↓输出`    | 会话累计 token                                    | 紫                                       |
| `◔◓◕⬤ 已用/总量` | 上下文占用, 图标即"水位表", 填充随占用档递增      | 青 / 黄 / 橙 / 亮红                      |
| `◉ 命中率`       | 缓存命中率 Σhit/Σprompt (逐调用汇总自 transcript) | ≥95 亮绿 / ≥90 绿 / ≥80 黄 / ≥60 橙 / 红 |
| `⬓内存`          | 系统 RAM 占用 `(total-free)/total`               | <60 亮绿 / 60-70 暗绿 / 70-80 黄 / 80-90 橙 / ≥90 红 |
| `✦ 额度`         | 通常为 `✦总额度·最近到期天数`；临期(≤7天)时展开为 `✦总额度·最近到期额度·天数` | >30天绿；≤30天黄；临期段红 |

额度段规则（`✦` 恒为段标识）：

| 情况                                 | 显示示例        | 颜色                          |
| ------------------------------------ | --------------- | ----------------------------- |
| 最近到期 >30 天                       | `✦3421·45d`     | 绿                            |
| 最近到期 8–30 天                      | `✦3421·20d`     | 黄                            |
| 无到期数据                             | `✦3421`         | 绿                            |
| ≤7 天，总额≠最近到期                   | `✦3421·1200·6d` | `✦总额度` 黄，`·额度·天数` 红 |
| ≤7 天，总额=最近到期（不重复显示总额度） | `✦1200·6d`      | 整段红（`✦` 归临期段）        |

`◔◓◕⬤` 水位表：填充面积随上下文占用档单调递增（25% → 50% → 75% → 100%），与下面的波段色同源。

上下文段波段色：双条件先到为准取高档——已用占比 ≥50/60/70% 或已用绝对量 ≥100K/160K/260K 任一先达到，即进入对应档（黄/橙/亮红），两档都未到保持青色。

内存段波段色：与 creditgauge 的 `m_memUsage` 同口径（`percentBands` 默认 `[60,70,80,90]` 的 5 档），档位按 RAM 占用百分比划分，阈值处归入较低危档。

各段图标统一选用 East Asian Width 为 `N`（窄）的字符，避免在中文终端下被渲染成 2 格宽而与相邻段错位。

着色按“词”下发：每个空格分隔的词都自带 `复位+色码+复位`。原因是状态行的两处渲染行为——

1. `TextWrapBox` 在状态行超宽时按空格切词换行，且不跨行重放 ANSI 色码。所以单段内含空格的着色（如 `↑2M ↓9.8K` / `⎇ master`）若恰好断在空格处，后一词落到新行就会丢色。
2. 状态行外层 `Text` 带 `dimColor`（Ink 在每行内容前插 `\x1b[2m`），而多数色码不以 `0` 开头（`\x1b[1;33m` / `\x1b[92m` / `\x1b[38;5;208m`…）清不掉 dim，于是**每行首个词**会被压暗一半（第二词起被前一词的复位救回）。词前补 `\x1b[0m` 即可清掉行首继承的 dim。

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

缓存按 token hash 分桶，条目带结构版本号（`v`）；版本不符（如脚本升级后遗留的旧结构）一律按过期处理并强制重取，避免出现"已临期但显示不出临期额度"的半截状态。

## 安全

积分查询直接使用环境变量中的 CODEBUDDY_AUTH_TOKEN，兜底使用 WorkBuddy 的 AuthToken 文件（需安装 WorkBuddy），不需要提供额外的 Cookie 或 Token。

Token 仅用于查询积分信息，仅发送到 Token 自带的签发域名（兜底为 codebuddy.cn），未发送到任何第三方。

单文件插件，若不放心可以先交给 AI 分析一下安全性。

```
 @statusline.js 对这个文件做一个简单的安全分析
```

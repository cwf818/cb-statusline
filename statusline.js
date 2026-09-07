#!/usr/bin/env node
// CodeBuddy Code statusline:
//   模型 + 目录 + Git + 成本 + 会话时长 + 上下文窗口(大小/占比) + 会话 token 量
// 由 statusline.cmd 经 node 调用; CodeBuddy 通过 stdin 传入会话 JSON。
"use strict";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let d = {};
  try { d = JSON.parse(input); } catch {}

  const model = (d.model && (d.model.display_name || d.model.id)) || "codebuddy";
  const dir = (d.workspace && (d.workspace.current_dir || d.workspace.project_dir)) || "";
  const cost = (d.cost && d.cost.total_cost_usd) || 0;
  const durMs = (d.cost && d.cost.total_api_duration_ms) || 0;
  const cw = d.context_window || {};

  // ANSI 颜色
  const BLUE = "\x1b[0;34m", GREEN = "\x1b[0;32m", YELLOW = "\x1b[1;33m";
  const CYAN = "\x1b[0;36m", MAGENTA = "\x1b[0;35m", BOLD = "\x1b[1m", NC = "\x1b[0m";

  // token 数格式化: 1234 -> 1.2K  2345678 -> 2.3M
  const fmtTok = (n) => {
    if (n == null || isNaN(n)) return "";
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
    return String(Math.round(n));
  };

  // 目录名(取最后一段)
  const dirName = dir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || dir;

  // Git 分支与脏状态
  let gitInfo = "";
  const { execSync } = require("child_process");
  try {
    execSync("git rev-parse --git-dir", { stdio: "ignore" });
    const branch = execSync("git branch --show-current", { encoding: "utf8" }).trim();
    if (branch) {
      let b = branch;
      try { execSync("git diff-index --quiet HEAD --", { stdio: "ignore" }); } catch { b += "*"; }
      gitInfo = ` ${GREEN}\u2387${NC} ${YELLOW}${b}${NC}`;
    }
  } catch {}

  // 会话成本(>0 时显示)
  let costInfo = "";
  if (cost > 0) costInfo = ` ${MAGENTA}$${Number(cost).toFixed(4)}${NC}`;

  // 会话时长(>0 时显示)
  let durInfo = "";
  if (durMs > 0) durInfo = ` ${CYAN}${Math.floor(durMs / 1000)}s${NC}`;

  // 上下文窗口: 大小 + 占用百分比 (有窗口大小时才显示)
  let ctxInfo = "";
  const win = cw.context_window_size;
  if (win > 0) {
    let pct = "";
    if (cw.used_percentage != null) pct = ` ${Math.round(cw.used_percentage)}%`;
    ctxInfo = ` ${CYAN}ctx ${fmtTok(win)}${pct}${NC}`;
  }

  // 会话累计 token (total_input 含缓存读+写)
  const tIn = cw.total_input_tokens || 0;
  const tOut = cw.total_output_tokens || 0;

  // 会话缓存命中率 ch = cr/(净in+cr), 口径与 cmc-proxy vislog 一致
  // total_input_tokens 含缓存: 净in = total - cacheRead - cacheWrite
  let hitInfo = "";
  const cr = (cw.current_usage && cw.current_usage.cache_read_input_tokens) || 0;
  const cwr = (cw.current_usage && cw.current_usage.cache_creation_input_tokens) || 0;
  if (cr > 0) {
    const netIn = Math.max(0, tIn - cr - cwr);
    const ch = (cr / (cr + netIn)) * 100;
    // 命中率波段色 (与 vislog hitRateColor 同档): >=95 亮绿 / >=90 绿 / >=80 黄 / >=60 橙 / 红
    const c = ch >= 95 ? "\x1b[92m" : ch >= 90 ? GREEN : ch >= 80 ? YELLOW : ch >= 60 ? "\x1b[38;5;208m" : "\x1b[0;31m";
    hitInfo = ` ${c}ch ${ch.toFixed(1)}%${NC}`;
  }

  // 会话 token 量: 累计输入↓ / 输出↑(含生成速度 tps = 累计输出 / API 时长)
  let tokInfo = "";
  if (tIn > 0 || tOut > 0) {
    let tps = "";
    if (durMs > 0 && tOut > 0) {
      const v = tOut / (durMs / 1000);
      // <10 最多一位小数, >=10 取整
      const s = v >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
      tps = `(${s}tps)`;
    }
    tokInfo = ` ${MAGENTA}\u2193${fmtTok(tIn)} \u2191${fmtTok(tOut)}${tps}${NC}`;
  }

  process.stdout.write(`${BLUE}[${model}]${NC} ${GREEN}${dirName}${NC}${gitInfo}${costInfo}${durInfo}${ctxInfo}${hitInfo}${tokInfo}\n`);
});

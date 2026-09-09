#!/usr/bin/env node
// CodeBuddy Code statusline:
//   模型 + 目录 + Git + 上下文窗口(已用/总量) + 会话 token 量 + 账号积分
//   + 缓存命中率 ch (逐调用汇总自 transcript, 见 transcriptCacheStats)
// 由 statusline.cmd 经 node 调用; CodeBuddy 通过 stdin 传入会话 JSON。
// 积分段: 读本地缓存(5min TTL), 过期时同进程内联刷新(2.5s 超时兜底)。
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");

// ---------------------------------------------------------------------------
// 账号积分: 从 WorkBuddy 登录态文件取 token, 调 billing 接口查剩余积分与到期
// ---------------------------------------------------------------------------
const CREDITS_CACHE = path.join(os.homedir(), ".codebuddy", "statusline-credits.json");
const CREDITS_TTL = 5 * 60 * 1000;
const AUTH_FILE = path.join(os.homedir(), "AppData", "Local", "CodeBuddyExtension", "Data", "Public", "auth", "workbuddy-desktop.info");
// 商品码与 workbuddy-switch 同源: 前 5 个为免费包, 后 6 个为付费包
const FREE_PACKAGE_CODES = ["TCACA_code_008_cfWoLwvjU4", "TCACA_code_007_nzdH5h4Nl0", "TCACA_code_028_NtpWi0jzXs", "TCACA_code_029_6wCGEWquYy", "TCACA_code_030_BjSt89qTvr"];
const PAID_PACKAGE_CODES = ["TCACA_code_002_AkiJS3ZHF5", "TCACA_code_023_4xbGhMrE6q", "TCACA_code_026_BaESVICNoi", "TCACA_code_027_0FCGVA6vSa", "TCACA_code_009_0XmEQc2xOf", "TCACA_code_038_OhvqZtiPKr"];
// 实验: 生成速度估算的会话级状态 (由 CB_STATUSLINE_EXPERIMENT_ON 启用)
const SPEED_STATE_FILE = path.join(os.homedir(), ".codebuddy", "statusline-speed.json");

function httpPost(url, headers, body) {
  return new Promise((resolve) => {
    try {
      const req = https.request(url, { method: "POST", headers: { ...headers, "Content-Length": Buffer.byteLength(body) } }, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve(d));
      });
      req.on("error", () => resolve(""));
      req.setTimeout(8000, () => { req.destroy(); resolve(""); });
      req.end(body);
    } catch { resolve(""); }
  });
}

// 剩余积分: 多字段候选 (字符串数值), 与 workbuddy-switch credits.rs 同口径
function pkgRemain(p) {
  const v = p.CycleCapacityRemainPrecise ?? p.CycleCapacityRemain ?? p.CapacityRemainPrecise ?? p.CapacityRemain;
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}
// 到期时间: 毫秒/秒时间戳或日期字符串, 统一转毫秒
function pkgExpire(p) {
  const v = p.DeductionEndTime ?? p.deductionEndTime ?? p.ExpiredTime ?? p.expiredTime ?? p.CycleEndTime;
  if (v == null) return null;
  if (typeof v === "number" || /^\d+$/.test(String(v).trim())) {
    let n = +v;
    if (n < 1e12) n *= 1000; // 秒→毫秒
    return isNaN(n) ? null : n;
  }
  const t = Date.parse(String(v).replace(" ", "T"));
  return isNaN(t) ? null : t;
}

async function fetchCredits() {
  if (!fs.existsSync(AUTH_FILE)) return;
  let j;
  try { j = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8")); } catch { return; }
  const a = j.auth || j;
  const token = a.accessToken || a.access_token;
  if (!token) return;
  const uid = (j.account && j.account.uid) || j.uid || "";
  const domain = a.domain || j.domain || "";
  // token 签发域决定 base (X-Domain 不一致会被网关拒)
  const base = domain.includes("workbuddy.cn") ? "https://www.workbuddy.cn" : "https://www.codebuddy.cn";
  const headers = {
    "Authorization": `Bearer ${token}`,
    "X-User-Id": uid,
    "X-Domain": domain,
    "X-Client-Platform": "web",
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
  const now = new Date();
  const s = new Date(now); s.setHours(0, 0, 0, 0);
  const e = new Date(now); e.setHours(23, 59, 59, 999);
  const f = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")} ${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}:${String(x.getSeconds()).padStart(2, "0")}`;
  const [freeR, paidR] = await Promise.all([
    httpPost(base + "/billing/meter/get-user-resource-free-packages", headers, JSON.stringify({ PageNumber: 1, PageSize: 200, Status: [0, 3], SlicePeriodStartTime: f(s), SlicePeriodEndTime: f(e), PackageCodes: FREE_PACKAGE_CODES })),
    httpPost(base + "/billing/meter/get-user-resource-paid-packages", headers, JSON.stringify({ PageNumber: 1, PageSize: 200, Status: [0, 3], PackageCodes: PAID_PACKAGE_CODES, NeedRenewInfo: true })),
  ]);
  const pick = (txt) => {
    try {
      const o = JSON.parse(txt);
      if (!(o.code === 0 || o.code === 200)) return [];
      const d = o.data || {};
      return d.Accounts || d.accounts || [];
    } catch { return []; }
  };
  const recs = [...pick(freeR), ...pick(paidR)];
  if (!recs.length) return;
  let remain = 0, expireAt = null;
  for (const p of recs) {
    const r = pkgRemain(p);
    if (r <= 0) continue;
    remain += r;
    const ex = pkgExpire(p);
    if (ex && ex > Date.now() && (expireAt == null || ex < expireAt)) expireAt = ex;
  }
  try { fs.writeFileSync(CREDITS_CACHE, JSON.stringify({ ts: Date.now(), remain: +remain.toFixed(1), expireAt })); } catch {}
}

// ---------------------------------------------------------------------------
// 缓存命中率: 从 transcript 逐调用汇总 (数据源实测结论 2026-09-07):
//   - context_window.current_usage 是"最近一次调用"用量而非会话累计, 差分法不可行
//   - cost.total_api_duration_ms 在 /clear 后冻结不变, 不能算 tps
//   - transcript 每调用 rawUsage 自洽: prompt_cache_hit + prompt_cache_miss = prompt_tokens
//   ch = Σhit / Σprompt (transcript 即账本, 天然含 7 天内的全部调用, 无需自建存储)
// ---------------------------------------------------------------------------
function transcriptCacheStats(p) {
  try {
    const raw = fs.readFileSync(p, "utf8");
    // CodeBuddy transcript 为拼接 JSON 对象流(非 JSONL/数组), 字符串感知括号配平逐个提取
    let sumHit = 0, sumPrompt = 0;
    let depth = 0, start = -1, inStr = false, esc = false;
    const handle = (s) => {
      try {
        const e = JSON.parse(s);
        const ru = e.providerData && e.providerData.rawUsage;
        if (ru && ru.prompt_tokens != null) {
          sumPrompt += ru.prompt_tokens || 0;
          sumHit += ru.prompt_cache_hit_tokens || 0;
        }
      } catch {}
    };
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === "{") { if (depth === 0) start = i; depth++; }
      else if (c === "}") { depth--; if (depth === 0 && start >= 0) { handle(raw.slice(start, i + 1)); start = -1; } }
    }
    return { hit: sumHit, prompt: sumPrompt };
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// 实验: 生成速度估算 (env CB_STATUSLINE_EXPERIMENT_ON=1 启用)
//   按 session_id 持久化记账, 单条记录字段:
//     total_output_tokens / total_api_duration_ms  = 上次有效观测的累计值 (基线)
//     session_total_api_duration_ms                 = 合格 Δapi 的累计 (初值 0)
//     init_total_output_tokens                      = 建账时的 total_output_tokens, 之后不变
//     ts                                             = 最近一次更新时间戳
//   TTL 24h: 记录缺失或超时都视为不存在。
//   每观测一次:
//     不存在   -> 仅建账: 基线=当前值, session_total_api_duration_ms=0,
//                init_total_output_tokens=当前 total_output_tokens
//     已存在   -> 仅当 Δout>0 且 Δapi>0 时同时前移两基线并刷新 ts;
//                若再满足 Δout*1000/Δapi > 1 (token/s, ms 归一为秒) 则
//                session_total_api_duration_ms += Δapi。
//   显示 tps = (当前 total_output_tokens - init_total_output_tokens) * 1000
//                / session_total_api_duration_ms。
//   返回 null 表示暂无值可显示 (未建账/无累计时长/无新增输出)。
// ---------------------------------------------------------------------------
const SPEED_TTL = 24 * 3600 * 1000;
function calcSpeedTps(d) {
  const sid = d.session_id;
  const cw = d.context_window || {};
  const cost = d.cost || {};
  const out = cw.total_output_tokens || 0;
  const api = cost.total_api_duration_ms;
  if (!sid || typeof api !== "number" || !isFinite(api)) return null;
  let st = null;
  try { st = JSON.parse(fs.readFileSync(SPEED_STATE_FILE, "utf8")); } catch {}
  if (!st || typeof st !== "object") st = {};
  const now = Date.now();
  const rec = st[sid];
  if (!rec || typeof rec.ts !== "number" || now - rec.ts >= SPEED_TTL || typeof rec.init_total_output_tokens !== "number") {
    // 不存在或 TTL 过期: 仅建账
    st[sid] = {
      total_output_tokens: out,
      total_api_duration_ms: api,
      session_total_api_duration_ms: 0,
      init_total_output_tokens: out,
      ts: now,
    };
    try { fs.writeFileSync(SPEED_STATE_FILE, JSON.stringify(st)); } catch {}
    return null;
  }
  const dOut = out - rec.total_output_tokens;
  const dApi = api - rec.total_api_duration_ms;
  if (dOut > 0 && dApi > 0) {
    // 有效观测段: 基线前移 + 刷新 ts; s>1 (token/s) 才累计时长
    rec.total_output_tokens = out;
    rec.total_api_duration_ms = api;
    rec.ts = now;
    if ((dOut * 1000) / dApi > 1) rec.session_total_api_duration_ms += dApi;
    try { fs.writeFileSync(SPEED_STATE_FILE, JSON.stringify(st)); } catch {}
  }
  const acc = rec.session_total_api_duration_ms || 0;
  const gained = out - rec.init_total_output_tokens;
  if (acc > 0 && gained > 0) return (gained * 1000) / acc;
  return null;
}

// 入口: 内联刷新模式 (不再派生子进程 — CodeBuddy 会在 statusline 进程退出时
// 清理其子进程, detached 子进程活不到写完缓存)
runStatusline();

function runStatusline() {
  // 实验开关: 设了 CB_STATUSLINE_EXPERIMENT_ON 才启用 stdin 落盘与速度估算
  const EXPERIMENT_ON = !!process.env.CB_STATUSLINE_EXPERIMENT_ON;
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (input += chunk));
  process.stdin.on("end", async () => {
    // 调试: 原始 stdin 落盘
    if (EXPERIMENT_ON) {
      try { fs.writeFileSync(path.join(os.homedir(), ".codebuddy", "statusline-stdin.json"), input); } catch {}
    }
    let d = {};
    try { d = JSON.parse(input); } catch {}

    const model = (d.model && (d.model.display_name || d.model.id)) || "codebuddy";
    const dir = (d.workspace && (d.workspace.current_dir || d.workspace.project_dir)) || "";
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
    // 项目名用 YELLOW = 现在 ch 的颜色 (实测命中率黄档)

    // Git 分支与脏状态: 整段(⎇ + 分支名 + *)统一着色 — 绿=clean / 橙=dirty
    const ORANGE = "\x1b[38;5;208m";
    let gitInfo = "";
    const { execSync } = require("child_process");
    try {
      execSync("git rev-parse --git-dir", { stdio: "ignore" });
      const branch = execSync("git branch --show-current", { encoding: "utf8" }).trim();
      if (branch) {
        let dirty = false;
        try { execSync("git diff-index --quiet HEAD --", { stdio: "ignore" }); } catch { dirty = true; }
        gitInfo = ` ${dirty ? ORANGE : GREEN}\u2387 ${branch}${dirty ? "*" : ""}${NC}`;
      }
    } catch {}

    // 上下文窗口: 已用/总量, 按占用波段着色 (无占用数据时只显示窗口大小)
    //   波段双条件"先到为准"取高档: 已用占比 ≥50/60/70%  或  已用绝对量 ≥100K/160K/260K
    //   颜色: 1档黄(同 credit) / 2档橙(同 git dirty) / 3档亮红
    const CTX_RED = "\x1b[38;5;203m"; // 3档: 亮红但饱和度略低 (可换成 196 纯亮红或 91)
    let ctxInfo = "";
    const win = cw.context_window_size;
    if (win > 0) {
      let ut = fmtTok(win);
      let col = CYAN;
      if (cw.used_percentage != null) {
        const used = Math.round(win * cw.used_percentage / 100);
        ut = `${fmtTok(used)}/${fmtTok(win)}`;
        const tier = Math.max(
          cw.used_percentage >= 70 ? 3 : cw.used_percentage >= 60 ? 2 : cw.used_percentage >= 50 ? 1 : 0,
          used >= 260000 ? 3 : used >= 160000 ? 2 : used >= 100000 ? 1 : 0,
        );
        if (tier === 3) col = CTX_RED;
        else if (tier === 2) col = ORANGE;
        else if (tier === 1) col = YELLOW;
      }
      ctxInfo = ` ${col}ctx ${ut}${NC}`;
    }

    // 会话累计 token (total_input 含缓存读+写)
    const tIn = cw.total_input_tokens || 0;
    const tOut = cw.total_output_tokens || 0;

    // 缓存命中率 ch = Σ命中/Σ输入, 逐调用汇总自 transcript (精确口径)
    // 波段色 (与 vislog hitRateColor 同档): >=95 亮绿 / >=90 绿 / >=80 黄 / >=60 橙 / 红
    const chColor = (v) => v >= 95 ? "\x1b[92m" : v >= 90 ? GREEN : v >= 80 ? YELLOW : v >= 60 ? "\x1b[38;5;208m" : "\x1b[0;31m";
    let hitInfo = "";
    const cs = d.transcript_path ? transcriptCacheStats(d.transcript_path) : null;
    if (cs && cs.prompt > 0) {
      const ch = (cs.hit / cs.prompt) * 100;
      hitInfo = ` ${chColor(ch)}ch ${ch.toFixed(1)}%${NC}`;
    }

    // 会话 token 量: 累计输入↑ / 输出↓; 实验开关下在输出后追加估算速度 @Ntps
    let tpsStr = "";
    if (EXPERIMENT_ON) {
      const tps = calcSpeedTps(d);
      if (tps != null && Math.round(tps) >= 1) tpsStr = `@${Math.round(tps)}tps`;
    }
    const tokInfo = tIn > 0 || tOut > 0 ? ` ${MAGENTA}\u2191${fmtTok(tIn)} \u2193${fmtTok(tOut)}${tpsStr}${NC}` : "";

    // 账号积分段: 读缓存; 缓存过期则内联刷新 (2.5s 超时兜底)
    //   刷新成功 -> 正常色 (到期紧迫度: <=7天 红 / <=30天 黄 / 其余 绿)
    //   超时     -> 用已缓存数据, 暗灰色 + 数据过期时长 (·stale Nm)
    //   无缓存   -> 不显示
    const GRAY = "\x1b[90m";
    const readCache = () => { try { return JSON.parse(fs.readFileSync(CREDITS_CACHE, "utf8")); } catch { return null; } };
    const fresh = (c) => c && c.ts && Date.now() - c.ts < CREDITS_TTL && c.remain != null;
    let cache = readCache();
    if (!fresh(cache)) {
      await Promise.race([fetchCredits(), new Promise((r) => setTimeout(r, 2500))]);
      cache = readCache();
    }
    let credInfo = "";
    if (cache && cache.remain != null) {
      if (fresh(cache)) {
        const days = cache.expireAt ? Math.ceil((cache.expireAt - Date.now()) / 86400000) : null;
        const col = days != null && days <= 7 ? "\x1b[0;31m" : days != null && days <= 30 ? YELLOW : GREEN;
        credInfo = ` ${col}credit ${Math.round(cache.remain)}${days != null ? `·${days}d` : ""}${NC}`;
      } else {
        // stale: 数据过期时长 (缓存抓取时间距今)
        const age = Date.now() - cache.ts;
        const ageStr = age >= 3600000 ? `${Math.floor(age / 3600000)}h` : age >= 60000 ? `${Math.floor(age / 60000)}m` : `${Math.floor(age / 1000)}s`;
        credInfo = ` ${GRAY}credit ${Math.round(cache.remain)}·${ageStr}${NC}`;
      }
    }

    process.stdout.write(`${BLUE}[${model}]${NC} ${YELLOW}${dirName}${NC}${gitInfo}${ctxInfo}${hitInfo}${tokInfo}${credInfo}\n`);
  });
}

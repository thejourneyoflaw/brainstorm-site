import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

export const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

export function loadEnv() {
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// 渠道优先级：某个渠道余额/额度用尽会自动切到下一个（实测可用的排前面）
const ORDER = ['OPENCODE_GO', 'SENSENOVA', 'BIGMODEL', 'DEEPSEEK'];

export function listProviders() {
  loadEnv();
  return ORDER.map(name => ({
    name,
    key: process.env[`${name}_API_KEY`] || '',
    base: (process.env[`${name}_BASE_URL`] || '').replace(/\/+$/, ''),
    model: process.env[`${name}_MODEL`] || '',
  })).filter(p => p.key && p.base && p.model);
}

function extractJSON(text) {
  text = String(text).trim();
  if (text.startsWith('```')) text = text.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s >= 0 && e > s) text = text.slice(s, e + 1);
  return text;
}

// 模型偶尔在字符串值里漏转义英文双引号，这里按"引号后不是 JSON 结构符 → 视为字符串内引号"启发式修复
function repairJSON(text) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!inStr) {
      out += ch;
      if (ch === '"') inStr = true;
      continue;
    }
    if (ch === '\\') { out += ch + (text[i + 1] ?? ''); i++; continue; }
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      const nxt = text[j];
      if (nxt && !',:}]'.includes(nxt)) { out += '\\"'; continue; }
      out += ch;
      inStr = false;
      continue;
    }
    out += ch;
  }
  return out.replace(/,\s*([}\]])/g, '$1');
}

// 输出被 max_tokens 截断时，把数组里已经完整的对象抢救出来（比整批丢弃强）
function salvageObjects(text, key) {
  const k = text.indexOf(`"${key}"`);
  if (k < 0) return null;
  const start = text.indexOf('[', k);
  if (start < 0) return null;
  const objs = [];
  let depth = 0, inStr = false, esc = false, objStart = -1;
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') { if (depth === 0) objStart = i; depth++; continue; }
    if (ch === '}') {
      depth--;
      if (depth === 0 && objStart >= 0) { objs.push(text.slice(objStart, i + 1)); objStart = -1; }
    }
  }
  if (!objs.length) return null;
  const parsed = [];
  for (const o of objs) {
    try { parsed.push(JSON.parse(o)); }
    catch { try { parsed.push(JSON.parse(repairJSON(o))); } catch { /* 截断的那条丢掉 */ } }
  }
  return parsed.length ? { [key]: parsed, __salvaged: objs.length - parsed.length } : null;
}

function parseModelJSON(text) {
  const raw = extractJSON(text);
  try { return JSON.parse(raw); } catch { /* 继续尝试修复 */ }
  try { return JSON.parse(repairJSON(raw)); } catch { /* 继续尝试抢救截断内容 */ }
  const salvaged = salvageObjects(raw, 'ideas') || salvageObjects(raw, 'judged');
  if (salvaged) {
    if (salvaged.__salvaged) console.warn(`  ⚠ 输出被截断，抢救出 ${(salvaged.ideas || salvaged.judged || []).length} 条完整条目`);
    return salvaged;
  }
  throw new Error('JSON 解析失败（内容为空或被截断）');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const NO_JSON_MODE = new Set(); // 某些渠道不支持 response_format=json_object
const failures = new Map();     // 渠道连续失败次数：不稳的渠道自动沉到后面
const dead = new Map();         // 额度/权限暂时不可用的渠道 → 拉黑时间戳（5 分钟后允许再试）
const DEAD_TTL = 5 * 60 * 1000;
const MAX_TOKENS_CAP = { BIGMODEL: 32000, OPENCODE_GO: 32000 }; // 各渠道单次输出上限（未列的按 8000 保守处理，避免截断）
const TIMEOUT_MS = { BIGMODEL: 150000, OPENCODE_GO: 150000 };    // 各渠道单次请求超时（未列的按 90s）——卡住就快速换渠道
let preferred = null;           // 记住本轮成功的渠道，后续调用优先走它
export const llmState = { provider: null }; // 最近一次成功的渠道名（用于记录/复核回退说明）

// 判断错误是否属于"这个渠道本轮别用了"
function isFatal(e) {
  if (e.status && [400, 401, 402, 403, 404].includes(e.status)) return true;
  return /insufficient_quota|quota_exceeded|Insufficient Balance|usage limit|rate limit for free users/i.test(String(e.message || ''));
}

// 渠道临时拉黑（额度类错误），5 分钟后自动放行再试
function isDead(name) {
  const t = dead.get(name);
  if (!t) return false;
  if (Date.now() - t > DEAD_TTL) { dead.delete(name); return false; }
  return true;
}
// OpenCode Zen 需要会话标识才能路由
const OPENCODE_SESSION = process.env.OPENCODE_GO_SESSION || ('ideadaily-' + Math.random().toString(36).slice(2, 12));

async function callOnce(p, { system, user, maxTokens, temperature }) {
  const build = (withJsonMode) => {
    const body = {
      model: p.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature,
      max_tokens: Math.min(maxTokens, MAX_TOKENS_CAP[p.name] || 8000),
    };
    if (withJsonMode && !NO_JSON_MODE.has(p.name)) body.response_format = { type: 'json_object' };
    return body;
  };
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` };
  if (p.name === 'OPENCODE_GO') headers['x-opencode-session'] = OPENCODE_SESSION;
  const post = body => fetch(p.base + '/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS[p.name] || 150000),
  });

  let res = await post(build(true));
  if (res.status === 400 && !NO_JSON_MODE.has(p.name)) {
    const t = (await res.text()).slice(0, 300);
    if (/response_format|json_object/i.test(t)) {
      NO_JSON_MODE.add(p.name); // 该渠道不支持 json 模式，去掉重试一次
      res = await post(build(false));
    } else {
      const err = new Error(`HTTP 400: ${t}`);
      err.status = 400;
      throw err;
    }
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  return parseModelJSON(text);
}

export async function chatJSON({ system, user, maxTokens = 8000, temperature = 1.1 }) {
  const all = listProviders();
  if (!all.length) throw new Error('没有可用渠道，检查 .env');
  // LLM_PREFER=BIGMODEL,SENSENOVA 可指定优先顺序（用逗号分隔），未列出的作为后备
  const preferList = (process.env.LLM_PREFER || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const list = [...all].sort((a, b) => {
    const ia = preferList.indexOf(a.name), ib = preferList.indexOf(b.name);
    if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    if (preferred) {
      if (a.name === preferred) return -1;
      if (b.name === preferred) return 1;
    }
    const da = isDead(a.name) ? 999 : 0;
    const db = isDead(b.name) ? 999 : 0;
    return (da + (failures.get(a.name) || 0)) - (db + (failures.get(b.name) || 0));
  });
  let lastErr;
  for (const p of list) {
    if (isDead(p.name)) continue;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        // 第二次尝试把输出预算翻倍：推理模型经常把预算耗在思考上导致"空内容"
        const out = await callOnce(p, { system, user, maxTokens: maxTokens * attempt, temperature: temperature + (attempt - 1) * 0.15 });
        if (preferred !== p.name) preferred = p.name;
        llmState.provider = p.name;
        failures.set(p.name, 0);
        return out;
      } catch (e) {
        lastErr = e;
        failures.set(p.name, (failures.get(p.name) || 0) + 1);
        const fatal = isFatal(e);
        console.warn(`  [${p.name}] 第 ${attempt} 次失败: ${e.message}${fatal ? '（本轮跳过该渠道）' : ''}`);
        if (fatal) { dead.set(p.name, Date.now()); break; }
        if (attempt < 2) await sleep(1200 * attempt);
      }
    }
    if (preferred === p.name) preferred = null;
  }
  throw lastErr;
}

// 独立的异模型终审通道：agnes（Anthropic Messages 协议），与生成渠道不同源，避免自卖自夸
export async function reviewJSON({ system, user, maxTokens = 4000, temperature = 0.2 }) {
  loadEnv();
  const key = process.env.AGNES_API_KEY;
  const base = (process.env.AGNES_BASE_URL || 'https://apihub.agnes-ai.com/v1').replace(/\/+$/, '');
  const model = process.env.AGNES_REVIEW_MODEL || 'agnes-2.0-flash';
  if (key) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const res = await fetch(base + '/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({ model, max_tokens: maxTokens, temperature, system, messages: [{ role: 'user', content: user }] }),
          signal: AbortSignal.timeout(120000),
        });
        if (!res.ok) {
          const err = new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
          err.status = res.status;
          throw err;
        }
        const data = await res.json();
        const text = (data.content || []).filter(c => c?.type === 'text').map(c => c.text).join('\n');
        return { data: parseModelJSON(text), model, fallback: false };
      } catch (e) {
        console.warn(`  [终审 ${model}] 第 ${attempt} 次失败: ${e.message}`);
        if (attempt < 4) await sleep(8000 * attempt); // agnes 免费档限流较紧，短退避重试后回退主渠道
      }
    }
  }
  // 终审通道不可用时退回主渠道，并标明这是回退（保证当天不空转）
  const data = await chatJSON({ system, user, maxTokens, temperature });
  return { data, model: `回退:${llmState.provider || '主渠道'}`, fallback: true };
}

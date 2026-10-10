// 前沿关注历史回溯：用搜狗微信搜索按热词捞 9/1-10/8 期间 8 个目标号的文章
// 用法：node backfill-frontier.mjs
// 流程：多关键词搜索(-n 50) → 按来源+日期过滤 → 解析真实链接 → 抓正文 → 批量 AI 分析 → 写入各日期的 frontier 文件
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { chatJSON, loadEnv } from './lib/llm.mjs';

loadEnv();
const ROOT = process.cwd();
const DATA = path.join(ROOT, 'data');
const SEARCH_SCRIPT = process.env.FRONTIER_SEARCH_SCRIPT || 'C:/Users/Shen longfei/.agents/skills/wechat-article-search/scripts/search_wechat.js';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
const TARGETS = ['数字生命卡兹克', '逛逛GitHub', 'GitHubDaily', 'Datawhale', '机器之心', '苍何', 'AI寒武纪', '程序员小灰'];
const QUERIES = (process.env.FRONTIER_BACKFILL_QUERIES || 'AI,大模型,Claude,GPT,OpenAI,开源项目,编程,效率工具').split(',').map(s => s.trim()).filter(Boolean);
const DATE_FROM = '2026-09-01', DATE_TO = '2026-10-08';
const MAX_ARTICLES = 30; // 最多回溯多少篇（控制 AI 分析成本与时长）

const sleep = ms => new Promise(r => setTimeout(r, ms));
const fetchTxt = (url, ms = 45000) => fetch(url, { headers: { 'User-Agent': UA, 'Referer': 'https://weixin.sogou.com/' }, signal: AbortSignal.timeout(ms) });

function runSearch(query, n) {
  return new Promise((resolve) => {
    execFile('node', [SEARCH_SCRIPT, query, '-n', String(n)], {
      cwd: ROOT, timeout: 180000,
      env: { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules') },
    }, (err, stdout) => {
      if (err) { console.warn(`  搜索「${query}」失败: ${String(err.message).slice(0, 80)}`); return resolve([]); }
      try {
        const j = JSON.parse(stdout.slice(stdout.indexOf('{')));
        resolve(j.articles || []);
      } catch (e) { console.warn(`  搜索「${query}」解析失败`); resolve([]); }
    });
  });
}

// 解析搜狗中转链 → 真实链接
async function resolveSogou(sogouUrl) {
  try {
    const res = await fetchTxt(sogouUrl);
    const html = await res.text();
    const frags = [...html.matchAll(/url \+= '([^']*)'/g)].map(m => m[1]);
    const real = frags.join('');
    return real.startsWith('http') ? real : '';
  } catch { return ''; }
}

async function fetchArticle(url) {
  try {
    const res = await fetchTxt(url, 40000);
    const html = await res.text();
    const pick = (re) => { const m = html.match(re); return m ? m[1] : ''; };
    const title = pick(/property="og:title" content="([^"]+)"/);
    const account = (pick(/id="js_name"[^>]*>\s*([^<]+?)\s*</) || pick(/var nickname = "([^"]+)"/)).trim();
    const ct = pick(/var ct = "(\d+)"/);
    let text = '';
    const seg = html.split('id="js_content"')[1];
    if (seg) {
      text = seg.split('<script')[0].replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3200);
    }
    return { title: title.slice(0, 120), account, publishTime: ct ? Number(ct) : 0, text };
  } catch { return null; }
}

const ANALYSIS_SYSTEM = `你是"前沿关注"栏目的分析师。读者：法务从业者，懂商务/金融/经济，能读英文技术资料，长期关注 AI 前沿。
输出约定：严格 JSON；字符串值内禁止英文双引号，引用一律用「」；digest 第一句写清是谁、做了什么，禁止悬空指代。`;

async function analyzeBatch(batch) {
  const payload = batch.map((a, i) => ({ i, account: a.account, title: a.title, content: (a.text || a.summary || '').slice(0, 3000) }));
  const data = await chatJSON({
    system: ANALYSIS_SYSTEM, temperature: 0.6, maxTokens: 8000,
    user: `# 待分析文章\n${JSON.stringify(payload)}\n\n# 任务\n逐篇输出：digest「讲了什么」180~260 字（第一句写清是谁、发布/做了什么，保留关键数字）；significance「有什么意义」100~160 字（对行业+对读者的法务/金融视角各点一句）；applications「可以有什么应用」2 条（结合读者的法律、金融、英语与技术背景，具体可操作）；tags 1~3 个。\nitems 必须恰好 ${batch.length} 个元素，i 一一对应。\n\n# 输出格式\n{"items":[{"i":0,"digest":"...","significance":"...","applications":["...","..."],"tags":["AI治理"]}]}`,
  });
  const arr = Array.isArray(data.items) ? data.items : [];
  return batch.map((a, k) => {
    const j = arr.find(v => Number(v?.i) === k) || {};
    return {
      account: a.account, title: a.title, url: a.url,
      publishedAt: a.publishTime ? new Date(a.publishTime * 1000).toISOString() : '',
      digest: String(j.digest || a.summary || '').slice(0, 400),
      significance: String(j.significance || '').slice(0, 300),
      applications: (Array.isArray(j.applications) ? j.applications : []).map(s => String(s)).slice(0, 3),
      tags: (Array.isArray(j.tags) ? j.tags : []).map(s => String(s)).slice(0, 3),
      analyzed: !!(j.digest && j.significance),
    };
  });
}

// ---------- 主流程 ----------
async function main() {
  // 1) 多关键词搜索
  let pool = [];
  const seenQ = new Set();
  for (const q of QUERIES) {
    const arts = await runSearch(q, 50);
    let kept = 0;
    for (const a of arts) {
      const acct = TARGETS.find(t => (a.source || '') === t);
      if (!acct) continue; // 只保留目标号自己发的
      if (seenQ.has(a.url)) continue;
      seenQ.add(a.url);
      pool.push({ account: acct, title: a.title, url: a.url, summary: a.summary || '', dateText: a.datetime || '' });
      kept++;
    }
    console.log(`  「${q}」: 结果 ${arts.length}，命中目标号 ${kept}`);
    await sleep(8000); // 搜狗反爬间隔
  }
  console.log(`① 搜索合计命中 ${pool.length} 篇`);

  // 2) 解析真实链接（限量前 MAX_ARTICLES*2 条，足够筛选）
  let resolved = 0;
  const finalPool = [];
  for (const a of pool) {
    if (finalPool.length >= MAX_ARTICLES) break;
    const real = await resolveSogou(a.url);
    resolved++;
    if (resolved % 5 === 0) console.log(`  已解析 ${resolved}/${Math.min(pool.length, MAX_ARTICLES * 2)}…`);
    if (!real || !/mp\.weixin\.qq\.com/.test(real)) continue;
    finalPool.push({ ...a, url: real });
    await sleep(3000);
  }
  console.log(`② 解析出真实链接 ${finalPool.length} 篇`);

  // 3) 抓正文（拿发布时间与账号确认）
  const articles = [];
  for (const a of finalPool) {
    const art = await fetchArticle(a.url);
    if (!art || !art.account) continue;
    const acct = TARGETS.find(t => art.account.includes(t));
    if (!acct) continue;
    const date = art.publishTime ? new Date(art.publishTime * 1000).toISOString().slice(0, 10) : '';
    if (!(date >= DATE_FROM && date <= DATE_TO)) continue;
    articles.push({ ...a, account: acct, title: art.title || a.title, text: art.text, publishTime: art.publishTime, date });
    await sleep(2000);
  }
  console.log(`③ 日期与账号确认后剩 ${articles.length} 篇`);

  // 4) AI 批量分析（每批 2 篇）
  const analyzed = [];
  for (let i = 0; i < articles.length; i += 2) {
    const batch = articles.slice(i, i + 2);
    try {
      analyzed.push(...await analyzeBatch(batch));
    } catch (e) {
      console.warn(`  分析批次失败: ${e.message}`);
      analyzed.push(...batch.map(a => ({ account: a.account, title: a.title, url: a.url, publishedAt: a.publishTime ? new Date(a.publishTime * 1000).toISOString() : '', digest: (a.summary || '').slice(0, 240), significance: '', applications: [], tags: [], analyzed: false })));
    }
    await sleep(2000);
  }
  console.log(`④ AI 分析完成 ${analyzed.filter(x => x.analyzed).length}/${analyzed.length}`);

  // 5) 按发布日期写入各 frontier 文件
  const byDate = {};
  for (const x of analyzed) {
    const d = (x.publishedAt || '').slice(0, 10);
    if (!d) continue;
    (byDate[d] = byDate[d] || []).push(x);
  }
  let touched = 0;
  for (const [d, items] of Object.entries(byDate)) {
    const f = path.join(DATA, `frontier-${d}.json`);
    let rec;
    try { rec = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {
      rec = { date: d, generatedAt: '', targets: TARGETS, channels: {}, items: [], notice: '当日未收录到关注公众号的新文章（发现通道受限；本批为事后回溯补充）' };
    }
    const known = new Set((rec.items || []).map(x => x.url));
    for (const it of items) if (!known.has(it.url)) { (rec.items = rec.items || []).push(it); }
    rec.items.sort((a, b) => (a.title > b.title ? 1 : -1));
    rec.backfilled = true;
    rec.generatedAt = new Date().toISOString();
    fs.writeFileSync(f, JSON.stringify(rec, null, 2), 'utf8');
    touched++;
    console.log(`  ${d}: 现有 ${rec.items.length} 篇`);
  }
  console.log(`⑤ 已更新 ${touched} 个日期文件`);
}

main().catch(e => { console.error('回溯失败:', e); process.exit(1); });

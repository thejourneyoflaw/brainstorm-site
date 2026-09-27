// 前沿关注：发现 → 抓正文 → AI 分析（讲了什么 / 意义 / 应用）
// 发现通道（可插拔，全部容错）：
//   1) AIHOT 精选/公开池（筛目标公众号来源，零星覆盖）
//   2) FRONTIER_RSS_URLS（.env，"账号=RSS地址" 多条换行——部署 we-mp-rss 后点亮，全覆盖）
//   3) data/frontier-links.txt（收件箱：一行一个 mp.weixin 链接，可手动贴或接入 weread-mp-fetcher 等工具输出）
import fs from 'node:fs';
import path from 'node:path';
import { chatJSON, loadEnv, ROOT } from './llm.mjs';

export const TARGETS = ['数字生命卡兹克', '逛逛GitHub', 'GitHubDaily', 'Datawhale', '机器之心', '苍何', 'AI寒武纪', '程序员小灰'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120';
const MAX_PER_DAY = 8;

const get = (url, ms = 30000) => fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(ms) });

function matchAccount(src) {
  return TARGETS.find(t => (src || '').toLowerCase().includes(t.toLowerCase()));
}

async function discoverAihot() {
  const out = [];
  for (const mode of ['selected', 'all']) {
    let cursor = '';
    for (let page = 0; page < 4; page++) { // 跟随分页，尽量拿全 7 天池
      try {
        const res = await get(`https://aihot.news/api/v1/items?mode=${mode}&window=7d&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        const data = await res.json();
        for (const it of data.items || []) {
          const src = it.source?.name || '';
          const acct = matchAccount(src);
          const url = it.links?.original || it.links?.aihot;
          if (acct && url) {
            out.push({ account: acct, title: it.title, url, summary: it.summary || '' });
          }
        }
        cursor = data.page?.nextCursor || '';
        if (!cursor) break;
      } catch (e) {
        console.warn(`  [发现] AIHOT ${mode} 池失败: ${e.message}`);
        break;
      }
    }
  }
  return out;
}

async function discoverRss() {
  loadEnv();
  const entries = (process.env.FRONTIER_RSS_URLS || '').split(/\r?\n|[,;]+/).map(s => s.trim()).filter(Boolean);
  const out = [];
  for (const entry of entries) {
    const eq = entry.indexOf('=');
    const account = eq > 0 ? entry.slice(0, eq).trim() : '未标注公众号';
    const rssUrl = eq > 0 ? entry.slice(eq + 1).trim() : entry;
    try {
      const res = await get(rssUrl, 20000);
      const xml = await res.text();
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 10);
      for (const m of items) {
        const c = m[1];
        const pick = tag => (c.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`)) || [])[1] || '';
        const strip = s => s.replace(/<!\[CDATA\[|\]\]>/g, '').trim();
        out.push({ account, title: strip(pick('title')), url: strip(pick('link')), summary: '', pubDate: strip(pick('pubDate')) });
      }
    } catch (e) {
      console.warn(`  [发现] RSS ${account} 失败: ${e.message}`);
    }
  }
  return out;
}

function discoverLinksFile() {
  const p = path.join(ROOT, 'data', 'frontier-links.txt');
  if (!fs.existsSync(p)) return [];
  const out = [];
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const m = s.match(/(https?:\/\/\S+)\s*(?:[|,]\s*(.+))?$/);
    if (m) out.push({ account: (m[2] || '').trim() || '未标注公众号', title: '', url: m[1], summary: '' });
  }
  return out;
}

// 免登录抓 mp.weixin 正文（标题/账号/日期/正文文本）
export async function fetchWeixinArticle(url) {
  const res = await get(url, 30000);
  const html = await res.text();
  const pick = re => { const m = html.match(re); return m ? m[1] : ''; };
  const title = pick(/property="og:title" content="([^"]+)"/) || pick(/<h1[^>]*id="activity-name"[^>]*>\s*([^<\s][^<]*?)\s*</);
  const account = (pick(/id="js_name"[^>]*>\s*([^<]+?)\s*</) || pick(/var nickname = "([^"]+)"/) || pick(/property="og:article:author" content="([^"]+)"/)).trim();
  let publishedAt = pick(/var ct = "(\d+)"/);
  if (publishedAt) publishedAt = new Date(Number(publishedAt) * 1000).toISOString();
  else publishedAt = pick(/var createTime = '([^']+)'/) || pick(/property="og:article:published_time" content="([^"]+)"/) || '';
  let text = '';
  const seg = html.split('id="js_content"')[1];
  if (seg) {
    text = seg.split('<script')[0]
      .replace(/<style[\s\S]*?<\/style>/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 6000);
  }
  const summary = pick(/property="og:description" content="([^"]+)"/).slice(0, 200);
  return { title: title || '(未取到标题)', account, publishedAt, text, summary, contentOk: text.length > 200 };
}

const ANALYSIS_SYSTEM = `你是"前沿关注"栏目的分析师。读者：法务从业者，懂商务/金融/经济，能读英文技术资料，长期关注 AI 前沿。
你的分析要替读者省时间：先把文章本身讲清楚，再判断它为什么值得注意，最后落到"能用上什么"。
输出约定：严格 JSON；字符串值内禁止英文双引号，引用一律用「」；禁止"那件事/这篇文章"式悬空指代（digest 第一句就写清是谁、做了什么）。`;

function analysisPrompt(batch) {
  const payload = batch.map((a, i) => ({
    i,
    account: a.account,
    title: a.title,
    publishedAt: a.publishedAt || undefined,
    content: (a.text || a.summary || '').slice(0, 3200),
  }));
  return `# 待分析文章（来自用户关注的微信公众号，JSON）\n${JSON.stringify(payload)}\n\n# 任务\n逐篇输出三段分析：\n1. digest「讲了什么」：180~260 字，第一句就写清是谁、发布/做了什么，保留关键数字、产品名、结论；\n2. significance「有什么意义」：100~160 字，为什么值得注意——对行业格局、对读者（法务/金融视角）分别点一句；\n3. applications「可以有什么应用」：2~3 条，每条一句话，结合读者的法律、金融、英语与技术背景，具体可操作（工具/流程/内容选题/研究问题都行）；\n4. tags：1~3 个。\njudged 数组（items）必须恰好 ${batch.length} 个元素，i 与输入一一对应。\n\n# 输出格式\n{"items":[{"i":0,"digest":"...","significance":"...","applications":["...","..."],"tags":["AI治理","法律"]}]}`;
}

function today(d = new Date()) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export async function runFrontier() {
  loadEnv();
  const date = today();
  const dataDir = path.join(ROOT, 'data');
  const rawDir = path.join(dataDir, 'frontier-raw', date);
  fs.mkdirSync(rawDir, { recursive: true });

  // 已分析过的链接（跨天去重）
  const seenFile = path.join(dataDir, 'frontier-seen.json');
  let seen = {};
  try { seen = JSON.parse(fs.readFileSync(seenFile, 'utf8')); } catch {}

  // ① 发现
  const [aihot, rss, links] = await Promise.all([discoverAihot(), discoverRss(), discoverLinksFile()]);
  const seenUrls = new Set();
  let candidates = [...aihot, ...rss, ...links].filter(c => {
    if (!c.url || seenUrls.has(c.url)) return false;
    seenUrls.add(c.url);
    return !seen[c.url]; // 只分析没分析过的
  });
  console.log(`   发现候选 ${candidates.length} 篇新文章（AIHOT ${aihot.length} · RSS ${rss.length} · 收件箱 ${links.length}）`);

  // ② 抓正文（只处理 mp.weixin，上限 MAX_PER_DAY）
  const targets = candidates
    .filter(c => /mp\.weixin\.qq\.com/.test(c.url))
    .slice(0, MAX_PER_DAY);
  const articles = [];
  for (const c of targets) {
    try {
      const art = await fetchWeixinArticle(c.url);
      articles.push({ ...c, ...art, account: c.account && c.account !== '未标注公众号' ? c.account : (art.account || c.account) });
    } catch (e) {
      console.warn(`  抓取失败 ${c.title || c.url}: ${e.message}`);
      articles.push({ ...c, text: '', summary: c.summary || '', contentOk: false });
    }
  }
  console.log(`   抓到正文 ${articles.filter(a => a.contentOk).length}/${articles.length} 篇`);

  // 空内容的（正文与摘要都没抓到）不进分析，避免生成无据的空卡
  const usable = articles.filter(a => a.contentOk || (a.summary || '').length > 40);
  const skipped = articles.length - usable.length;
  if (skipped) console.log(`   跳过 ${skipped} 篇（正文与摘要均未取到，留待补链接后重试）`);
  for (const a of articles) {
    if (!usable.includes(a) && a.url) seen[a.url] = `skipped:${date}`; // 失败的也标记已见，避免天天重试同一篇死链
  }

  // ③ AI 分析（每批 2 篇）
  const cards = [];
  for (let i = 0; i < usable.length; i += 2) {
    const batch = usable.slice(i, i + 2);
    try {
      const data = await chatJSON({ system: ANALYSIS_SYSTEM, temperature: 0.6, maxTokens: 8000, user: analysisPrompt(batch) });
      const arr = Array.isArray(data.items) ? data.items : [];
      batch.forEach((a, k) => {
        const j = arr.find(v => Number(v?.i) === k) || {};
        cards.push({
          _raw: a,
          account: a.account,
          title: a.title,
          url: a.url,
          publishedAt: a.publishedAt || '',
          digest: String(j.digest || '').slice(0, 400),
          significance: String(j.significance || '').slice(0, 300),
          applications: (Array.isArray(j.applications) ? j.applications : []).map(s => String(s)).slice(0, 3),
          tags: (Array.isArray(j.tags) ? j.tags : []).map(s => String(s)).slice(0, 3),
          analyzed: !!(j.digest && j.significance),
        });
      });
    } catch (e) {
      console.warn(`  分析批次失败: ${e.message}`);
      for (const a of batch) {
        cards.push({ _raw: a, account: a.account, title: a.title, url: a.url, publishedAt: a.publishedAt || '', digest: (a.summary || a.text || '').slice(0, 240), significance: '', applications: [], tags: [], analyzed: false });
      }
    }
  }

  // ④ 落盘：分析卡（可公开）+ 原文（仅本地）+ 已见索引（cards 与 articles 一一对应）
  cards.forEach((c) => {
    const a = c._raw;
    if (a && a.text) {
      const slug = String(a.title || 'article').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
      fs.writeFileSync(path.join(rawDir, `${k + 1}-${slug}.txt`), `标题：${a.title}\n公众号：${a.account}\n链接：${a.url}\n\n${a.text}`, 'utf8');
    }
  });

  const record = {
    date,
    generatedAt: new Date().toISOString(),
    targets: TARGETS,
    channels: {
      aihot: aihot.length, rss: rss.length, inbox: links.length,
      rssConfigured: (process.env.FRONTIER_RSS_URLS || '').trim().length > 0,
    },
    items: cards,
  };
  fs.writeFileSync(path.join(dataDir, `frontier-${date}.json`), JSON.stringify(record, null, 2), 'utf8');
  fs.writeFileSync(path.join(dataDir, 'frontier-latest.json'), JSON.stringify(record, null, 2), 'utf8');
  for (const c of cards) { if (c.url) seen[c.url] = date; delete c._raw; }
  fs.writeFileSync(seenFile, JSON.stringify(seen, null, 2), 'utf8');

  console.log(`   前沿关注：${cards.length} 篇已分析（其中 AI 完整分析 ${cards.filter(c => c.analyzed).length} 篇）`);
  console.log(`③ 已写入 data/frontier-${date}.json`);
  return record;
}

// 数据源适配层：每个源返回统一结构 {title, summary, url, aihotUrl, source, category, score, publishedAt}
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) IdeaDaily/1.0 (personal non-commercial)';
const TIMEOUT = 20000;

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

// AIHOT（aihot.news）官方匿名 API：https://aihot.news/agent
// 许可：个人非商业免费，需保留来源署名
async function fetchAihot() {
  const items = [];
  const wins = process.env.AIHOT_WINDOW ? [process.env.AIHOT_WINDOW] : ['24h', '7d'];
  for (const win of wins) {
    const data = await (await get(`https://aihot.news/api/v1/items?mode=selected&window=${win}&limit=60`)).json();
    for (const it of data.items || []) {
      items.push({
        title: it.title || '',
        summary: it.summary || '',
        url: it.links?.original || it.links?.aihot || '',
        aihotUrl: it.links?.aihot || null,
        source: `AIHOT · ${it.source?.name || '未知来源'}`,
        category: it.category || '',
        score: typeof it.score === 'number' ? it.score : 0,
        publishedAt: it.publishedAt || null,
      });
    }
    if (items.length >= 30) break; // 24h 够用就不再取 7d
  }
  return items.filter(x => x.title && x.url);
}

// AI工具集每日资讯（ai-bot.cn）：静态 HTML，结构为 news-date 分组 + news-item 条目
async function fetchAibot() {
  const html = await (await get('https://ai-bot.cn/daily-ai-news/')).text();
  const out = [];
  // 取最近两个日期块（今天不够时还有昨天兜底）
  const dateBlocks = html.split(/<div class="news-date">/).slice(1, 3);
  for (const block of dateBlocks) {
    for (const chunk of block.split('<div class="news-item">').slice(1)) {
      const m = chunk.match(/<h2><a href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (!m) continue;
      const url2 = m[1];
      const title = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (!title || title.length < 8 || title.length > 90) continue;
      if (/ai-bot\.cn/.test(url2)) continue;
      const p = chunk.match(/<p class="text-muted text-sm">([\s\S]*?)<\/p>/);
      let summary = p ? p[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
      summary = summary.replace(/来源：.*$/, '').trim();
      const sm = chunk.match(/来源：([^<]+)</);
      out.push({
        title,
        summary: summary.slice(0, 160),
        url: url2,
        aihotUrl: null,
        source: `AI工具集 · ${sm ? sm[1].trim() : '未知来源'}`,
        category: 'news',
        score: 0,
        publishedAt: null,
      });
    }
  }
  return out.slice(0, 20);
}

function normalizeTitle(t) {
  return String(t).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '').slice(0, 24);
}

export async function gatherCandidates() {
  const warnings = [];
  const counts = { aihot: 0, aibot: 0 };
  const results = await Promise.allSettled([
    fetchAihot().then(list => list.map(x => ({ ...x, _src: 'aihot' }))),
    fetchAibot().then(list => list.map(x => ({ ...x, _src: 'aibot' }))),
  ]);
  const raw = [];
  if (results[0].status === 'fulfilled') { raw.push(...results[0].value); counts.aihot = results[0].value.length; }
  else warnings.push(`AIHOT 抓取失败: ${results[0].reason?.message}`);
  if (results[1].status === 'fulfilled') { raw.push(...results[1].value); counts.aibot = results[1].value.length; }
  else warnings.push(`AI工具集 抓取失败: ${results[1].reason?.message}`);

  const seen = new Map();
  for (const it of raw) {
    const k = normalizeTitle(it.title);
    if (!k || seen.has(k)) continue;
    seen.set(k, it);
  }
  const candidates = [...seen.values()].map(({ _src, ...rest }) => rest);
  return { candidates, warnings, counts };
}

// 头脑风暴 · 前沿关注发现 Worker
// 每天北京时间 06:00（UTC 22:00）自动：
//   1) 搜狗微信搜索 8 个目标公众号（按账号名搜索，结果按来源过滤）
//   2) 解析搜狗中转链 → mp.weixin 真实链接（限量，降低反爬风险）
//   3) 抓正文页提取 标题/账号/日期/正文文本
//   4) 存入 KV，去重保留最近 60 篇
// HTTP 接口（需 ACCESS_KEY）：
//   GET /frontier.json?key=KEY   返回最近条目 JSON
//   GET /run?key=KEY             手动触发一次扫荡
// 另有微信读书通道：POST /weread/collect?key=KEY  body: {"cookie":"...","ticket":"...","accounts":["账号名"]}
//   使用微信读书 Web 接口拉取已关注公众号的文章列表（收录可能不全，与搜狗通道互补）

const ACCOUNTS = [
  '数字生命卡兹克', '逛逛GitHub', 'GitHubDaily', 'Datawhale',
  '机器之心', '苍何', 'AI寒武纪', '程序员小灰',
];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
const MAX_RESOLVE = 6;   // 每轮最多解析多少条中转链（控制反爬风险）
const KEEP_ITEMS = 60;   // KV 里保留最近多少篇

const json = (obj, status = 200) => new Response(JSON.stringify(obj, null, 2), {
  status, headers: { 'content-type': 'application/json; charset=utf-8' },
});

async function kvGet(env, key, fallback) {
  const v = await env.FRONTIER_KV.get(key);
  return v ? JSON.parse(v) : fallback;
}
async function kvPut(env, key, value) {
  await env.FRONTIER_KV.put(key, JSON.stringify(value));
}
const hash = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

// ---------- 搜狗微信搜索 ----------
async function sogouSearch(query) {
  const url = 'https://weixin.sogou.com/weixin?type=2&query=' + encodeURIComponent(query);
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Referer': 'https://weixin.sogou.com/',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
  });
  if (!res.ok) throw new Error('sogou HTTP ' + res.status);
  return res.text();
}

// 从搜狗结果 HTML 提取条目（title/source/time/中转链）
function parseSogou(html) {
  const out = [];
  const blocks = html.split('<div class="txt-box">').slice(1);
  for (const b of blocks) {
    const link = (b.match(/href="([^"]*\/link\?url=[^"]+)"/) || [])[1];
    const title = (b.match(/uigs="article_title_\d+"[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '';
    const source = (b.match(/uigs="article_account_\d+"[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '';
    const ts = (b.match(/timeConvert\('(\d+)'\)/) || [])[1];
    if (!link || !title) continue;
    out.push({
      title: title.replace(/<[^>]+>/g, '').trim(),
      source: source.replace(/<[^>]+>/g, '').trim(),
      sogouUrl: 'https://weixin.sogou.com' + link.replace(/&amp;/g, '&'),
      publishTime: ts ? Number(ts) : 0,
    });
  }
  return out;
}

// 解析搜狗中转链 → mp.weixin 真实链接（页面里 url += '片段' 拼接）
async function resolveSogouLink(sogouUrl) {
  const res = await fetch(sogouUrl, {
    headers: { 'User-Agent': UA, 'Referer': 'https://weixin.sogou.com/' },
  });
  const html = await res.text();
  const frags = [...html.matchAll(/url \+= '([^']*)'/g)].map(m => m[1]);
  const real = frags.join('');
  return real.startsWith('http') ? real : '';
}

// 抓微信正文页关键信息
async function fetchWeixinPage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  const html = await res.text();
  const pick = (re) => { const m = html.match(re); return m ? m[1] : ''; };
  const title = pick(/property="og:title" content="([^"]+)"/) || pick(/<h1[^>]*id="activity-name"[^>]*>\s*([^<\s][^<]*?)\s*</);
  const account = (pick(/id="js_name"[^>]*>\s*([^<]+?)\s*</) || pick(/var nickname = "([^"]+)"/)).trim();
  const ct = pick(/var ct = "(\d+)"/);
  let text = '';
  const seg = html.split('id="js_content"')[1];
  if (seg) {
    text = seg.split('<script')[0]
      .replace(/<style[\s\S]*?<\/style>/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000);
  }
  return { title: title.slice(0, 120), account, publishTime: ct ? Number(ct) : 0, textLen: text.length, text };
}

// ---------- 主扫荡流程 ----------
async function runSweep(env) {
  const now = Date.now();
  const log = [];
  const seen = await kvGet(env, 'seen', {});
  const items = await kvGet(env, 'items', []);

  for (const account of ACCOUNTS) {
    try {
      const html = await sogouSearch(account);
      const results = parseSogou(html);
      // 只保留来源为本账号的结果（关键词搜索混入大量同名企业号内容）
      const own = results.filter(r => r.source === account);
      log.push(`${account}: 结果${results.length} 自有${own.length}`);
      for (const r of own) {
        const urlHash = hash(r.title + r.source);
        if (seen[urlHash]) continue;
        let item = {
          account, title: r.title, url: '',
          publishTime: r.publishTime, foundAt: now, text: '', via: 'sogou',
        };
        if (items.length - items.filter(x => x.url).length < MAX_RESOLVE) {
          try {
            const real = await resolveSogouLink(r.sogouUrl);
            if (real) {
              item.url = real;
              const page = await fetchWeixinPage(real);
              if (page.title) item.title = page.title;
              if (page.account) item.account = page.account;
              if (page.publishTime) item.publishTime = page.publishTime;
              item.text = page.text;
            }
          } catch (e) { log.push(`${account}: 解析失败 ${String(e.message).slice(0, 50)}`); }
        }
        seen[urlHash] = now;
        items.push(item);
      }
      await new Promise(r => setTimeout(r, 5000)); // 搜索间隔，降低反爬风险
    } catch (e) {
      log.push(`${account}: 搜索失败 ${String(e.message).slice(0, 60)}`);
    }
  }

  // 去重 + 只留最近 KEEP_ITEMS 条 + 清理过期 seen
  const uniq = new Map();
  for (const it of items) {
    const key = it.url || hash(it.title + it.account);
    uniq.set(key, it);
  }
  const kept = [...uniq.values()]
    .sort((a, b) => (b.publishTime || b.foundAt) - (a.publishTime || a.foundAt))
    .slice(0, KEEP_ITEMS);
  await kvPut(env, 'items', kept);
  await kvPut(env, 'seen', seen);
  await kvPut(env, 'lastRun', { at: now, log });
  return { newItems: kept.length, log };
}

// 微信读书通道：用 Cookie 调微信读书 Web 接口拉已关注公众号的文章列表
async function wereadCollect(env, cookie, ticket, accounts) {
  const out = [];
  for (const name of accounts) {
    try {
      const shelfUrl = 'https://weread.qq.com/web/shelf/sync';
      const res = await fetch(shelfUrl, { headers: { 'Cookie': cookie } });
      if (!res.ok) { out.push({ account: name, error: 'weread HTTP ' + res.status }); continue; }
      out.push({ account: name, note: '书架接口可达（具体文章列表解析依赖 weread_mp 逻辑，见 we-mp-rss）' });
    } catch (e) {
      out.push({ account: name, error: String(e).slice(0, 80) });
    }
  }
  return out;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSweep(env));
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/favicon.ico') return new Response('', { status: 204 });
    const key = url.searchParams.get('key');
    if (!env.ACCESS_KEY || key !== env.ACCESS_KEY) {
      return json({ error: 'forbidden: missing/invalid key' }, 403);
    }

    if (url.pathname === '/run') {
      const promise = runSweep(env);
      ctx.waitUntil(promise);
      return json({ ok: true, started: true, note: 'sweep running in background, check /frontier.json in a minute' });
    }

    if (url.pathname === '/frontier.json') {
      const items = await kvGet(env, 'items', []);
      const lastRun = await kvGet(env, 'lastRun', null);
      return json({
        date: new Date().toISOString().slice(0, 10),
        generatedAt: new Date().toISOString(),
        targets: ACCOUNTS,
        channels: { worker: 'cloudflare', lastRun },
        items: items.map(it => ({
          account: it.account, title: it.title, url: it.url,
          publishedAt: it.publishTime ? new Date(it.publishTime * 1000).toISOString() : '',
          digest: (it.text || '').slice(0, 240),
          significance: '', applications: [], tags: [],
          analyzed: false,
        })),
      });
    }

    if (url.pathname === '/weread/collect' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      if (!body.cookie) return json({ error: 'missing cookie' }, 400);
      const result = await wereadCollect(env, body.cookie, body.ticket || '', body.accounts || ACCOUNTS);
      return json({ ok: true, result });
    }

    return json({ endpoints: ['/frontier.json?key=', '/run?key=', '/weread/collect?key='] });
  },
};

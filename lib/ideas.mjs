import fs from 'node:fs';
import path from 'node:path';
import { chatJSON, reviewJSON, ROOT } from './llm.mjs';

export function loadProfile() {
  try {
    return fs.readFileSync(path.join(ROOT, 'profile.md'), 'utf8');
  } catch {
    return '用户有法务、商务、金融、经济学基础知识，喜欢动漫，关注 AI 技术与算法本身。';
  }
}

const TAG_MAP = {
  法务: '法律', 法律: '法律', 律师: '法律',
  商业: '商务', 商务: '商务', 创业: '商务',
  金融: '金融', 投资: '金融',
  经济: '经济', 经济学: '经济',
  动漫: '动漫', 二次元: '动漫', ACG: '动漫', 游戏: '动漫',
  历史: '历史', 地理: '地理', 建工: '建工', 建筑: '建工', 设计: '设计',
  技术: '技术', AI: '技术', 模型: '技术', 工程: '技术', 算法: '技术',
  产品: '产品', 副业: '副业', 内容: '内容', 其他: '其他',
};

function normTag(t) {
  const s = String(t).trim();
  return TAG_MAP[s] || s;
}

const GEN_SYSTEM = `你是"领域创意策展人"。用户是法务从业者，懂商务/金融/经济，爱动漫，且懂 AI 技术与算法。
你的任务：借当天资讯里的 AI 技术/机制，想出真正能做、能落地的创意——工具、服务、内容系列、流程改造、副业或值得较真的研究问题。
最忌讳三件事：
一、跨领域名词拼贴（把"动漫IP"和"劳动关系"缝在一起这种弱关联）——除非关联真实成立，否则不要硬凑；
二、换皮伪创意——把成熟工具换个名字（合同审查工具改叫"劳动合同30秒体验器"）；
三、只有概念没有操作——说不出"这周具体干什么"的创意不要交；
四、悬空指代——读者没看过原文。每条创意的开头必须先用一两句话把资讯本身交代清楚（谁、做了什么、关键数字/机制），绝不许写"那件事""这件事""该新闻"这种读者对不上号的指代；
五、内部流程泄漏——"毒评""评委""评审""自检"这些是幕后工序，一个字都不许出现在给用户看的文案里；评审意见只用来改写，不能被引用。
输出约定：严格 JSON；所有字符串值内禁止出现英文双引号，引用一律用「」。不要长篇思考。`;

// 闸一：自检清单 + 五维打分（理念已由用户确认）
const JUDGE_SYSTEM = `你是刻薄但公正的创意评委。听众：法务实务背景，懂商务/金融/经济，爱动漫，且懂 AI 技术与算法。
先做闸一自检（四项逐条判断 true/false）：
- standalone：读者完全没看过原文，也能靠这条创意的前两句话读懂资讯背景吗（有无"那件事/这件事"式悬空指代）？文案里有没有泄漏"毒评/评委/评审/自检"等内部流程词？
- diff：能用一句话说清"和现有做法的差别"吗？
- mechanism：点名了资讯里支撑它的具体机制/数字吗？
- firstStepOk：落地路线第一步今晚或本周真的能动手吗？
- deliverableOk：产出物明确吗？
再按五维打分（总和 0-100）：
- novelty(0-20) 新颖度：变革式 > 探索式 > 组合式（Boden）；已有成熟产品或常见做法 → 0-5 分；
- usefulness(0-20) 有用性：止痛药 > 维生素 > 糖果；说不清对谁有用 → 低分；
- feasibility(0-25) 可落地性：数据与工具可得、个人或小团队 1-2 周能出粗胚 → 高分；要大团队大资本 → 低分；
- timing(0-15) 时机性：为什么是现在——今天这条资讯给了什么新窗口（能力/成本/政策/数据）；
- fit(0-15) 个人契合与复利：是否真用上用户背景；做完能否沉淀成内容/工具/人脉。
另标四个一票否决（true 即淘汰）：mature（换皮成熟产品）、shallow（只有概念没有操作）、forced（跨领域硬凑）、risky（合规/伦理/侵权风险）。
每条附 ≤24 字毒评。输出约定：严格 JSON；字符串值内禁用英文双引号，引用一律用「」。`;

// 闸二：异模型终审（agnes），只判"能不能发布"，不复算分数
const REVIEW_SYSTEM = `你是独立终审员，和创意的生成者不是同一个模型，你的职责是替用户把关，宁可打回也不要放过。
对每条创意逐项判断（true/false）：
- linkTruth：创意与那条资讯的关联真实成立吗（能指出具体机制，不是名词沾边）；
- actionable：落地路线第一步今晚或本周真的能动手吗（工具、数据、产出明确，不是"先调研一下"）；
- interesting：一个懂行的人看了会觉得有意思吗（不是常识、不是功能清单、不是报告腔）；
- compliant：没有明显合规、伦理或侵权风险。
approve 规则：四项全为 true 才通过；任何一项 false 都不通过，并在 reason 里指明要改什么（≤24 字）。
输出约定：严格 JSON；字符串值内禁用英文双引号，引用一律用「」。`;

// 草稿分池：prof = 法律/金融/经济（每天保底 6 条），open = 不限领域；样例模式按 opts 放大
function draftPlans(profCount, openCount) {
  const perProf = profCount <= 6 ? 4 : 3;   // 单批越小越不容易被截断/超时（缺的由补批循环自动补齐）
  const perOpen = openCount <= 4 ? 6 : 4;
  return [
    { pool: 'prof', name: '法律', count: perProf, hint: '合同、劳动、诉讼、证据、合规、法务效率、司法公开数据……在该领域内部找真实痛点或机会' },
    { pool: 'prof', name: '金融', count: perProf, hint: '定价、投资、风控、量化、支付、金融合规、资产与信用……' },
    { pool: 'prof', name: '经济', count: perProf, hint: '宏观经济、市场机制、劳动力、数据经济、产业研究、激励机制设计……' },
    { pool: 'open', name: '不限领域 A', count: perOpen, hint: '不限定技术、行业、专业背景——设计、科学、教育、医疗、生活、硬件、软件、社会实验……什么都可以，只要创意本身站得住、能落地' },
    { pool: 'open', name: '不限领域 B', count: perOpen, hint: '同样不限定领域，但换一批完全不同的角度，鼓励跨界（跨得要有真实成立的关联），避开 A 批的常规思路' },
  ];
}

function buildUserPrompt(candidates, profile, opts = {}) {
  const { count = 5, startRank = 1, lane = null } = opts;
  const list = candidates.slice(0, 60).map((c, i) => ({
    i,
    t: c.title,
    s: (c.summary || '').slice(0, 140),
    src: c.source,
    cat: c.category || undefined,
    url: c.url,
  }));
  return `# 用户画像（创意从这个人出发）
${profile.trim()}

# 今日候选资讯（JSON 数组，共 ${list.length} 条）
${JSON.stringify(list)}

# 任务：生成 ${count} 个创意（编号 ${startRank} 起）
${lane ? `本批要求：${lane.hint}` : ''}
每条必须过五关：
1. 领域关：${lane && lane.pool === 'open' ? '领域不限（可以是任何行业/技术/专业背景），但创意与资讯的关联必须真实成立，禁止名词拼贴' : '扎根单一领域，讲的是这个领域的人真正会遇到/用得上的东西，禁止跨领域名词拼贴'}。
2. 真实关：点名资讯里的哪个具体机制/技术/数字在支撑它——是"用某个 AI 能力解决/放大某个领域问题"，不是拿标题当背景板。idea 的第一二句必须把这条资讯本身交代清楚（谁、做了什么、关键数字），让完全没看过原文的人也能读懂，禁止"那件事/这件事"式悬空指代。
3. 新颖关：已有成熟产品或常见做法的一律换角度，不许换名字交差。
4. 操作关：自带可执行路线 plan（3~5 步），每步是具体动作 + 工具/数据/产出；第一步要今晚或本周就能开始。
5. 成品关：写清楚 deliverable——最先能交付什么（demo、表格、文章、服务、工具……），以及最大风险 risk（一句话）。
idea 字段 220~300 字：是什么、为什么有意思、支撑它的机制是哪一点；语气像懂行的朋友聊天；中文。
field 字段填主领域（法律/金融/经济/商务/设计/历史/技术……择一）；tags 填 1~3 个细分标签。
news 字段严格引用候选资讯的原文标题和 url（一字不改），source 原样引用 src。

# 输出 JSON 格式（ideas 数组必须恰好 ${count} 个元素）
{"ideas":[{"rank":${startRank},"title":"创意标题（18字内）","field":"法律","idea":"...","plan":["第一步…","第二步…","第三步…"],"deliverable":"...","risk":"...","tags":["合同","副业"],"news":{"title":"...","url":"...","source":"..."}}]}`;
}

function parseIdeas(data, byUrl) {
  return (Array.isArray(data?.ideas) ? data.ideas : [])
    .filter(x => x && x.title && x.idea && x.news && x.news.url)
    .slice(0, 12)
    .map((x, i) => ({
      rank: Number(x.rank) || i + 1,
      title: String(x.title).slice(0, 40),
      field: String(x.field || '').slice(0, 12),
      idea: String(x.idea),
      plan: (Array.isArray(x.plan) ? x.plan : []).map(s => String(s)).filter(Boolean).slice(0, 8),
      deliverable: String(x.deliverable || '').slice(0, 120),
      risk: String(x.risk || '').slice(0, 120),
      tags: [...new Set((Array.isArray(x.tags) ? x.tags : []).map(normTag))].slice(0, 4),
      news: {
        title: String(x.news.title || ''),
        url: String(x.news.url),
        source: byUrl.get(x.news.url)?.source || String(x.news.source || ''),
        aihotUrl: byUrl.get(x.news.url)?.aihotUrl || null,
      },
    }));
}

function makeVerdict(j, x) {
  const clamp = (v, m) => Math.max(0, Math.min(m, Number(v) || 0));
  const novelty = clamp(j.novelty, 20);
  const usefulness = clamp(j.usefulness, 20);
  const feasibility = clamp(j.feasibility, 25);
  const timing = clamp(j.timing, 15);
  const fit = clamp(j.fit, 15);
  const total = novelty + usefulness + feasibility + timing + fit;
  const flags = {
    mature: !!j.mature, shallow: !!j.shallow, forced: !!j.forced, risky: !!j.risky,
  };
  const checklist = {
    standalone: !!j.standalone, diff: !!j.diff, mechanism: !!j.mechanism, firstStepOk: !!j.firstStepOk, deliverableOk: !!j.deliverableOk,
  };
  const list = [flags.mature && '换皮成熟品', flags.shallow && '空谈', flags.forced && '硬凑', flags.risky && '合规风险'].filter(Boolean);
  const checkFail = Object.entries(checklist).filter(([, v]) => !v).map(([k]) => ({ standalone: '开头没交代资讯背景', diff: '差异化不明', mechanism: '未点名机制', firstStepOk: '第一步不可执行', deliverableOk: '产出物不明' }[k]));
  const grade = (list.length || total < 65) ? '淘汰' : (total >= 80 && !checkFail.length) ? 'GO' : '降位';
  return { novelty, usefulness, feasibility, timing, fit, total, flags: list, checklist, checkFail, grade, critique: String(j.critique || '').slice(0, 40) };
}

async function judgeBatch(items) {
  const payload = items.map((x, k) => ({
    i: k, title: x.title, field: x.field, idea: x.idea.slice(0, 260),
    plan: (x.plan || []).join(' | ').slice(0, 260), deliverable: x.deliverable,
  }));
  const data = await chatJSON({
    system: JUDGE_SYSTEM,
    temperature: 0.4,
    user: `# 待评审创意（JSON）\n${JSON.stringify(payload)}\n\n# 任务\n先做闸一自检（standalone/diff/mechanism/firstStepOk/deliverableOk），再按 novelty/usefulness/feasibility/timing/fit 打分，必要时标 mature/shallow/forced/risky，并给毒评。judged 数组必须恰好 ${items.length} 个元素，i 与输入一一对应。\n\n# 输出格式\n{"judged":[{"i":0,"standalone":true,"diff":true,"mechanism":true,"firstStepOk":true,"deliverableOk":true,"novelty":14,"usefulness":15,"feasibility":20,"timing":10,"fit":12,"mature":false,"shallow":false,"forced":false,"risky":false,"critique":"路线虚，第三步就做不了"}]}`,
  });
  const arr = Array.isArray(data.judged) ? data.judged : [];
  return items.map((x, k) => ({ ...x, judge: makeVerdict(arr.find(v => Number(v?.i) === k) || {}, x) }));
}

function polishPrompt(chunk) {
  const payload = chunk.map(x => ({
    title: x.title, field: x.field, idea: x.idea, plan: x.plan,
    deliverable: x.deliverable, risk: x.risk, tags: x.tags,
    critique: x.judge?.critique || '', news: x.news,
  }));
  return `# 待深化的创意（JSON，已通过初筛）\n${JSON.stringify(payload)}\n\n# 任务\n把每条深化成可以直接开工的方案（领域和关联资讯保持不变，把评委毒评指出的问题改掉——注意：毒评只是给你看的改写指令，它的字句和"毒评/评委"这些词绝不能出现在成品文案里）：\n1. title ≤18 字，不标题党；\n2. idea 280~380 字：第一二句先把资讯本身交代清楚（谁、做了什么、关键数字），让没看过原文的人也能读懂——禁止"那件事/这件事"式悬空指代；然后讲是什么、为什么有意思、支撑它的资讯机制是哪一点，收在"能拿来做"的落点；\n3. plan：4~6 步，每步必须"动作 + 工具/数据/产出"三要素齐全，可执行、能被检验。第一步今晚或本周就能开始；\n4. deliverable：最先能交付的东西；\n5. risk：最大的坑，一句话；\n6. field、tags 沿用；news 原样保留（title/url/source 一字不改）。\n直接输出 JSON。\n\n# 输出格式（ideas 数组必须恰好 ${chunk.length} 个元素，news 与输入一一对应）\n{"ideas":[{"rank":1,"title":"...","field":"法律","idea":"...","plan":["...","..."],"deliverable":"...","risk":"...","tags":["合同"],"news":{"title":"...","url":"...","source":"..."}}]}`;
}

// 终审打回后的定向重写
function fixPrompt(chunk) {
  const payload = chunk.map(x => ({
    title: x.title, field: x.field, idea: x.idea, plan: x.plan,
    deliverable: x.deliverable, risk: x.risk, tags: x.tags,
    '终审意见': x.review?.reason || '', '关联资讯': x.news,
  }));
  return `# 被终审打回的创意（JSON）\n${JSON.stringify(payload)}\n\n# 任务\n针对每条"终审意见"指出的问题重写（保持领域与关联资讯不变，问题没解决不算重写）：\n1. 如果意见说关联不成立（linkTruth）→ 回到资讯里找真实支撑它的机制，把关联讲实；\n2. 如果说不可执行（actionable）→ 把第一步换成今晚就能做的具体动作（工具、数据、产出明确）；\n3. 如果说没意思（interesting）→ 换个更锋利的角度或更具体的画面，别写功能清单；\n4. 如果说有合规风险（compliant）→ 换掉有风险的做法，保留思路；\n5. title ≤18 字；idea 280~380 字；plan 4~6 步（动作+工具+产出）；deliverable 与 risk 保留并更新；field、tags 沿用；news 原样保留。\n直接输出 JSON。\n\n# 输出格式（ideas 数组必须恰好 ${chunk.length} 个元素，news 与输入一一对应）\n{"ideas":[{"rank":1,"title":"...","field":"法律","idea":"...","plan":["...","..."],"deliverable":"...","risk":"...","tags":["合同"],"news":{"title":"...","url":"...","source":"..."}}]}`;
}

// 闸二：异模型终审，分批（每批 5 条）
async function reviewItems(items) {
  const chunks = [];
  for (let i = 0; i < items.length; i += 3) chunks.push(items.slice(i, i + 3));
  const results = await mapLimit(chunks, 3, async (chunk) => {
    const payload = chunk.map((x, k) => ({
      i: k, title: x.title, field: x.field, idea: x.idea.slice(0, 300),
      plan: (x.plan || []).join(' | ').slice(0, 300), deliverable: x.deliverable, risk: x.risk,
      news: x.news?.title,
    }));
    const { data, model, fallback } = await reviewJSON({
      system: REVIEW_SYSTEM,
      user: `# 待终审的创意（JSON）\n${JSON.stringify(payload)}\n\n# 任务\n逐条判断 linkTruth / actionable / interesting / compliant，并给 reason。judged 数组必须恰好 ${chunk.length} 个元素，i 与输入一一对应。\n\n# 输出格式\n{"judged":[{"i":0,"linkTruth":true,"actionable":true,"interesting":true,"compliant":true,"approve":true,"reason":"可以发布"}]}`,
    });
    const arr = Array.isArray(data.judged) ? data.judged : [];
    return chunk.map((x, k) => {
      const j = arr.find(v => Number(v?.i) === k) || {};
      const linkTruth = !!j.linkTruth, actionable = !!j.actionable, interesting = !!j.interesting, compliant = !!j.compliant;
      return {
        ...x,
        review: {
          linkTruth, actionable, interesting, compliant,
          approved: j.approve === undefined ? (linkTruth && actionable && interesting && compliant) : !!j.approve,
          reason: String(j.reason || '').slice(0, 40),
          model, fallback,
        },
      };
    });
  });
  const out = [];
  results.forEach((r, k) => {
    if (r && !r.__error) out.push(...r);
    else {
      console.warn(`  终审批次失败（保留原稿不拦截）: ${r?.__error?.message}`);
      out.push(...chunks[k].map(x => ({ ...x, review: null })));
    }
  });
  return out;
}

// 有上限的并发执行（避免瞬时打爆渠道，也避免串行太慢）
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const k = cursor++;
      if (k >= items.length) return;
      try {
        out[k] = await fn(items[k], k);
      } catch (e) {
        out[k] = { __error: e };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

export async function generateIdeas(candidates, opts = {}) {
  const { profCount = 6, openCount = 4 } = opts;
  const PLANS = draftPlans(profCount, openCount);
  const profile = loadProfile();
  const byUrl = new Map(candidates.map(c => [c.url, c]));

  // ① 草稿：法律/金融/经济各 4 个 + 不限领域两批各 6 个；分两波错峰，避免瞬时打爆渠道限流
  const genLane = async (lane, startRank) => {
    const ask = (count, hintSuffix = '') => chatJSON({
      system: GEN_SYSTEM,
      maxTokens: 16000,
      user: buildUserPrompt(candidates, profile, {
        count, startRank,
        lane: hintSuffix ? { ...lane, hint: lane.hint + hintSuffix } : lane,
      }),
    });
    try {
      return parseIdeas(await ask(lane.count), byUrl).map(x => ({ ...x, pool: lane.pool }));
    } catch (e) {
      const fewer = Math.max(2, lane.count - 2);
      console.warn(`  ${lane.name} 首轮失败（${String(e.message).slice(0, 50)}…），按 ${fewer} 条重试`);
      return parseIdeas(await ask(fewer, '（输出务必精简，优先保证 JSON 完整闭合）'), byUrl).map(x => ({ ...x, pool: lane.pool }));
    }
  };
  let pool = [];
  // 草稿：5 路并发（并发上限 4），每路小批量；缺的由补批循环补齐
  {
    const results = await mapLimit(PLANS, 4, (lane, k) => genLane(lane, 1 + k * 8));
    results.forEach((r, k) => {
      if (r && !r.__error) pool.push(...r);
      else console.warn(`  草稿批次（${PLANS[k].name}）放弃: ${r?.__error?.message}`);
    });
  }
  const seenUrl = new Set();
  pool = pool.filter(x => (seenUrl.has(x.news.url) ? false : (seenUrl.add(x.news.url), true)));
  // 草稿池不足时补批（目标：选条数的 1.4 倍，留出淘汰空间）
  const want = profCount + openCount;
  const target = Math.ceil(want * 1.3);
  let topUps = 0;
  while (pool.length < target && topUps < 3) {
    topUps++;
    const batch = await mapLimit([0, 1, 2], 3, async (k) => {
      const extra = await chatJSON({
        system: GEN_SYSTEM,
        maxTokens: 16000,
        user: buildUserPrompt(candidates, profile, {
          count: 3,
          startRank: 200 + topUps * 10 + k,
          lane: { pool: 'prof', name: '补盲', hint: '优先补充法律/金融/经济池的缺口，角度要新' },
        }),
      });
      return parseIdeas(extra, byUrl).map(x => ({ ...x, pool: 'prof' }));
    });
    const before = pool.length;
    batch.forEach(r => {
      if (r && !r.__error) {
        const added = r.filter(x => !seenUrl.has(x.news.url) && (seenUrl.add(x.news.url), true));
        pool = pool.concat(added);
      }
    });
    if (pool.length === before) break; // 没补进来就不用再试
  }
  if (pool.length < want) console.warn(`  ⚠ 草稿池只有 ${pool.length} 个（目标 ${want} 条），可能凑不满`);
  console.log(`   草稿 ${pool.length} 个`);

  // ② 闸一自检 + 五维打分（并发上限 3）
  let judged = [];
  const judgeChunks = [];
  for (let i = 0; i < pool.length; i += 9) judgeChunks.push(pool.slice(i, i + 9));
  const judgeOut = await mapLimit(judgeChunks, 3, c => judgeBatch(c));
  judgeOut.forEach((r, k) => {
    if (r && !r.__error) judged.push(...r);
    else {
      console.warn(`  评委批次 ${k + 1} 失败（按默认分处理）: ${r?.__error?.message}`);
      judged.push(...judgeChunks[k].map(x => ({ ...x, judge: makeVerdict({}, x) })));
    }
  });

  // ③ 选 10：法律/金融/经济保底 6 条 + 不限领域 4 条；宁缺毋滥——未过审的不回补，页面会提示今天达标几条
  const flagged = x => x.judge.grade === '淘汰';
  const pick = (list, n) => [...list]
    .filter(x => !flagged(x))
    .sort((a, b) => b.judge.total - a.judge.total)
    .slice(0, n);
  const profPool = judged.filter(x => x.pool === 'prof');
  const openPool = judged.filter(x => x.pool === 'open');
  const selected = [...pick(profPool, profCount), ...pick(openPool, openCount)];
  console.log(`   初筛：${judged.length} 个 → 法律/金融/经济 ${Math.min(profPool.length, profCount)} 条 + 不限领域 ${Math.min(openPool.length, openCount)} 条（淘汰 ${judged.filter(flagged).length} 个：换皮/空谈/硬凑/合规风险）`);

  // ④ 精修：并发上限 4 深化，url 对不上或写砸了就保留原稿
  const polishChunks = [];
  for (let i = 0; i < selected.length; i += 3) polishChunks.push(selected.slice(i, i + 3));
  let final = [];
  const polishOut = await mapLimit(polishChunks, 4, async (chunk) => {
    const data = await chatJSON({ system: GEN_SYSTEM, temperature: 0.9, maxTokens: 16000, user: polishPrompt(chunk) });
    return parseIdeas(data, byUrl);
  });
  polishOut.forEach((rw, k) => {
    const chunk = polishChunks[k];
    if (rw && !rw.__error) {
      for (const orig of chunk) {
        const hit = rw.find(x => x.news.url === orig.news.url);
        final.push(hit && hit.idea.length >= 150 && hit.plan.length >= 3 ? { ...hit, judge: orig.judge, pool: orig.pool } : orig);
      }
    } else {
      console.warn(`  精修批次 ${k + 1} 失败（保留原稿）: ${rw?.__error?.message}`);
      final.push(...chunk);
    }
  });

  // ⑤ 闸二：异模型终审 → 打回的定向重写 → 复终审（SKIP_REVIEW=1 可跳过，用于通道不稳时先出结果）
  let reviewed;
  if (process.env.SKIP_REVIEW === '1') {
    console.log('   终审已跳过（SKIP_REVIEW=1）');
    reviewed = final.map(x => ({ ...x, review: null }));
  } else {
    reviewed = await reviewItems(final);
  }
  const firstReject = reviewed.filter(x => x.review && !x.review.approved);
  const reviewModel = reviewed.find(x => x.review)?.review?.model || '未执行';
  if (!process.env.SKIP_REVIEW) console.log(`   终审（${reviewModel}）：通过 ${reviewed.length - firstReject.length}/${reviewed.length}（打回率 ${((reviewed.length ? firstReject.length / reviewed.length : 0) * 100).toFixed(0)}%）`);
  if (firstReject.length) {
    console.log(`   按终审意见重写 ${firstReject.length} 条…`);
    const fixChunks = [];
    for (let i = 0; i < firstReject.length; i += 3) fixChunks.push(firstReject.slice(i, i + 3));
    const fixOut = await mapLimit(fixChunks, 2, async (chunk) => {
      const data = await chatJSON({ system: GEN_SYSTEM, temperature: 0.8, maxTokens: 16000, user: fixPrompt(chunk) });
      return parseIdeas(data, byUrl);
    });
    const fixed = [];
    fixOut.forEach((rw, k) => {
      const chunk = fixChunks[k];
      if (rw && !rw.__error) {
        for (const orig of chunk) {
          const hit = rw.find(x => x.news.url === orig.news.url);
          fixed.push(hit && hit.idea.length >= 150 && hit.plan.length >= 3 ? { ...hit, judge: orig.judge, pool: orig.pool } : orig);
        }
      } else {
        console.warn(`  重写批次 ${k + 1} 失败（保留原稿）: ${rw?.__error?.message}`);
        fixed.push(...chunk);
      }
    });
    const reReviewed = await reviewItems(fixed);
    reviewed = reviewed.map(x => reReviewed.find(y => y.news.url === x.news.url) || x);
  }
  const stillRejected = reviewed.filter(x => x.review && !x.review.approved);
  const overall = reviewed.length ? (firstReject.length / reviewed.length) : 0;
  if (overall > 0.3) console.warn(`  ⚠ 整批打回率 ${(overall * 100).toFixed(0)}% 超过 30%，建议关注今日资讯质量或调整提示词`);
  if (stillRejected.length) console.warn(`   仍有 ${stillRejected.length} 条未过终审（卡片标 ⚠，供你人工判断）`);

  return reviewed
    .sort((a, b) => (Number(!!b.review?.approved) - Number(!!a.review?.approved)) || ((b.judge?.total || 0) - (a.judge?.total || 0)))
    .slice(0, profCount + openCount)
    .map((x, i) => ({
      rank: i + 1,
      title: x.title,
      field: x.field,
      idea: x.idea,
      plan: x.plan,
      deliverable: x.deliverable,
      risk: x.risk,
      tags: x.tags,
      news: x.news,
      score: x.judge?.total || 60,
      verdict: x.judge ? {
        novelty: x.judge.novelty,
        usefulness: x.judge.usefulness,
        feasibility: x.judge.feasibility,
        timing: x.judge.timing,
        fit: x.judge.fit,
        grade: x.judge.grade,
        flags: x.judge.flags,
        checkFail: x.judge.checkFail,
        critique: x.judge.critique,
      } : null,
      review: x.review,
    }));
}

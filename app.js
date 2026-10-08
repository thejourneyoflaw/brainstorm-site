const $ = s => document.querySelector(s);
const state = { date: null, data: null, section: 'ideas' };
let IDEAS_DATA = null;
let IDX = [];

const TAG_CLS = {
  法律: 't-law', 商务: 't-biz', 金融: 't-fin', 经济: 't-eco',
  动漫: 't-ani', 技术: 't-tech', 产品: 't-prod', 副业: 't-side', 内容: 't-content',
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function todayLocal() {
  const off = new Date().getTimezoneOffset();
  return new Date(Date.now() - off * 60000).toISOString().slice(0, 10);
}

function md(date) {
  return date.slice(5).replace('-', '/');
}

const SAMPLE = new URLSearchParams(location.search).has('sample');

async function init() {
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => setSection(b.dataset.sec)));
  try { IDX = await (await fetch('data/index.json')).json(); } catch { IDX = []; }
  if (SAMPLE) {
    loadDay('sample');
  } else if (IDX.length) {
    loadDay(IDX[0].date);
  } else {
    $('#feed-meta').textContent = '';
    $('#content').innerHTML = `<div class="empty"><span class="big">✦</span>还没有任何数据。<br>每天 08:30 自动更新；也可以在项目目录运行 <code>node collect.mjs</code> 立即生成。</div>`;
  }
}

function setSection(sec) {
  state.section = sec;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.sec === sec));
  if (sec === 'frontier') {
    loadFrontier();
  } else if (sec === 'archive') {
    renderArchiveView();
  } else if (IDEAS_DATA) {
    state.data = IDEAS_DATA;
    render();
  } else if (IDX.length) {
    loadDay(IDX[0].date);
  }
}

// 按月归档：今日脑洞与前沿关注分开归档，点击进入当期
let FRONTIER_IDX = [];
async function renderArchiveView() {
  $('#day-title').textContent = '历史归档';
  $('#feed-meta').textContent = '「今日脑洞」与「前沿关注」分开归档 · 点击任意一天进入当期';
  try { FRONTIER_IDX = await (await fetch('data/frontier-index.json')).json(); } catch { FRONTIER_IDX = []; }
  const html = monthGroups(IDX, 'ideas', '今日脑洞') + monthGroups(FRONTIER_IDX, 'frontier', '前沿关注');
  $('#content').innerHTML = `<div class="archive-page">${html}</div>`;
  document.querySelectorAll('.day-card').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.sec === 'frontier') {
      state.section = 'frontier';
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.sec === 'frontier'));
      loadFrontierDay(b.dataset.date);
    } else {
      setSection('ideas');
      loadDay(b.dataset.date);
    }
  }));
}

async function loadFrontierDay(date) {
  state.date = date;
  $('#content').innerHTML = '<div class="empty">加载中…</div>';
  try { state.data = await (await fetch(`data/frontier-${date}.json`)).json(); } catch {
    $('#content').innerHTML = '<div class="empty">这一期加载失败。</div>';
    return;
  }
  renderFrontier();
}

function monthGroups(list, sec, label) {
  if (!list.length) {
    return `<div class="arc-group"><div class="arc-head">${label}<span class="month-cnt">暂无归档</span></div><div class="empty" style="padding:14px">这一板块还没有数据，每天 08:30 自动生成。</div></div>`;
  }
  const months = {};
  list.forEach(x => { const ym = x.date.slice(0, 7); (months[ym] = months[ym] || []).push(x); });
  const groups = Object.keys(months).sort().reverse().map(ym => {
    const days = months[ym];
    const [y, m] = ym.split('-');
    return `<div class="month-label">${y}年${Number(m)}月<span class="month-cnt">${days.length} 期</span></div><div class="month-days">${days.map(x => `<button class="day-card" data-sec="${sec}" data-date="${x.date}"><b>${md(x.date)}</b><span class="mono">${x.count} 条</span></button>`).join('')}</div>`;
  }).join('');
  return `<div class="arc-group"><div class="arc-head">${label}<span class="month-cnt">共 ${list.length} 期</span></div>${groups}</div>`;
}

function cardHTML(x, isTop) {
  const score = x.score ?? x.funScore ?? 0;
  const tier = score >= 75 ? 'fun-hi' : score >= 62 ? 'fun-mid' : 'fun-low';
  const tags = (x.tags || []).map(t => `<span class="tag ${TAG_CLS[t] || 't-other'}">${esc(t)}</span>`).join('');
  const nq = x.news || {};
  const aihotLink = nq.aihotUrl ? ` · <a href="${esc(nq.aihotUrl)}" target="_blank" rel="noopener">AIHOT 页面</a>` : '';
  const v = x.verdict;
  const rv = x.review;
  const tips = [];
  if (v) tips.push(`评委五维：新颖 ${v.novelty}/20 · 有用 ${v.usefulness}/20 · 可落地 ${v.feasibility}/25 · 时机 ${v.timing}/15 · 契合 ${v.fit}/15 → ${v.grade || ''}`);
  if (v?.flags?.length) tips.push('一票否决：' + v.flags.join('/'));
  if (v?.checkFail?.length) tips.push('自检未过：' + v.checkFail.join('、'));
  if (v?.critique) tips.push('评委毒评：' + v.critique);
  if (rv) tips.push(`异模型终审（${rv.model || ''}）：关联${rv.linkTruth ? '✓' : '✗'} 可落地${rv.actionable ? '✓' : '✗'} 有趣${rv.interesting ? '✓' : '✗'} 合规${rv.compliant ? '✓' : '✗'}${rv.reason ? ' — ' + rv.reason : ''}`);
  const tip = tips.length ? ` title="${esc(tips.join(' ｜ '))}"` : '';
  const gradeCls = v?.grade === 'GO' ? 'ok' : v?.grade === '降位' ? 'mid' : 'warn-tag';
  const plan = Array.isArray(x.plan) && x.plan.length
    ? `<div class="plan"><div class="plan-label">落地路线</div><ol>${x.plan.map(s => `<li>${esc(s)}</li>`).join('')}</ol></div>`
    : '';
  const headLine = x.field
    ? `<div class="field-row"><span class="field">${esc(x.field)}</span></div>`
    : (x.angle ? `<div class="angle">${esc(x.angle)}</div>` : '');
  return `
  <div class="tl-item${isTop ? ' top' : ''}">
    <span class="tl-dot"></span>
    <article class="card">
      <div class="card-head">
        <span class="rank mono">#${x.rank}</span>
        <span class="src">${esc(nq.source || '')}</span>
        ${v?.grade ? `<span class="grade ${gradeCls}"${tip}>${esc(v.grade)}</span>` : ''}
        <span class="fun ${tier}"${tip}>评分 ${score}</span>
        ${rv ? `<span class="grade ${rv.approved ? 'ok' : 'warn-tag'}"${tip}>${rv.approved ? '✓ 终审' : '⚠ 终审'}</span>` : ''}
      </div>
      <h2 class="card-title">${esc(x.title)}</h2>
      ${headLine}
      ${tags ? `<div class="tags">${tags}</div>` : ''}
      <div class="idea">${esc(x.idea)}</div>
      ${plan}
      ${x.deliverable ? `<div class="meta-line"><b>产出</b>${esc(x.deliverable)}</div>` : ''}
      ${x.risk ? `<div class="meta-line risk"><b>难点</b>${esc(x.risk)}</div>` : ''}
      ${!plan && x.firstStep ? `<div class="step"><b>第一步</b>${esc(x.firstStep)}</div>` : ''}
      ${nq.title ? `<div class="news-quote">关联动态：<a href="${esc(nq.url)}" target="_blank" rel="noopener">「${esc(nq.title)}」</a>${aihotLink}
        <span class="nq-src">${esc(nq.source || '')}</span></div>` : ''}
    </article>
  </div>`;
}

function renderFallback(d) {
  const list = d.fallback || [];
  $('#content').innerHTML =
    (d.warnings && d.warnings.length ? `<div class="warn-banner">⚠ ${esc(d.warnings.join('；'))} —— 今日先用高分资讯占位，修好后重跑 <code>node collect.mjs</code>。</div>` : '') +
    (list.length ? list.map(x => `
  <div class="tl-item">
    <span class="tl-dot"></span>
    <article class="card">
      <div class="card-head">
        <span class="rank mono">#${x.rank}</span>
        <span class="src">${esc(x.source || '')}</span>
        ${x.score ? `<span class="fun fun-mid">热度 ${x.score}</span>` : ''}
      </div>
      <h2 class="card-title">${esc(x.title)}</h2>
      ${x.summary ? `<div class="sum">${esc(x.summary)}</div>` : ''}
      <div class="news-quote"><a href="${esc(x.url)}" target="_blank" rel="noopener">阅读原文 ↗</a>${x.aihotUrl ? ` · <a href="${esc(x.aihotUrl)}" target="_blank" rel="noopener">AIHOT 页面</a>` : ''}</div>
    </article>
  </div>`).join('') : '<div class="empty">今天没有生成数据。</div>');
}

init();

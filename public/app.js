const $ = s => document.querySelector(s);
const state = { date: null, data: null };
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
  try { IDX = await (await fetch('/data/index.json')).json(); } catch { IDX = []; }
  if (SAMPLE) {
    loadDay('sample');
  } else if (IDX.length) {
    loadDay(IDX[0].date);
  } else {
    $('#feed-meta').textContent = '';
    $('#content').innerHTML = `<div class="empty"><span class="big">✦</span>还没有任何数据。<br>每天 08:30 自动更新；也可以在项目目录运行 <code>node collect.mjs</code> 立即生成。</div>`;
  }
}

// 标题下一行的日期信息 + 前后日切换
function renderMeta(d) {
  const i = IDX.findIndex(x => x.date === d.date);
  const older = i >= 0 && i + 1 < IDX.length ? IDX[i + 1] : null;
  const newer = i > 0 ? IDX[i - 1] : null;
  const link = (item, ch) => item
    ? `<a class="day-link" data-date="${item.date}" title="${item.date}">${ch}</a>`
    : `<span class="day-off">${ch}</span>`;
  const gen = d.generatedAt ? new Date(d.generatedAt).toLocaleString('zh-CN', { hour12: false }) : '';
  $('#feed-meta').innerHTML =
    `${link(older, '‹')}${md(d.date)}${link(newer, '›')}` +
    `<span class="dot">·</span>${(d.ideas || d.fallback || []).length} 条` +
    `<span class="dot">·</span>候选资讯 ${d.sourceCount} 条` +
    (gen ? `<span class="dot">·</span>生成于 ${esc(gen)}` : '');
  document.querySelectorAll('.day-link').forEach(a =>
    a.addEventListener('click', e => { e.preventDefault(); loadDay(a.dataset.date); }));
}

async function loadDay(date) {
  state.date = date;
  $('#content').innerHTML = '<div class="empty">加载中…</div>';
  const url = date === 'sample' ? '/data/sample-20.json' : `/data/${date}.json`;
  try {
    state.data = await (await fetch(url)).json();
  } catch {
    $('#content').innerHTML = '<div class="empty">这一批数据加载失败。</div>';
    return;
  }
  render();
}

function render() {
  const d = state.data;
  const gen = d.generatedAt ? new Date(d.generatedAt).toLocaleString('zh-CN', { hour12: false }) : '';
  if (d.date === 'sample') {
    const n = (d.ideas || d.fallback || []).length;
    $('#day-title').textContent = `样例 · ${n} 个创意`;
    $('#feed-meta').innerHTML =
      `样例批次<span class="dot">·</span>${n} 条` +
      `<span class="dot">·</span>候选资讯 ${d.sourceCount} 条` +
      (d.review ? `<span class="dot">·</span>异模型终审通过 ${d.review.approved}/${d.review.total}` : '') +
      (gen ? `<span class="dot">·</span>生成于 ${esc(gen)}` : '');
  } else {
    $('#day-title').textContent = d.date === todayLocal() ? '今日脑洞' : `${d.date.slice(5).replace('-', '/')} 的脑洞`;
    renderMeta(d);
  }

  const ideas = d.ideas || [];
  if (!ideas.length) { renderFallback(d); return; }

  const topScore = Math.max(...ideas.map(x => x.score ?? x.funScore ?? 0));
  $('#content').innerHTML =
    (d.warnings && d.warnings.length ? `<div class="warn-banner">⚠ ${esc(d.warnings.join('；'))}</div>` : '') +
    ideas.map(x => cardHTML(x, (x.score ?? x.funScore) === topScore)).join('');
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

const $ = s => document.querySelector(s);
const state = { date: null, data: null, section: 'ideas' };
let IDEAS_DATA = null;
let IDX = [];
let FRONTIER_IDX = [];

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

/* 深浅主题 */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = $('#theme-toggle');
  if (btn) { btn.textContent = theme === 'dark' ? '🌙' : '☀️'; btn.title = theme === 'dark' ? '切换浅色模式' : '切换深色模式'; }
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('theme', next);
  applyTheme(next);
}

async function init() {
  applyTheme(localStorage.getItem('theme') || 'light');
  const themeBtn = $('#theme-toggle');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => setSection(b.dataset.sec)));
  try { IDX = await (await fetch('data/index.json')).json(); } catch { IDX = []; }
  if (SAMPLE) loadDay('sample');
  else if (IDX.length) loadDay(IDX[0].date);
  else {
    $('#feed-meta').textContent = '';
    $('#content').innerHTML = '<div class="empty"><span class="big">✦</span>还没有任何数据。<br>每天 08:30 自动更新。</div>';
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

async function loadDay(date) {
  state.date = date;
  $('#content').innerHTML = '<div class="empty">加载中…</div>';
  const url = date === 'sample' ? 'data/sample-20.json' : 'data/' + date + '.json';
  try {
    state.data = await (await fetch(url)).json();
    IDEAS_DATA = state.data;
  } catch {
    $('#content').innerHTML = '<div class="empty">这一批数据加载失败。</div>';
    return;
  }
  render();
}

async function loadFrontier() {
  state.data = null;
  $('#day-title').textContent = '前沿关注';
  $('#feed-meta').textContent = '';
  $('#content').innerHTML = '<div class="empty">加载中…</div>';
  try {
    state.data = await (await fetch('data/frontier-latest.json')).json();
  } catch {
    $('#content').innerHTML = '<div class="empty">还没有前沿关注数据。<br>每天 08:30 会自动检查关注公众号的更新。</div>';
    return;
  }
  renderFrontier();
}

async function loadFrontierDay(date) {
  state.date = date;
  $('#content').innerHTML = '<div class="empty">加载中…</div>';
  try {
    state.data = await (await fetch('data/frontier-' + date + '.json')).json();
  } catch {
    $('#content').innerHTML = '<div class="empty">这一期加载失败。</div>';
    return;
  }
  renderFrontier();
}

function render() {
  if (state.section === 'frontier') { renderFrontier(); return; }
  const d = state.data;
  const gen = d.generatedAt ? new Date(d.generatedAt).toLocaleString('zh-CN', { hour12: false }) : '';
  if (d.date === 'sample') {
    const n = (d.ideas || d.fallback || []).length;
    $('#day-title').textContent = '样例 · ' + n + ' 个创意';
    let metaHtml = '<span>样例批次</span><span class="dot">·</span>' + n + ' 条' +
      '<span class="dot">·</span>候选资讯 ' + d.sourceCount + ' 条' +
      (d.review ? '<span class="dot">·</span>异模型终审通过 ' + d.review.approved + '/' + d.review.total : '') +
      (gen ? '<span class="dot">·</span>生成于 ' + esc(gen) : '');
    $('#feed-meta').innerHTML = metaHtml;
  } else {
    $('#day-title').textContent = d.date === todayLocal() ? '今日脑洞' : md(d.date) + ' 的脑洞';
    renderMeta(d);
  }
  const ideas = d.ideas || [];
  if (!ideas.length) { renderFallback(d); return; }
  const topScore = Math.max(...ideas.map(x => x.score ?? x.funScore ?? 0));
  let html = '';
  if (d.notice) html += '<div class="info-banner">ℹ ' + esc(d.notice) + '</div>';
  if (d.warnings && d.warnings.length) html += '<div class="warn-banner">⚠ ' + esc(d.warnings.join('；')) + '</div>';
  for (const x of ideas) html += cardHTML(x, (x.score ?? x.funScore) === topScore);
  $('#content').innerHTML = html;
}

function renderMeta(d) {
  const i = IDX.findIndex(x => x.date === d.date);
  const older = i >= 0 && i + 1 < IDX.length ? IDX[i + 1] : null;
  const newer = i > 0 ? IDX[i - 1] : null;
  const link = (item, ch) => item
    ? '<a class="day-link" data-date="' + item.date + '" title="' + item.date + '">' + ch + '</a>'
    : '<span class="day-off">' + ch + '</span>';
  const gen = d.generatedAt ? new Date(d.generatedAt).toLocaleString('zh-CN', { hour12: false }) : '';
  let metaHtml = link(older, '‹') + md(d.date) + link(newer, '›') +
    '<span class="dot">·</span>' + (d.ideas || d.fallback || []).length + ' 条' +
    '<span class="dot">·</span>候选资讯 ' + d.sourceCount + ' 条' +
    (gen ? '<span class="dot">·</span>生成于 ' + esc(gen) : '');
  $('#feed-meta').innerHTML = metaHtml;
  document.querySelectorAll('.day-link').forEach(a =>
    a.addEventListener('click', e => { e.preventDefault(); loadDay(a.dataset.date); }));
}

function renderFrontier() {
  const d = state.data;
  const gen = d.generatedAt ? new Date(d.generatedAt).toLocaleString('zh-CN', { hour12: false }) : '';
  const isToday = d.date === todayLocal();
  $('#day-title').textContent = isToday ? '前沿关注 · 今天' : '前沿关注 · ' + md(d.date);
  const ch = d.channels || {};
  let metaHtml = '覆盖 ' + (d.targets || []).length + ' 个公众号' +
    '<span class="dot">·</span>本批分析 ' + (d.items || []).length + ' 篇' +
    '<span class="dot">·</span>发现通道：AIHOT' +
    (gen ? '<span class="dot">·</span>检查于 ' + esc(gen) : '');
  $('#feed-meta').innerHTML = metaHtml;
  const items = d.items || [];
  if (items.length) {
    let cardsHtml = '';
    for (const x of items) cardsHtml += frCardHTML(x);
    $('#content').innerHTML = cardsHtml;
  } else {
    $('#content').innerHTML = '<div class="empty"><span class="big">📡</span>这一批没有发现关注公众号的新文章。<br>你读到好文章时，把链接贴进 data/frontier-links.txt，AI 会自动分析归档。</div>';
  }
}

function frCardHTML(x) {
  let html = '<div class="tl-item"><span class="tl-dot"></span><article class="card">';
  html += '<div class="card-head"><span class="field">' + esc(x.account) + '</span>';
  html += '<span class="src">' + (x.publishedAt ? esc(String(x.publishedAt).slice(0, 10)) : '') + '</span>';
  if (!x.analyzed) html += '<span class="grade warn-tag">未完整分析</span>';
  html += '</div>';
  html += '<h2 class="card-title"><a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.title) + '</a></h2>';
  html += '<div class="fr-block"><div class="fr-label">讲了什么</div><div class="fr-body">' + esc(x.digest) + '</div></div>';
  if (x.significance) html += '<div class="fr-block"><div class="fr-label">有什么意义</div><div class="fr-body">' + esc(x.significance) + '</div></div>';
  if ((x.applications || []).length) {
    html += '<div class="fr-block"><div class="fr-label">可以怎么用</div><ul class="fr-apps">';
    for (const s of x.applications) html += '<li>' + esc(s) + '</li>';
    html += '</ul></div>';
  }
  if ((x.tags || []).length) {
    html += '<div class="tags">';
    for (const t of x.tags) html += '<span class="tag ' + (TAG_CLS[t] || 't-other') + '">' + esc(t) + '</span>';
    html += '</div>';
  }
  html += '<div class="news-quote"><a href="' + esc(x.url) + '" target="_blank" rel="noopener">阅读原文 ↗</a><span class="nq-src">微信公众号 · ' + esc(x.account) + '</span></div>';
  html += '</article></div>';
  return html;
}

// 按月归档：今日脑洞与前沿关注分开归档，点击进入当期
async function renderArchiveView() {
  $('#day-title').textContent = '历史归档';
  $('#feed-meta').textContent = '「今日脑洞」与「前沿关注」分开归档 · 点击任意一天进入当期';
  try { FRONTIER_IDX = await (await fetch('data/frontier-index.json')).json(); } catch { FRONTIER_IDX = []; }
  const html = monthGroups(IDX, 'ideas', '今日脑洞') + monthGroups(FRONTIER_IDX, 'frontier', '前沿关注');
  $('#content').innerHTML = '<div class="archive-page">' + html + '</div>';
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

function monthGroups(list, sec, label) {
  if (!list.length) {
    return '<div class="arc-group"><div class="arc-head">' + label + '<span class="month-cnt">暂无归档</span></div><div class="empty" style="padding:14px">这一板块还没有数据，每天 08:30 自动生成。</div></div>';
  }
  const months = {};
  list.forEach(x => { const ym = x.date.slice(0, 7); (months[ym] = months[ym] || []).push(x); });
  let groups = '';
  Object.keys(months).sort().reverse().forEach(ym => {
    const days = months[ym];
    const parts = ym.split('-');
    groups += '<div class="month-label">' + parts[0] + '年' + Number(parts[1]) + '月<span class="month-cnt">' + days.length + ' 期</span></div><div class="month-days">';
    for (const x of days) {
      groups += '<button class="day-card" data-sec="' + sec + '" data-date="' + x.date + '"><b>' + md(x.date) + '</b><span class="mono">' + x.count + ' 条</span></button>';
    }
    groups += '</div>';
  });
  return '<div class="arc-group"><div class="arc-head">' + label + '<span class="month-cnt">共 ' + list.length + ' 期</span></div>' + groups + '</div>';
}

function cardHTML(x, isTop) {
  const score = x.score ?? x.funScore ?? 0;
  const tier = score >= 75 ? 'fun-hi' : score >= 62 ? 'fun-mid' : 'fun-low';
  const nq = x.news || {};
  const v = x.verdict;
  const rv = x.review;
  const tip = v
    ? ' title="评委五维：新颖 ' + v.novelty + '/20 · 有用 ' + v.usefulness + '/20 · 可落地 ' + v.feasibility + '/25 · 时机 ' + v.timing + '/15 · 契合 ' + v.fit + '/15 → ' + (v.grade || '') + ((v.flags && v.flags.length) ? ' ⚠' + v.flags.join('/') : '') + (v.critique ? ' — 毒评：' + v.critique : '') + '"'
    : '';
  const gradeCls = v && v.grade === 'GO' ? 'ok' : v && v.grade === '降位' ? 'mid' : 'warn-tag';
  const plan = Array.isArray(x.plan) && x.plan.length
    ? '<div class="plan"><div class="plan-label">落地路线</div><ol>' + x.plan.map(s => '<li>' + esc(s) + '</li>').join('') + '</ol></div>'
    : '';
  const headLine = x.field
    ? '<div class="field-row"><span class="field">' + esc(x.field) + '</span></div>'
    : (x.angle ? '<div class="angle">' + esc(x.angle) + '</div>' : '');
  let tagsHtml = '';
  for (const t of (x.tags || [])) tagsHtml += '<span class="tag ' + (TAG_CLS[t] || 't-other') + '">' + esc(t) + '</span>';
  let html = '<div class="tl-item' + (isTop ? ' top' : '') + '"><span class="tl-dot"></span><article class="card">';
  html += '<div class="card-head"><span class="rank mono">#' + x.rank + '</span>';
  html += '<span class="src">' + esc(nq.source || '') + '</span>';
  if (v && v.grade) html += '<span class="grade ' + gradeCls + '"' + tip + '>' + esc(v.grade) + '</span>';
  html += '<span class="fun ' + tier + '"' + tip + '>评分 ' + score + '</span>';
  if (rv) html += '<span class="grade ' + (rv.approved ? 'ok' : 'warn-tag') + '"' + tip + '>' + (rv.approved ? '✓ 终审' : '⚠ 终审') + '</span>';
  html += '</div>';
  html += '<h2 class="card-title">' + esc(x.title) + '</h2>';
  html += headLine;
  if (tagsHtml) html += '<div class="tags">' + tagsHtml + '</div>';
  html += '<div class="idea">' + esc(x.idea) + '</div>';
  html += plan;
  if (x.deliverable) html += '<div class="meta-line"><b>产出</b>' + esc(x.deliverable) + '</div>';
  if (x.risk) html += '<div class="meta-line risk"><b>难点</b>' + esc(x.risk) + '</div>';
  if (!plan && x.firstStep) html += '<div class="step"><b>第一步</b>' + esc(x.firstStep) + '</div>';
  if (nq.title) {
    html += '<div class="news-quote">关联动态：<a href="' + esc(nq.url) + '" target="_blank" rel="noopener">「' + esc(nq.title) + '」</a>' + (nq.aihotUrl ? ' · <a href="' + esc(nq.aihotUrl) + '" target="_blank" rel="noopener">AIHOT 页面</a>' : '');
    html += '<span class="nq-src">' + esc(nq.source || '') + '</span></div>';
  }
  html += '</article></div>';
  return html;
}

function renderFallback(d) {
  const list = d.fallback || [];
  let html = '';
  if (d.warnings && d.warnings.length) html += '<div class="warn-banner">⚠ ' + esc(d.warnings.join('；')) + '</div>';
  if (list.length) {
    for (const x of list) {
      html += '<div class="tl-item"><span class="tl-dot"></span><article class="card">';
      html += '<div class="card-head"><span class="rank mono">#' + x.rank + '</span><span class="src">' + esc(x.source || '') + '</span></div>';
      html += '<h2 class="card-title">' + esc(x.title) + '</h2>';
      if (x.summary) html += '<div class="sum">' + esc(x.summary) + '</div>';
      html += '<div class="news-quote"><a href="' + esc(x.url) + '" target="_blank" rel="noopener">阅读原文 ↗</a></div>';
      html += '</article></div>';
    }
  } else {
    html += '<div class="empty">这一板块还没有数据。</div>';
  }
  $('#content').innerHTML = html;
}

init();

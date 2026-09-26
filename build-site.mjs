// 构建 GitHub Pages 站点快照到 site/（公开站：代码 + 数据快照）
// 用法：node build-site.mjs
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/llm.mjs';

const site = path.join(ROOT, 'site');
fs.rmSync(site, { recursive: true, force: true });
fs.mkdirSync(path.join(site, 'data'), { recursive: true });

// 前端
for (const f of ['index.html', 'style.css', 'app.js']) {
  fs.copyFileSync(path.join(ROOT, 'public', f), path.join(site, f));
}
// 数据：归档索引 + 样例 + 每日数据
const dataDir = path.join(ROOT, 'data');
for (const f of fs.readdirSync(dataDir)) {
  if (f === 'index.json' || /^\d{4}-\d{2}-\d{2}\.json$/.test(f) || f === 'sample-20.json') {
    fs.copyFileSync(path.join(dataDir, f), path.join(site, 'data', f));
  }
}
// Pages 关闭 Jekyll 处理
fs.writeFileSync(path.join(site, '.nojekyll'), '');

const files = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else files.push(path.relative(site, p));
  }
})(site);
console.log(`站点快照已构建到 site/（${files.length} 个文件）`);

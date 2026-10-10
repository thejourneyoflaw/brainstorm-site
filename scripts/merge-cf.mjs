// 把 Cloudflare Worker 的发现结果合并进收件箱（data/frontier-links.txt）
// 用法：node scripts/merge-cf.mjs [cf.json路径] [links文件路径]
import fs from 'node:fs';

const file = process.argv[2] || '/tmp/cf.json';
const links = process.argv[3] || 'data/frontier-links.txt';
let items = [];
try { items = JSON.parse(fs.readFileSync(file, 'utf8')).items || []; } catch {}
const existing = new Set(
  fs.existsSync(links) ? fs.readFileSync(links, 'utf8').split(/\r?\n/).map(s => s.trim()) : []
);
let added = 0;
for (const it of items) {
  if (!it.url || !/mp\.weixin\.qq\.com/.test(it.url)) continue;
  const line = `${it.url} | ${it.account || ''}`;
  if (existing.has(line)) continue;
  fs.appendFileSync(links, line + '\n');
  existing.add(line);
  added++;
}
console.log('worker discoveries merged:', added);

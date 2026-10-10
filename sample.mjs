// 样例生成：跑一遍完整管线（草稿→闸一→精修→闸二终审），输出 20 个创意样例
// 用法：node sample.mjs   →  data/sample-20.json  →  http://127.0.0.1:4321/?sample=1
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, ROOT } from './lib/llm.mjs';
import { gatherCandidates } from './lib/sources.mjs';
import { generateIdeas } from './lib/ideas.mjs';

async function main() {
  loadEnv();
  console.log('样例生成：20 个创意（12 条法律/金融/经济 + 8 条不限领域）…');
  const { candidates, warnings, counts } = await gatherCandidates();
  console.log(`   候选 ${candidates.length} 条（AIHOT ${counts.aihot} · AI工具集 ${counts.aibot}）`);
  if (!candidates.length) {
    console.error('没有候选资讯，退出。');
    process.exit(1);
  }

  const ideas = await generateIdeas(candidates, { profCount: 12, openCount: 8 });

  // MERGE=1：与已有样例合并（按资讯 url 去重，总分高者优先），方便分几轮凑齐 20 条
  const outFile = path.join(ROOT, 'data', 'sample-20.json');
  let merged = ideas;
  if (process.env.MERGE === '1' && fs.existsSync(outFile)) {
    try {
      const prev = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      const seen = new Set();
      merged = [...(prev.ideas || []), ...ideas]
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .filter(x => (seen.has(x.news?.url) ? false : (seen.add(x.news?.url), true)))
        .slice(0, 20)
        .map((x, i) => ({ ...x, rank: i + 1 }));
      console.log(`   合并上一轮样例：累计 ${merged.length} 条`);
    } catch { /* 读不到就当没有 */ }
  }

  const record = {
    date: 'sample',
    title: '样例 · 20 个创意',
    generatedAt: new Date().toISOString(),
    sourceCount: candidates.length,
    sourceCounts: counts,
    ideas: merged,
    review: {
      models: [...new Set(merged.map(i => i.review?.model).filter(Boolean))],
      approved: merged.filter(i => i.review?.approved).length,
      total: merged.length,
    },
    warnings,
  };
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(record, null, 2), 'utf8');
  console.log(`③ 已写入 data/sample-20.json（${merged.length} 条）`);
  console.log('   打开 http://127.0.0.1:4321/?sample=1 查看');
}

main().catch(e => { console.error('样例生成失败:', e); process.exit(1); });

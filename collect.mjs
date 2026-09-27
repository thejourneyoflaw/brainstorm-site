import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, ROOT } from './lib/llm.mjs';
import { gatherCandidates } from './lib/sources.mjs';
import { generateIdeas } from './lib/ideas.mjs';

function localDate(d = new Date()) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

async function main() {
  loadEnv();
  const date = localDate();
  const dataDir = path.join(ROOT, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });

  console.log(`① 抓取资讯源（${date}）…`);
  const { candidates, warnings, counts } = await gatherCandidates();
  console.log(`   候选 ${candidates.length} 条（AIHOT ${counts.aihot} · AI工具集 ${counts.aibot}）${warnings.length ? `\n   ⚠ ${warnings.join('；')}` : ''}`);
  if (!candidates.length) {
    console.error('没有任何候选资讯，退出。');
    process.exit(1);
  }

  let ideas = null;
  let model = null;
  console.log('② AI 策展：分池草稿 → 闸一自检+五维初筛 → 精修 → 闸二异模型终审（约 5-8 分钟）…');
  try {
    ideas = await generateIdeas(candidates);
    model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
    console.log(`   生成 ${ideas.length} 个脑洞`);
  } catch (e) {
    warnings.push(`AI 策展失败: ${e.message}`);
  }

  // 前沿关注由 frontier.mjs 独立跑（run-daily.bat 里排在 collect 之后）

  const notice = ideas && ideas.length < 10 ? `今天达标 ${ideas.length} 条（目标 10，其余未过审或候选不足）` : null;

  const record = {
    date,
    generatedAt: new Date().toISOString(),
    model,
    sourceCount: candidates.length,
    sourceCounts: counts,
    ideas,
    notice,
    review: ideas ? {
      models: [...new Set(ideas.map(i => i.review?.model).filter(Boolean))],
      approved: ideas.filter(i => i.review?.approved).length,
      total: ideas.length,
    } : null,
    fallback: ideas ? null : candidates.slice(0, 10).map((c, i) => ({
      rank: i + 1,
      title: c.title,
      summary: c.summary,
      url: c.url,
      aihotUrl: c.aihotUrl,
      source: c.source,
      score: c.score,
    })),
    warnings,
  };

  fs.writeFileSync(path.join(dataDir, `${date}.json`), JSON.stringify(record, null, 2), 'utf8');

  // 重建归档索引
  const index = fs.readdirSync(dataDir)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map(f => {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
        return { date: j.date, count: (j.ideas || j.fallback || []).length, model: j.model, generatedAt: j.generatedAt };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.date.localeCompare(a.date));
  fs.writeFileSync(path.join(dataDir, 'index.json'), JSON.stringify(index, null, 2), 'utf8');

  console.log(`③ 已写入 data/${date}.json（归档共 ${index.length} 天）`);
  console.log('   运行 node server.mjs 后打开 http://127.0.0.1:4321 查看');
}

main().catch(e => { console.error('采集失败:', e); process.exit(1); });

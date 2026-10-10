// 诊断工具：逐个测试 .env 里的渠道通不通  →  node test-llm.mjs
import { listProviders } from './lib/llm.mjs';

const ps = listProviders();
console.log(`发现 ${ps.length} 个渠道，逐个测试…\n`);
for (const p of ps) {
  try {
    const res = await fetch(p.base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` },
      body: JSON.stringify({
        model: p.model,
        messages: [{ role: 'user', content: 'reply with {"ok":true}' }],
        max_tokens: 30,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(45000),
    });
    const t = (await res.text()).replace(/\s+/g, ' ').slice(0, 140);
    console.log(`${res.ok ? '✅' : '❌'} ${p.name} (${p.model}) → ${res.status} ${t}`);
  } catch (e) {
    console.log(`❌ ${p.name} (${p.model}) → ${e.message}`);
  }
}

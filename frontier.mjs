// 前沿关注入口：node frontier.mjs
import { runFrontier } from './lib/frontier.mjs';

runFrontier().catch(e => { console.error('前沿关注生成失败:', e); process.exit(1); });

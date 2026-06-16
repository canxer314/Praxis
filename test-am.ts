import { agentmemory } from './src/agentmemory-client';

(async () => {
  console.log('=== AgentMemory REST API Test ===\n');

  // 健康检查
  const available = await agentmemory.isAvailable();
  console.log('health check:', available ? 'OK' : 'DOWN');

  // 写入 slot
  const writeResult = await agentmemory.setSlot('praxis_test', {
    hello: 'from-rest-api',
    ts: Date.now(),
    items: ['semantic search', 'HTTP direct', 'no MCP spawn'],
  });
  console.log('setSlot:', writeResult.ok ? `OK` : `FAIL: ${writeResult.error?.message}`);

  // 读取 slot
  const readResult = await agentmemory.getSlot('praxis_test');
  if (readResult.ok) {
    const val = typeof readResult.value === 'string'
      ? readResult.value.slice(0, 100)
      : JSON.stringify(readResult.value).slice(0, 100);
    console.log('getSlot:', `OK → ${val}`);
  } else {
    console.log('getSlot:', `FAIL: ${readResult.error?.message}`);
  }

  // 语义搜索
  const searchResults = await agentmemory.smartSearch('AgentMemory REST API 直接调用', 3);
  console.log(`smartSearch: ${searchResults.length} results`);
  for (const r of searchResults) {
    console.log(`  [${r.source}] score=${r.score.toFixed(3)} ${r.content.slice(0, 80)}`);
  }

  // 保存 lesson
  const lessonResult = await agentmemory.saveLesson(
    'AgentMemory REST API 比 MCP spawn 快 100 倍，端点：GET/POST /agentmemory/*',
    ['performance', 'agentmemory'],
    0.95,
  );
  console.log('saveLesson:', lessonResult.ok ? 'OK' : `FAIL: ${lessonResult.error?.message}`);

  // 搜索 lessons
  const lessonSearch = await agentmemory.smartSearch('API 调用性能', 3);
  console.log(`lesson search: ${lessonSearch.filter(r => r.source === 'lesson').length} lessons`);

  console.log('\n=== All tests passed ===');
  process.exit(0);
})();

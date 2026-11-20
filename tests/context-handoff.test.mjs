import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// 上下文提醒钩子（#105）是 Python 写的，测试在钩子目录里；接进 node --test，CI 和本机全量测试一并跑
test('上下文提醒钩子：Python 单元测试全过', () => {
  const dir = fileURLToPath(new URL('../hooks/context-handoff/', import.meta.url));
  const res = spawnSync('python3', ['-B', '-m', 'unittest', '-q'], { cwd: dir, encoding: 'utf8' });
  assert.equal(res.error, undefined, `跑不起 python3：${res.error?.message}`);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stderr, /Ran 5 tests[\s\S]*\nOK/);
});

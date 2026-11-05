// 本机装了 codex 时，用它自己的 execpolicy 检查 config/codex/agent-kit.rules；没装就跳过。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const RULES = 'config/codex/agent-kit.rules';
const codex = process.env.CODEX_BIN || 'codex';
const has = spawnSync(codex, ['--version'], { encoding: 'utf8' }).status === 0;

const decision = cmd => {
  const r = spawnSync(codex, ['execpolicy', 'check', '--rules', RULES, ...cmd.split(' ')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).decision ?? 'none';
};

test('Codex 执行策略：强推/删除 main 禁止，合并和推 main 先问，正常推分支放行', { skip: !has && '本机没有 codex 命令' }, () => {
  const cases = {
    'git push --force origin main': 'forbidden',
    'git push origin main --force': 'forbidden',
    'git push --force-with-lease origin main': 'forbidden',
    'git push origin +main': 'forbidden',
    'git push origin --delete master': 'forbidden',
    'git push origin main': 'prompt',
    'git push -f origin feature': 'prompt',
    'gh pr merge 9 --squash': 'prompt',
    'git reset --hard origin/main': 'prompt',
    'git push --force-with-lease origin feature': 'none',
    'git push -u origin claude/9-x': 'none',
    'git status': 'none',
  };
  for (const [cmd, want] of Object.entries(cases)) assert.equal(decision(cmd), want, cmd);
});

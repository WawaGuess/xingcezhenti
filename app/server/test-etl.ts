import assert from 'node:assert/strict';
import { parseContent } from './parse.js';
import { config } from './config.js';

const { papers, stats } = parseContent(config.contentDir);

console.log(JSON.stringify(stats, null, 2));

assert.equal(stats.notes, 2956, '笔记数');
assert.equal(stats.papers, 515, '试卷数');
assert.equal(stats.questions, 58890, '题目数');
assert.equal(stats.judge, 111, '判断题数');
assert.equal(stats.multi, 405, '多选题数');
assert.equal(stats.unscorable, 4, '不可判分题数');
assert.equal(stats.optionCounts[4], 58737, '四选项题数');
assert.equal(stats.optionCounts[8], 40, '八选项题数');
assert.equal(stats.optionCounts[2], 111, '判断题合成两选项');

const ids = new Set<string>();
let duplicates = 0;
for (const p of papers) {
  for (const m of p.modules) {
    for (const q of m.questions) {
      if (ids.has(q.qid)) duplicates += 1;
      else ids.add(q.qid);
      if (!q.scorable) assert.equal(q.answer, '');
      for (const o of q.options) {
        assert.ok(o.html.length >= 0);
      }
    }
  }
}

assert.equal(ids.size, 27473, '唯一 qid 数');
assert.equal(duplicates, 31417, '重复出现次数');

console.log(`OK: ${ids.size} 唯一题，${duplicates} 次重复出现`);

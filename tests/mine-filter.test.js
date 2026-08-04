const assert = require('assert')
const { buildMineView } = require('../miniprogram/utils/mine')

const items = [
  { _id: '1', prompt: '开心下班', tags: ['开心', '下班'], reviewStatus: 'private' },
  { _id: '2', prompt: '无语', tags: ['无语'], reviewStatus: 'manual_review' },
  { _id: '3', prompt: '空标签', tags: [], reviewStatus: 'private' },
  { _id: '4', prompt: '公开开心', tags: ['开心'], reviewStatus: 'approved' }
]

const privateView = buildMineView(items, 'private')
assert.deepStrictEqual(privateView.counts, { private: 2, review: 1, public: 1 })
assert.strictEqual(privateView.filtered.length, 2)
assert.ok(privateView.tagFilters.some(item => item.label === '无标签' && item.count === 1))
assert.deepStrictEqual(buildMineView(items, 'private', '', '开心').filtered.map(item => item._id), ['1'])
assert.deepStrictEqual(buildMineView(items, 'private', '', '__untagged__').filtered.map(item => item._id), ['3'])
assert.deepStrictEqual(buildMineView(items, 'public', '开心').filtered.map(item => item._id), ['4'])
assert.strictEqual(buildMineView(items, 'review', '', '不存在').activeTag, '')

console.log('mine filter tests passed')

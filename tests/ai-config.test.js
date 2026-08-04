const assert = require('assert')
const { dailyLimit, loadModels } = require('../cloudfunctions/memeApi/ai-config')

assert.strictEqual(dailyLimit({}), 3)
assert.strictEqual(dailyLimit({ AI_DAILY_LIMIT: '5' }), 5)
assert.strictEqual(dailyLimit({ AI_DAILY_LIMIT: '100' }), 3)
assert.deepStrictEqual(loadModels({}), [])
assert.deepStrictEqual(loadModels({ AI_MODELS_JSON: '{bad' }), [])
assert.deepStrictEqual(loadModels({
  AI_MODELS_JSON: JSON.stringify([
    { id: 'image-fast', name: '快速模型', description: '适合表情草图', aspectRatios: ['1:1', '9:16', 'bad'] },
    { id: 'image-fast', name: '重复模型' },
    { id: 'disabled', name: '停用模型', enabled: false }
  ])
}), [{
  id: 'image-fast',
  name: '快速模型',
  description: '适合表情草图',
  aspectRatios: ['1:1', '9:16']
}])

console.log('AI config tests passed')

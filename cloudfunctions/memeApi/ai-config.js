const DEFAULT_DAILY_LIMIT = 3
const MAX_DAILY_LIMIT = 20
const MAX_MODELS = 12

function cleanText(value, maximum) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maximum)
}

function loadModels(environment = process.env) {
  let input = []
  try {
    input = JSON.parse(environment.AI_MODELS_JSON || '[]')
  } catch (error) {
    return []
  }
  if (!Array.isArray(input)) return []

  const ids = new Set()
  const models = []
  input.forEach(value => {
    if (!value || value.enabled === false || models.length >= MAX_MODELS) return
    const id = cleanText(value.id, 40)
    const name = cleanText(value.name, 30)
    if (!id || !name || !/^[a-z0-9][a-z0-9_-]*$/i.test(id) || ids.has(id)) return
    const aspectRatios = (Array.isArray(value.aspectRatios) ? value.aspectRatios : [])
      .map(item => cleanText(item, 10))
      .filter((item, index, array) => /^(1:1|3:4|4:3|9:16|16:9)$/.test(item) && array.indexOf(item) === index)
      .slice(0, 5)
    ids.add(id)
    models.push({
      id,
      name,
      description: cleanText(value.description, 60),
      aspectRatios: aspectRatios.length ? aspectRatios : ['1:1']
    })
  })
  return models
}

function dailyLimit(environment = process.env) {
  const value = Number(environment.AI_DAILY_LIMIT)
  return Number.isInteger(value) && value >= 1 && value <= MAX_DAILY_LIMIT
    ? value
    : DEFAULT_DAILY_LIMIT
}

module.exports = { dailyLimit, loadModels }

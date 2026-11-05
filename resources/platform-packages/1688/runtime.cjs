'use strict'

const manifest = require('./manifest.json')

const tools = [
  {
    name: 'alibaba_1688_search_products',
    label: '搜索 1688 商品',
    description:
      '【1688 商品搜索】按关键词检索货源，返回公开商品摘要（标题、价格区间、起订量、成交额区间、链接）。' +
      '不返回 Cookie、登录态与店铺内部字段。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '搜索关键词' },
        page: { type: 'integer', description: '页码', minimum: 1, default: 1 }
      },
      required: ['keyword'],
      additionalProperties: false
    }
  },
  {
    name: 'alibaba_1688_get_supply_detail',
    label: '读取货源详情',
    description: '【1688 货源详情】按货源 ID 读取阶梯价、起订量、成交记录摘要等公开信息。',
    parameters: {
      type: 'object',
      properties: { offerId: { type: 'string', description: '货源 ID' } },
      required: ['offerId'],
      additionalProperties: false
    }
  }
]

async function execute(name, args) {
  switch (name) {
    case 'alibaba_1688_search_products': {
      if (!args.keyword) throw new Error('keyword 不能为空')
      return { keyword: args.keyword, page: Number(args.page ?? 1) }
    }
    case 'alibaba_1688_get_supply_detail': {
      if (!args.offerId) throw new Error('offerId 不能为空')
      return { offerId: args.offerId }
    }
    default:
      throw new Error(`未知工具：${name}`)
  }
}

module.exports = { manifest, tools, execute }

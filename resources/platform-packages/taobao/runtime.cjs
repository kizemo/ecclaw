'use strict'

/**
 * 平台技能包运行时（ecclaw 协议 v1）。
 *
 * 约定：
 *   - 模块导出 `manifest` 与 `tools`，宿主（ecclaw 内核/外壳）按 tool contract 注册给模型；
 *   - 每个 tool 描述里显式声明参数边界，禁止把 Cookie / session / profile 等敏感字段暴露给模型；
 *   - 工具实现通过宿主注入的 `ctx`（浏览器会话、文件系统、登录态）访问外部世界。
 */

const manifest = require('./manifest.json')

/** @type {{ name: string, label: string, description: string, parameters: object }[]} */
const tools = [
  {
    name: 'taobao_search_products',
    label: '搜索淘宝商品',
    description:
      '【淘宝商品搜索】按关键词检索平台商品，返回公开商品摘要（标题、价格区间、销量区间、链接）。' +
      '不返回 Cookie、登录态或店铺内部字段。需要店铺内部数据时必须另行调用店铺上下文工具。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '搜索关键词' },
        page: { type: 'integer', description: '页码，从 1 开始', minimum: 1, default: 1 }
      },
      required: ['keyword'],
      additionalProperties: false
    }
  },
  {
    name: 'taobao_get_product_detail',
    label: '读取商品详情',
    description:
      '【淘宝商品详情】按商品 ID 或链接读取公开详情（标题、SKU 列表、价格、销量、属性）。' +
      '仅返回公开可见信息。',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: '商品 ID' },
        url: { type: 'string', description: '商品链接（与 productId 二选一）' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'taobao_list_shop_products',
    label: '列出店铺商品',
    description:
      '【店铺商品列表】列出当前登录店铺在架商品。必须先通过店铺上下文工具确认目标店铺；' +
      '不返回 Cookie、profile、partition 等会话标识。',
    parameters: {
      type: 'object',
      properties: {
        shopId: { type: 'string', description: '店铺标识（由店铺上下文工具返回）' },
        status: { type: 'string', enum: ['all', 'on_sale', 'off_sale'], default: 'all' }
      },
      required: ['shopId'],
      additionalProperties: false
    }
  }
]

/**
 * 工具执行入口（宿主调用）。
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @param {{ browser?: unknown, fetchImpl?: typeof fetch }} ctx
 */
async function execute(name, args, ctx) {
  const fetchImpl = ctx?.fetchImpl ?? globalThis.fetch
  switch (name) {
    case 'taobao_search_products': {
      const keyword = String(args.keyword ?? '')
      const page = Number(args.page ?? 1)
      if (!keyword) throw new Error('keyword 不能为空')
      return { keyword, page, note: '示例实现：请接入真实平台接口或浏览器会话' }
    }
    case 'taobao_get_product_detail': {
      if (!args.productId && !args.url) throw new Error('productId 与 url 至少提供一个')
      return { productId: args.productId ?? null, url: args.url ?? null }
    }
    case 'taobao_list_shop_products': {
      if (!args.shopId) throw new Error('shopId 不能为空')
      return { shopId: args.shopId, status: args.status ?? 'all' }
    }
    default:
      throw new Error(`未知工具：${name}`)
  }
}

module.exports = { manifest, tools, execute, fetchImpl: undefined }

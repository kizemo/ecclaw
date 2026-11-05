'use strict'

const manifest = require('./manifest.json')

const tools = [
  {
    name: 'douyin_list_videos',
    label: '列出抖音作品',
    description:
      '【抖音作品列表】按账号与时间范围列出已发布作品，返回标题、发布时间、播放/点赞等公开指标。' +
      '不返回登录态标识与设备指纹。',
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: '回溯天数', minimum: 1, default: 30 }
      },
      additionalProperties: false
    }
  },
  {
    name: 'douyin_get_video_stats',
    label: '作品数据',
    description: '【抖音作品数据】按作品 ID 读取完播率、互动率等指标。',
    parameters: {
      type: 'object',
      properties: { videoId: { type: 'string', description: '作品 ID' } },
      required: ['videoId'],
      additionalProperties: false
    }
  }
]

async function execute(name, args) {
  switch (name) {
    case 'douyin_list_videos':
      return { days: Number(args.days ?? 30) }
    case 'douyin_get_video_stats': {
      if (!args.videoId) throw new Error('videoId 不能为空')
      return { videoId: args.videoId }
    }
    default:
      throw new Error(`未知工具：${name}`)
  }
}

module.exports = { manifest, tools, execute }

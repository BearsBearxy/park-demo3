import { describe, it, expect } from 'vitest'
import { tenantMatchNames } from './tenantAlias'

describe('tenantMatchNames 正名+别名展开(V86)', () => {
  it('无别名=只有正名;空串/空格别名忽略', () => {
    expect(tenantMatchNames({ companyName: '鑫皇' })).toEqual(['鑫皇'])
    expect(tenantMatchNames({ companyName: '鑫皇', aliases: ' , ' })).toEqual(['鑫皇'])
  })
  it('中英文逗号混用,去空白去重;别名与正名重复不双计', () => {
    expect(tenantMatchNames({ companyName: '鑫皇', aliases: '李富全， 鑫皇 ,李富全' }))
      .toEqual(['鑫皇', '李富全'])
  })
  it('多别名保序展开', () => {
    expect(tenantMatchNames({ companyName: '甲公司', aliases: '张三,李四' }))
      .toEqual(['甲公司', '张三', '李四'])
  })
})

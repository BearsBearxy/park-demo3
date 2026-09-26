package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.AllocRuleLink;
public interface AllocRuleLinkMapper extends BaseMapper<AllocRuleLink> {
    // V131 按月版本:入向链按 dst 池分版本组,整组覆盖只作用于目标版本组(''=初始版)
    default void deleteByDstMonth(Integer dstRuleId, String acctMonth) {
        delete(new QueryWrapper<AllocRuleLink>().eq("dst_rule_id", dstRuleId).eq("acct_month", acctMonth));
    }
}

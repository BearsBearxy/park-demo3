package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.AllocRuleMeter;
import java.util.List;
public interface AllocRuleMeterMapper extends BaseMapper<AllocRuleMeter> {
    default List<AllocRuleMeter> selectByRule(Integer ruleId) {
        return selectList(new QueryWrapper<AllocRuleMeter>().eq("rule_id", ruleId).orderByAsc("id"));
    }
    // V131 按月版本:整组覆盖只作用于目标版本组(''=初始版),其他月的版本不动
    default void deleteByRuleMonth(Integer ruleId, String acctMonth) {
        delete(new QueryWrapper<AllocRuleMeter>().eq("rule_id", ruleId).eq("acct_month", acctMonth));
    }
}

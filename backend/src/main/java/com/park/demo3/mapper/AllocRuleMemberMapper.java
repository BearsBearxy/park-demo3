package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.AllocRuleMember;
import java.util.List;
public interface AllocRuleMemberMapper extends BaseMapper<AllocRuleMember> {
    default List<AllocRuleMember> selectByRule(Integer ruleId) {
        return selectList(new QueryWrapper<AllocRuleMember>().eq("rule_id", ruleId).orderByAsc("id"));
    }
    default void deleteByRule(Integer ruleId) {
        delete(new QueryWrapper<AllocRuleMember>().eq("rule_id", ruleId));
    }
    // V69 受益人按月留痕:整体覆盖只作用于目标月(''=默认长期行),不动其他月已出账口径
    default void deleteByRuleMonth(Integer ruleId, String acctMonth) {
        delete(new QueryWrapper<AllocRuleMember>().eq("rule_id", ruleId).eq("acct_month", acctMonth));
    }
}

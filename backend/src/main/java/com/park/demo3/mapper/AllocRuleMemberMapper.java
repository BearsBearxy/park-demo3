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
}

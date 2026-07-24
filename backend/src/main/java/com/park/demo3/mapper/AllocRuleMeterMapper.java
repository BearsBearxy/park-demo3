package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.AllocRuleMeter;
import java.util.List;
public interface AllocRuleMeterMapper extends BaseMapper<AllocRuleMeter> {
    default List<AllocRuleMeter> selectByRule(Integer ruleId) {
        return selectList(new QueryWrapper<AllocRuleMeter>().eq("rule_id", ruleId).orderByAsc("id"));
    }
    default void deleteByRule(Integer ruleId) {
        delete(new QueryWrapper<AllocRuleMeter>().eq("rule_id", ruleId));
    }
}

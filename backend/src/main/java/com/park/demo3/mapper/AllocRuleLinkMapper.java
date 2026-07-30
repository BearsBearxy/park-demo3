package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.AllocRuleLink;
public interface AllocRuleLinkMapper extends BaseMapper<AllocRuleLink> {
    default void deleteByDst(Integer dstRuleId) {
        delete(new QueryWrapper<AllocRuleLink>().eq("dst_rule_id", dstRuleId));
    }
}

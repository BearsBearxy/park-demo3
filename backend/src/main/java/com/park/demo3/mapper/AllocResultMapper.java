package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.AllocResult;
import java.math.BigDecimal;
import java.util.List;
public interface AllocResultMapper extends BaseMapper<AllocResult> {
    default List<AllocResult> selectByYm(String ym) {
        return selectList(new QueryWrapper<AllocResult>().eq("ym", ym).orderByAsc("tenant_id", "fee_key"));
    }
    default long countByRule(Integer ruleId) {
        return selectCount(new QueryWrapper<AllocResult>().eq("rule_id", ruleId));
    }
    default void deleteGenByYm(String ym) {
        delete(new QueryWrapper<AllocResult>().eq("ym", ym).eq("source", "gen"));
    }
    default List<Integer> selectDistinctYears() {
        return selectObjs(new QueryWrapper<AllocResult>().select("distinct left(ym,4)"))
            .stream().map(o -> Integer.parseInt(String.valueOf(o))).sorted().toList();
    }
    // 当月分摊金额Σ(elec-cost 桥:模拟规则6「分摊额度」读真值;无数据月=0 → 回退假设)
    default BigDecimal sumAmountByYm(String ym) {
        Object v = selectObjs(new QueryWrapper<AllocResult>().select("coalesce(sum(amount),0)").eq("ym", ym))
            .stream().filter(java.util.Objects::nonNull).findFirst().orElse(BigDecimal.ZERO);
        return v instanceof BigDecimal b ? b : new BigDecimal(String.valueOf(v));
    }
}

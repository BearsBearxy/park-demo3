package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.AllocResult;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import java.math.BigDecimal;
import java.util.List;
public interface AllocResultMapper extends BaseMapper<AllocResult> {
    default List<AllocResult> selectByYm(String ym) {
        return selectList(new QueryWrapper<AllocResult>().eq("ym", ym).orderByAsc("tenant_id", "fee_key"));
    }
    // 批量插入(P3-4:generate 原来一户一费一发 insert)。rule_id/qty/rate_snap/price_snap/note 五列在实体上带
    // updateStrategy=ALWAYS(那是给 updateById 绕开「null 不更新」用的,与 insert 无关);此处显式写 NULL 即可,
    // 这五列在 DDL 里均可空且无 DEFAULT。amount/source/generated_at 由调用方逐行赋值,不吃 DDL 的 DEFAULT。
    @Insert("<script>INSERT INTO alloc_result (tenant_id, ym, fee_key, rule_id, qty, amount, rate_snap,"
        + " price_snap, source, note, generated_at) VALUES"
        + "<foreach collection='list' item='r' separator=','>"
        + " (#{r.tenantId}, #{r.ym}, #{r.feeKey}, #{r.ruleId}, #{r.qty}, #{r.amount}, #{r.rateSnap},"
        + " #{r.priceSnap}, #{r.source}, #{r.note}, #{r.generatedAt})"
        + "</foreach></script>")
    int insertBatch(@Param("list") List<AllocResult> list);
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

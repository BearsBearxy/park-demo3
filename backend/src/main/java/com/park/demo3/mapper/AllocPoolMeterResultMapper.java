package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.AllocPoolMeterResult;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import java.util.List;
public interface AllocPoolMeterResultMapper extends BaseMapper<AllocPoolMeterResult> {
    default List<AllocPoolMeterResult> selectByYm(String ym) {
        return selectList(new QueryWrapper<AllocPoolMeterResult>().eq("ym", ym).orderByAsc("rule_id", "seq"));
    }
    // 批量插入(P3-4)。sign/seq 由 poolMeterLines 逐行显式赋值,不靠 DDL 的 DEFAULT 1/0;其余可空列无 DEFAULT,
    // 显式写 NULL 与 MP 单发 insert 等价。
    @Insert("<script>INSERT INTO alloc_pool_meter_result (ym, rule_id, meter_id, sign, seq, factor_snap,"
        + " prev_total, curr_total, qty_total, qty_sharp, qty_peak, qty_flat, qty_valley, cost_amount,"
        + " generated_at) VALUES"
        + "<foreach collection='list' item='r' separator=','>"
        + " (#{r.ym}, #{r.ruleId}, #{r.meterId}, #{r.sign}, #{r.seq}, #{r.factorSnap},"
        + " #{r.prevTotal}, #{r.currTotal}, #{r.qtyTotal}, #{r.qtySharp}, #{r.qtyPeak}, #{r.qtyFlat},"
        + " #{r.qtyValley}, #{r.costAmount}, #{r.generatedAt})"
        + "</foreach></script>")
    int insertBatch(@Param("list") List<AllocPoolMeterResult> list);
    default void deleteByYm(String ym) {
        delete(new QueryWrapper<AllocPoolMeterResult>().eq("ym", ym));
    }
}

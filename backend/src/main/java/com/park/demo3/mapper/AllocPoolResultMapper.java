package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.AllocPoolResult;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import java.util.List;
public interface AllocPoolResultMapper extends BaseMapper<AllocPoolResult> {
    default List<AllocPoolResult> selectByYm(String ym) {
        return selectList(new QueryWrapper<AllocPoolResult>().eq("ym", ym));
    }
    // 批量插入(P3-4:generate 原来一池一发 insert)。分批由调用方切,空表不许进来——<foreach> 拼不出合法 VALUES。
    // 列清单与实体逐字对齐;可空列显式写 NULL 与 MP 单发 insert(省略列)等价:本表无一列带 DEFAULT。
    @Insert("<script>INSERT INTO alloc_pool_result (ym, rule_id, qty_total, qty_sharp, qty_peak, qty_flat,"
        + " qty_valley, extra_qty_snap, cost_amount, base_snap, std_value, fold_add, price_snap,"
        + " allocated_amount, gap_amount, warn, generated_at) VALUES"
        + "<foreach collection='list' item='r' separator=','>"
        + " (#{r.ym}, #{r.ruleId}, #{r.qtyTotal}, #{r.qtySharp}, #{r.qtyPeak}, #{r.qtyFlat},"
        + " #{r.qtyValley}, #{r.extraQtySnap}, #{r.costAmount}, #{r.baseSnap}, #{r.stdValue}, #{r.foldAdd},"
        + " #{r.priceSnap}, #{r.allocatedAmount}, #{r.gapAmount}, #{r.warn}, #{r.generatedAt})"
        + "</foreach></script>")
    int insertBatch(@Param("list") List<AllocPoolResult> list);
    default void deleteByYm(String ym) {
        delete(new QueryWrapper<AllocPoolResult>().eq("ym", ym));
    }
    // 有池快照的 distinct 账期升序('YYYY-MM')。⚠ 不能借 /alloc/years(那是 meter_reading∪alloc_result 的年),
    // 也不能拿 /pools 的 rows 判有无 —— rows 是 alloc_rule 全库左连,任何月都非空(见 AllocService.pools 头注)。
    // ym 是零补 CHAR(7) 且是 uk_pool_result 最左列,Java 排序与 SQL ORDER BY 等价。
    default List<String> selectDistinctYms() {
        return selectObjs(new QueryWrapper<AllocPoolResult>().select("distinct ym"))
            .stream().map(String::valueOf).sorted().toList();
    }
}

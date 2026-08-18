package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.AllocLossResult;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import java.util.List;
public interface AllocLossResultMapper extends BaseMapper<AllocLossResult> {
    default List<AllocLossResult> selectByYm(String ym) {
        return selectList(new QueryWrapper<AllocLossResult>().eq("ym", ym).orderByAsc("zone", "head_building_id"));
    }
    // 批量插入(P3-4)。c_qty/d_qty/e_qty/g_qty 的属性名是实体字段名(cQty…),MP 的 camelToUnderline 同源;
    // 可空列无 DEFAULT,显式写 NULL 与 MP 单发 insert 等价。
    @Insert("<script>INSERT INTO alloc_loss_result (ym, zone, head_building_id, c_qty, cable_qty, d_qty,"
        + " e_qty, raw_rate, g_qty, adj_qty, adj_rate, variant, tenant_rate,"
        + " formula_rate, manual_rate, denom_qty, generated_at) VALUES"
        + "<foreach collection='list' item='r' separator=','>"
        + " (#{r.ym}, #{r.zone}, #{r.headBuildingId}, #{r.cQty}, #{r.cableQty}, #{r.dQty},"
        + " #{r.eQty}, #{r.rawRate}, #{r.gQty}, #{r.adjQty}, #{r.adjRate}, #{r.variant}, #{r.tenantRate},"
        + " #{r.formulaRate}, #{r.manualRate}, #{r.denomQty}, #{r.generatedAt})"
        + "</foreach></script>")
    int insertBatch(@Param("list") List<AllocLossResult> list);
    default void deleteByYm(String ym) {
        delete(new QueryWrapper<AllocLossResult>().eq("ym", ym));
    }
    // 有损耗快照的 distinct 账期升序('YYYY-MM')。同 AllocPoolResultMapper:/alloc/years 不是本表的年,
    // 前端拿它顶掉逐月试探。零补 CHAR(7),Java 排序与 SQL ORDER BY 等价。
    default List<String> selectDistinctYms() {
        return selectObjs(new QueryWrapper<AllocLossResult>().select("distinct ym"))
            .stream().map(String::valueOf).sorted().toList();
    }
}

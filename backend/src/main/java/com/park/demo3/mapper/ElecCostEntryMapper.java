package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.entity.ElecCostEntry;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import java.util.List;
public interface ElecCostEntryMapper extends BaseMapper<ElecCostEntry> {
    // 某记账月全部行,meter/费项/拆分确定排序
    default List<ElecCostEntry> selectByMonth(String acctMonth) {
        return selectList(new QueryWrapper<ElecCostEntry>()
            .eq("acct_month", acctMonth)
            .orderByAsc("meter_id", "fee_key", "sub_key", "id"));
    }
    // uk 四元组单行(无则 null,upsert 用);subKey 调用方已空串归一化
    default ElecCostEntry selectByKey(Integer meterId, String acctMonth, String feeKey, String subKey) {
        return selectOne(new QueryWrapper<ElecCostEntry>()
            .eq("meter_id", meterId).eq("acct_month", acctMonth)
            .eq("fee_key", feeKey).eq("sub_key", subKey));
    }
    // 该表费项行数(删表 409 守卫用)
    default long countByMeter(Integer meterId) {
        return selectCount(new QueryWrapper<ElecCostEntry>().eq("meter_id", meterId));
    }
    // 某年全部行(acct_month 前缀 year-;metrics-year 整年一次取数用,ENERGY-ANALYSIS §4)
    default List<ElecCostEntry> selectByYear(int year) {
        return selectList(new QueryWrapper<ElecCostEntry>().likeRight("acct_month", year + "-"));
    }
    // 有数据的 distinct 年份升序(年份下拉数据驱动,同 pv-meter 模式)
    default List<Integer> selectDistinctYears() {
        return selectObjs(new QueryWrapper<ElecCostEntry>().select("distinct substring(acct_month,1,4)"))
            .stream().map(o -> Integer.parseInt(String.valueOf(o))).sorted().toList();
    }
    // 有数据的 distinct 账期升序('YYYY-MM',列名是 acct_month 不是 ym)。用途同 MeterReadingMapper:
    // 顶掉前端逐月试探「最新有数月」。零补串,Java 排序与 SQL ORDER BY 等价。
    default List<String> selectDistinctYms() {
        return selectObjs(new QueryWrapper<ElecCostEntry>().select("distinct acct_month"))
            .stream().map(String::valueOf).sorted().toList();
    }
}

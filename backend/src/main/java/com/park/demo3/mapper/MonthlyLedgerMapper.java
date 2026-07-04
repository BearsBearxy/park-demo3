package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.entity.MonthlyLedger;
import java.util.List;
public interface MonthlyLedgerMapper extends BaseMapper<MonthlyLedger> {
    default List<MonthlyLedger> selectMonth(Integer companyId, Integer year, Integer month) {
        return selectList(new QueryWrapper<MonthlyLedger>()
            .eq("company_id", companyId).eq("period_year", year).eq("period_month", month));
    }
    default List<MonthlyLedger> selectYear(Integer companyId, Integer year) {
        return selectList(new QueryWrapper<MonthlyLedger>()
            .eq("company_id", companyId).eq("period_year", year));
    }
    // 有数据的年份 + 各年月份数(年份门)
    default List<java.util.Map<String, Object>> yearsWithMonths(Integer companyId) {
        return selectMaps(new QueryWrapper<MonthlyLedger>()
            .select("period_year as `year`", "count(distinct period_month) as months")
            .eq("company_id", companyId).groupBy("period_year").orderByAsc("period_year"));
    }
}

package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.entity.ReportAccount;
import java.util.List;
public interface ReportAccountMapper extends BaseMapper<ReportAccount> {
    // 单公司本期科目树(文件行序)
    default List<ReportAccount> period(int companyId, String statement, int year, int month) {
        return selectList(new QueryWrapper<ReportAccount>()
            .eq("company_id", companyId).eq("statement", statement)
            .eq("year", year).eq("month", month)
            .orderByAsc("sort_order"));
    }
    // 全公司本期科目(全部汇总一级合并用;company_id 序保证首见稳定)
    default List<ReportAccount> allPeriod(String statement, int year, int month) {
        return selectList(new QueryWrapper<ReportAccount>()
            .eq("statement", statement).eq("year", year).eq("month", month)
            .orderByAsc("company_id", "sort_order"));
    }
    // 有数据的年份 + 各年月份数(年份门;tb 的 hasData 以科目树为准,同 ReportService.year 口径)
    default List<java.util.Map<String, Object>> yearsWithMonths(int companyId, String statement) {
        return selectMaps(new QueryWrapper<ReportAccount>()
            .select("`year`", "count(distinct `month`) as months")
            .eq("company_id", companyId).eq("statement", statement)
            .groupBy("`year`").orderByAsc("`year`"));
    }
}

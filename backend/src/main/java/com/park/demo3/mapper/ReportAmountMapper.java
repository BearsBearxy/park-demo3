package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.entity.ReportAmount;
import java.util.List;
public interface ReportAmountMapper extends BaseMapper<ReportAmount> {
    // 单公司本期全部金额行
    default List<ReportAmount> period(int companyId, String statement, int year, int month) {
        return selectList(new QueryWrapper<ReportAmount>()
            .eq("company_id", companyId).eq("statement", statement)
            .eq("year", year).eq("month", month));
    }
    // 全公司本期金额行(全部汇总用,不加 companyId 过滤)
    default List<ReportAmount> allPeriod(String statement, int year, int month) {
        return selectList(new QueryWrapper<ReportAmount>()
            .eq("statement", statement).eq("year", year).eq("month", month));
    }
}

package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.entity.ReportCustomRow;
import java.util.List;
public interface ReportCustomRowMapper extends BaseMapper<ReportCustomRow> {
    default List<ReportCustomRow> forCompany(int companyId, String statement) {
        return selectList(new QueryWrapper<ReportCustomRow>()
            .eq("company_id", companyId).eq("statement", statement)
            .orderByAsc("id"));
    }
}

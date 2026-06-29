package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.entity.SalaryRecord;
import java.util.List;
public interface SalaryRecordMapper extends BaseMapper<SalaryRecord> {
    // 某月记录:种子按 emp_idx 升序,手动行(emp_idx=0)排到名单末尾(对齐原型 idx||999),再按 name
    default List<SalaryRecord> selectByMonth(String acctMonth) {
        return selectList(new QueryWrapper<SalaryRecord>()
            .eq("acct_month", acctMonth)
            .last("ORDER BY (emp_idx = 0), emp_idx, name"));
    }
}

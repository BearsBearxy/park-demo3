package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.BudgetRow;
import java.util.List;
public interface BudgetRowMapper extends BaseMapper<BudgetRow> {
    // 全部行,按 year、sort_order 升序(表小,一次拉全)
    default List<BudgetRow> all() {
        return selectList(new QueryWrapper<BudgetRow>().orderByAsc("year", "sort_order"));
    }
}

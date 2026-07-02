package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.PnlRow;
import java.util.List;
import java.util.Map;
public interface PnlRowMapper extends BaseMapper<PnlRow> {
    // 某附表某年全部行,按 sort_order 升序
    default List<PnlRow> year(String schedule, int year) {
        return selectList(new QueryWrapper<PnlRow>()
            .eq("schedule", schedule).eq("year", year).orderByAsc("sort_order"));
    }
    // 某附表有数据的年份 + 各年行数(供 overview)
    default List<Map<String, Object>> years(String schedule) {
        return selectMaps(new QueryWrapper<PnlRow>()
            .select("year", "count(*) as cnt")
            .eq("schedule", schedule).groupBy("year"));
    }
}

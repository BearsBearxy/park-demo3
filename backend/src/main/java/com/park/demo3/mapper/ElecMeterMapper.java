package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.ElecMeter;
import java.util.List;
public interface ElecMeterMapper extends BaseMapper<ElecMeter> {
    // 全部电表按 sort_no 升序(同序号按 id)
    default List<ElecMeter> selectAllSorted() {
        return selectList(new QueryWrapper<ElecMeter>().orderByAsc("sort_no", "id"));
    }
    // 现有最大 sort_no(新表追加末尾用)
    default int maxSortNo() {
        ElecMeter top = selectOne(new QueryWrapper<ElecMeter>().orderByDesc("sort_no").last("limit 1"));
        return top == null || top.getSortNo() == null ? 0 : top.getSortNo();
    }
}

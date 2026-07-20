package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.PvStation;
import java.util.List;
public interface PvStationMapper extends BaseMapper<PvStation> {
    // 全部电站按 sort_no 升序(同序号按 id)
    default List<PvStation> selectAllSorted() {
        return selectList(new QueryWrapper<PvStation>().orderByAsc("sort_no", "id"));
    }
    // 现有最大 sort_no(新站追加末尾用)
    default int maxSortNo() {
        PvStation top = selectOne(new QueryWrapper<PvStation>().orderByDesc("sort_no").last("limit 1"));
        return top == null || top.getSortNo() == null ? 0 : top.getSortNo();
    }
}

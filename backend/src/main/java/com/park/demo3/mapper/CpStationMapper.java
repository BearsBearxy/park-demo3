package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.CpStation;
import java.util.List;
public interface CpStationMapper extends BaseMapper<CpStation> {
    // 全部桩按 sort_no 升序(同序号按 id)
    default List<CpStation> selectAllSorted() {
        return selectList(new QueryWrapper<CpStation>().orderByAsc("sort_no", "id"));
    }
    // 某车型的桩 id(附表7/8 各看各的:cp_reading 没有车型列,只能先由桩表取 id 再过滤记录)
    default List<Integer> selectIdsByType(String vehicleType) {
        return selectList(new QueryWrapper<CpStation>().select("id").eq("vehicle_type", vehicleType))
            .stream().map(CpStation::getId).toList();
    }
    // 现有最大 sort_no(新桩追加末尾用)
    default int maxSortNo() {
        CpStation top = selectOne(new QueryWrapper<CpStation>().orderByDesc("sort_no").last("limit 1"));
        return top == null || top.getSortNo() == null ? 0 : top.getSortNo();
    }
}

package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.entity.Unit;
import java.util.List;
public interface UnitMapper extends BaseMapper<Unit> {
    default List<Unit> selectByBuildingId(Integer buildingId) {
        // 楼层→单元号排序:无序时新增单元(id最大)会漂到下拉最末尾,用户在所属楼层段位找不到
        return selectList(new QueryWrapper<Unit>().eq("building_id", buildingId)
            .orderByAsc("floor", "unit_no"));
    }
}

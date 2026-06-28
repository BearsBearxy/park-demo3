package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.entity.Unit;
import java.util.List;
public interface UnitMapper extends BaseMapper<Unit> {
    default List<Unit> selectByBuildingId(Integer buildingId) {
        return selectList(new QueryWrapper<Unit>().eq("building_id", buildingId));
    }
}

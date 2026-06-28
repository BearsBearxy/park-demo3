package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.entity.Contract;
import java.util.List;
public interface ContractMapper extends BaseMapper<Contract> {
    default List<Contract> selectByBuildingId(Integer buildingId) {
        return selectList(new QueryWrapper<Contract>().eq("building_id", buildingId));
    }
}

package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.AllocLossResult;
import java.util.List;
public interface AllocLossResultMapper extends BaseMapper<AllocLossResult> {
    default List<AllocLossResult> selectByYm(String ym) {
        return selectList(new QueryWrapper<AllocLossResult>().eq("ym", ym).orderByAsc("zone", "head_building_id"));
    }
    default void deleteByYm(String ym) {
        delete(new QueryWrapper<AllocLossResult>().eq("ym", ym));
    }
}

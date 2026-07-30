package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.AllocPoolResult;
import java.util.List;
public interface AllocPoolResultMapper extends BaseMapper<AllocPoolResult> {
    default List<AllocPoolResult> selectByYm(String ym) {
        return selectList(new QueryWrapper<AllocPoolResult>().eq("ym", ym));
    }
    default void deleteByYm(String ym) {
        delete(new QueryWrapper<AllocPoolResult>().eq("ym", ym));
    }
}

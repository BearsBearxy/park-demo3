package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.AllocPoolMeterResult;
import java.util.List;
public interface AllocPoolMeterResultMapper extends BaseMapper<AllocPoolMeterResult> {
    default List<AllocPoolMeterResult> selectByYm(String ym) {
        return selectList(new QueryWrapper<AllocPoolMeterResult>().eq("ym", ym).orderByAsc("rule_id", "seq"));
    }
    default void deleteByYm(String ym) {
        delete(new QueryWrapper<AllocPoolMeterResult>().eq("ym", ym));
    }
}

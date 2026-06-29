package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.entity.PvPhase;
import java.util.List;
public interface PvPhaseMapper extends BaseMapper<PvPhase> {
    default List<PvPhase> selectAllSorted() {
        return selectList(new QueryWrapper<PvPhase>().orderByAsc("sort_no").orderByAsc("id"));
    }
}

package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.entity.ElecPhase;
import java.util.List;
public interface ElecPhaseMapper extends BaseMapper<ElecPhase> {
    default List<ElecPhase> selectAllSorted() {
        return selectList(new QueryWrapper<ElecPhase>().orderByAsc("sort_no").orderByAsc("id"));
    }
}

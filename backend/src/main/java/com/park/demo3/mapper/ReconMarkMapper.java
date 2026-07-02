package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.entity.ReconMark;
import java.util.List;
public interface ReconMarkMapper extends BaseMapper<ReconMark> {
    // 某 (年,月) 全部处置标记
    default List<ReconMark> month(int year, int month) {
        return selectList(new QueryWrapper<ReconMark>().eq("year", year).eq("month", month));
    }
}

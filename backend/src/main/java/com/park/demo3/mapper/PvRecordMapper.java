package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.entity.PvRecord;
import java.util.List;
public interface PvRecordMapper extends BaseMapper<PvRecord> {
    // 该年(acct_month 前4位==year)全部记录,按 acct_month 升序
    default List<PvRecord> selectByYear(int year) {
        return selectList(new QueryWrapper<PvRecord>()
            .likeRight("acct_month", year + "-").orderByAsc("acct_month"));
    }
}

package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.park.demo3.entity.ElecRecord;
import java.util.List;
public interface ElecRecordMapper extends BaseMapper<ElecRecord> {
    // 该年(acct_month 前4位==year)指定 type 全部记录,按 acct_month 升序,
    // 月内按 id(=种子插入顺序:phase p1→p3、period 峰→平→谷)确定排序
    default List<ElecRecord> selectByYearAndType(int year, String type) {
        return selectList(new QueryWrapper<ElecRecord>()
            .likeRight("acct_month", year + "-").eq("type", type)
            .orderByAsc("acct_month").orderByAsc("id"));
    }
}

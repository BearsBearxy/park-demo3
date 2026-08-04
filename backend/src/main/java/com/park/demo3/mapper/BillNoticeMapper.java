package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.BillNotice;
import java.util.List;
public interface BillNoticeMapper extends BaseMapper<BillNotice> {
    default List<BillNotice> selectByYm(String ym) {
        return selectList(new QueryWrapper<BillNotice>().eq("ym", ym)
            .orderByAsc("tenant_id", "notice_kind", "id"));
    }
}

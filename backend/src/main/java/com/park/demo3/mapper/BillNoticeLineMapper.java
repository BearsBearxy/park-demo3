package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.BillNoticeLine;
import java.util.List;
public interface BillNoticeLineMapper extends BaseMapper<BillNoticeLine> {
    default List<BillNoticeLine> selectByNotice(Integer noticeId) {
        return selectList(new QueryWrapper<BillNoticeLine>().eq("notice_id", noticeId).orderByAsc("line_no"));
    }
    // ym 已由服务层正则校验(\d{4}-\d{2}),inSql 无注入面
    default List<BillNoticeLine> selectByYm(String ym) {
        return selectList(new QueryWrapper<BillNoticeLine>()
            .inSql("notice_id", "SELECT id FROM bill_notice WHERE ym = '" + ym + "'"));
    }
}

package com.park.demo3.mapper;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.BillNoticeWarn;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;

import java.util.List;

public interface BillNoticeWarnMapper extends BaseMapper<BillNoticeWarn> {

    // 多值 INSERT,手法同 BillNoticeLineMapper.insertBatch。
    // ⚠ 列清单与 V126__bill_notice_warn.sql 逐列对齐(4 列,除自增 id);本实体无 @TableField(fill=...)。
    // ⚠ payload/hint 是 NOT NULL DEFAULT '',调用方必须传非 null(传 null 会落 NULL 撞非空约束)。
    // ⚠ 调用方须自行分批;空 list 不可调(foreach 会吐空 VALUES)。
    @Insert("<script>INSERT INTO bill_notice_warn(notice_id, code, payload, hint) VALUES "
          + "<foreach collection='list' item='r' separator=','>"
          + "(#{r.noticeId}, #{r.code}, #{r.payload}, #{r.hint})"
          + "</foreach></script>")
    int insertBatch(@Param("list") List<BillNoticeWarn> list);

    default List<BillNoticeWarn> selectByNotice(Integer noticeId) {
        return selectList(new QueryWrapper<BillNoticeWarn>().eq("notice_id", noticeId).orderByAsc("id"));
    }

    // ym 已由服务层正则校验(\d{4}-\d{2}),inSql 无注入面。口径同 BillNoticeLineMapper.selectByYm。
    default List<BillNoticeWarn> selectByYm(String ym) {
        return selectList(new QueryWrapper<BillNoticeWarn>()
            .inSql("notice_id", "SELECT id FROM bill_notice WHERE ym = '" + ym + "'")
            .orderByAsc("notice_id", "id"));
    }
}

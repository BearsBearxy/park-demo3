package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.BillNotice;
import com.park.demo3.entity.MeterAssign;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import java.util.List;
public interface MeterAssignMapper extends BaseMapper<MeterAssign> {

    /**
     * 库里最大 / 最早「已生成月」= 读数月、催缴单月、池快照月三者的极值(METER-TIMELINE-SPEC §4 链尾区间)。
     * 全库无数据时回空串,调用方当 null。
     */
    @Select("SELECT GREATEST(COALESCE((SELECT MAX(ym) FROM meter_reading), ''),"
          + " COALESCE((SELECT MAX(ym) FROM bill_notice), ''),"
          + " COALESCE((SELECT MAX(ym) FROM alloc_pool_result), ''))")
    String maxGeneratedYm();

    @Select("SELECT LEAST(COALESCE((SELECT MIN(ym) FROM meter_reading), '9999-12'),"
          + " COALESCE((SELECT MIN(ym) FROM bill_notice), '9999-12'),"
          + " COALESCE((SELECT MIN(ym) FROM alloc_pool_result), '9999-12'))")
    String minGeneratedYm();

    /** 明细含这块表的「已确认 / 已导出(含历史 issued)」催缴单:只回 ym 与 status 两列(SPEC §4 冻结来源 2)。 */
    @Select("SELECT DISTINCT n.ym, n.status FROM bill_notice n JOIN bill_notice_line l ON l.notice_id = n.id"
          + " WHERE l.meter_id = #{meterId} AND n.status IN ('confirmed', 'exported', 'issued')")
    List<BillNotice> lockedNotices(@Param("meterId") int meterId);
}

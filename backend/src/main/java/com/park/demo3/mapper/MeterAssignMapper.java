package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.BillNotice;
import com.park.demo3.entity.MeterAssign;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Options;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import java.util.List;
public interface MeterAssignMapper extends BaseMapper<MeterAssign> {

    /**
     * 库里最大 / 最早「已生成月」= 读数月、催缴单月、池快照月三者的极值(METER-TIMELINE-SPEC §4 链尾区间)。
     * 一律按**表档案月**算:催缴单 ym 是收费月,单上的表是上一个月的(BillNoticeService 类头「月份口径」),
     * 所以催缴单那一项取单头月减一。全库无数据时回空串,调用方当 null。
     */
    @Select("SELECT GREATEST(COALESCE((SELECT MAX(ym) FROM meter_reading), ''),"
          + " COALESCE((SELECT DATE_FORMAT(DATE_SUB(STR_TO_DATE(CONCAT(MAX(ym), '-01'), '%Y-%m-%d'), INTERVAL 1 MONTH), '%Y-%m') FROM bill_notice), ''),"
          + " COALESCE((SELECT MAX(ym) FROM alloc_pool_result), ''))")
    String maxGeneratedYm();

    @Select("SELECT LEAST(COALESCE((SELECT MIN(ym) FROM meter_reading), '9999-12'),"
          + " COALESCE((SELECT DATE_FORMAT(DATE_SUB(STR_TO_DATE(CONCAT(MIN(ym), '-01'), '%Y-%m-%d'), INTERVAL 1 MONTH), '%Y-%m') FROM bill_notice), '9999-12'),"
          + " COALESCE((SELECT MIN(ym) FROM alloc_pool_result), '9999-12'))")
    String minGeneratedYm();

    /**
     * 明细含这块表的「已确认 / 已导出(含历史 issued)」催缴单:只回 ym 与 status 两列(SPEC §4 冻结来源 2)。
     * ym 回的是**这张单冻住的表档案月** = 单头月减一(单上是上月的表),不是单头月。
     */
    @Select("SELECT DISTINCT DATE_FORMAT(DATE_SUB(STR_TO_DATE(CONCAT(n.ym, '-01'), '%Y-%m-%d'), INTERVAL 1 MONTH), '%Y-%m') AS ym, n.status"
          + " FROM bill_notice n JOIN bill_notice_line l ON l.notice_id = n.id"
          + " WHERE l.meter_id = #{meterId} AND n.status IN ('confirmed', 'exported', 'issued')")
    List<BillNotice> lockedNotices(@Param("meterId") int meterId);

    /**
     * 整册导入攒批写(MeterTimelineService.Batch):多行一条,按 rows 顺序回填自增 id;rows 调用方保证非空。
     * 列与实体逐个对应、空值落 NULL —— 可空列的列默认本就是 NULL,有默认值的四列 Batch 已补,与 insert(row) 落下的一样。
     */
    @Insert("<script>INSERT INTO meter_assign (meter_id, from_ym, tenant_id, tenant_name, building_id, ownership, area, spot,"
          + " floor_label, side, room_no, sub_name, contract_id, tenant_manual, owner_manual, loc_manual, src, batch_id) VALUES"
          + "<foreach collection='rows' item='r' separator=','>(#{r.meterId}, #{r.fromYm}, #{r.tenantId}, #{r.tenantName},"
          + " #{r.buildingId}, #{r.ownership}, #{r.area}, #{r.spot}, #{r.floorLabel}, #{r.side}, #{r.roomNo}, #{r.subName},"
          + " #{r.contractId}, #{r.tenantManual}, #{r.ownerManual}, #{r.locManual}, #{r.src}, #{r.batchId})</foreach></script>")
    @Options(useGeneratedKeys = true, keyProperty = "rows.id", keyColumn = "id")
    int insertAll(@Param("rows") List<MeterAssign> rows);
}

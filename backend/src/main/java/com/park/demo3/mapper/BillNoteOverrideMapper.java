package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.BillNoteOverride;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;

public interface BillNoteOverrideMapper extends BaseMapper<BillNoteOverride> {
    // upsert:业务键(uk_note_override)命中即改 note(MySQL 原生,免查改两跳;同 BillPayCompanyMapper 手法)
    @Insert("INSERT INTO bill_note_override (ym, tenant_id, fee_key, premise_key, meter_key, seg_key, note) "
          + "VALUES (#{ym}, #{tenantId}, #{feeKey}, #{premiseKey}, #{meterKey}, #{segKey}, #{note}) "
          + "ON DUPLICATE KEY UPDATE note = #{note}")
    int upsertNote(@Param("ym") String ym, @Param("tenantId") Integer tenantId,
                   @Param("feeKey") String feeKey, @Param("premiseKey") String premiseKey,
                   @Param("meterKey") String meterKey, @Param("segKey") String segKey,
                   @Param("note") String note);
}

package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;

/**
 * 催缴单备注人工覆盖(V92):独立于 bill_notice_line,重生成(先删后插)不丢。
 * 键=(ym,tenant_id,fee_key,premise_key,meter_key,seg_key),键列空串不用 NULL(unique 对 NULL 不去重);
 * 普通行 meter_key=meter_id 字符串,合并行='merged'。updated_at 由 DB 维护,实体不映射(同 BillPayCompany)。
 */
@Data @TableName("bill_note_override")
public class BillNoteOverride {
    @TableId(type = IdType.AUTO) private Integer id;
    private String ym;
    private Integer tenantId;
    private String feeKey;
    private String premiseKey;
    private String meterKey;
    private String segKey;
    private String note;
}

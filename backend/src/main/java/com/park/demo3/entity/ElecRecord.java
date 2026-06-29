package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
@Data @TableName("elec_record")
public class ElecRecord {
    @TableId(type = IdType.AUTO) private Integer id;
    private String type;        // energy / basic
    private String phaseId;
    private String acctMonth;   // YYYY-MM 记账月
    private String invDate;     // YYYY-MM-DD 开票日期
    private String period;      // 峰/平/谷(仅 energy)
    private String cat;         // 用电类别(仅 energy)
    private String unit;        // 单位(仅 energy)
    private BigDecimal qty;     // 电量 kWh(仅 energy)
    private BigDecimal demand;  // 计费需量 kVA(仅 basic)
    private BigDecimal price;   // 不含税单价
    private BigDecimal rate;    // 税率
    private String note;
    private String source;      // seed / manual
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}

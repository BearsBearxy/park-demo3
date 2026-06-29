package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDateTime;
@Data @TableName("s10_record")
public class S10Record {
    @TableId(type = IdType.AUTO) private Long id;
    private Integer tenantId;       // 软引用真实租户(可空,无 FK)
    private String tenantName;      // 显示/配平兜底
    private Integer phase;          // 1 一期 / 2 二期 / 3 三期 / 4 宿舍
    private String acctMonth;       // YYYY-MM 记账月
    private String profile;         // office/factory/shop/dorm/land/guarantee(列门控,仅 UI 提示)
    private String note;
    private String source;          // seed / manual / import
    // ── 25 费用列(camelCase ↔ snake_case 由 map-underscore-to-camel-case 映射) ──
    private BigDecimal officeRent;
    private BigDecimal officeMgmtFee;
    private BigDecimal factoryRent;
    private BigDecimal factoryMgmtFee;
    private BigDecimal landRent;
    private BigDecimal shopRent;
    private BigDecimal shopMgmtFee;
    private BigDecimal dormRent;
    private BigDecimal dormFacilityFee;
    private BigDecimal infraOffice;
    private BigDecimal infraFactory;
    private BigDecimal infraShop;
    private BigDecimal infraDorm;
    private BigDecimal elevatorMaint;
    private BigDecimal transformerMaint;
    private BigDecimal landUseTax;
    private BigDecimal networkFee;
    private BigDecimal accessMaint;
    private BigDecimal otherFee;
    private BigDecimal elecBasic;
    private BigDecimal elecStd;
    private BigDecimal elecMaint;
    private BigDecimal waterStd;
    private BigDecimal waterMaint;
    private BigDecimal guaranteeRent;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}

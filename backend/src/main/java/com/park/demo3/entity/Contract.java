package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDate; import java.time.LocalDateTime;
@Data @TableName("contract")
public class Contract {
    @TableId(type = IdType.AUTO) private Integer id;
    private String contractNo; private Integer tenantId; private Integer buildingId; private Integer unitId;
    private BigDecimal rentArea; private BigDecimal monthlyRent; private BigDecimal deposit;
    // V33 面积模型:建筑面积㎡ / 租金单价 元每㎡月,均可空(存量留空);rent_free=免租期 JSON 数组,写入口校验
    private BigDecimal buildingArea; private BigDecimal unitPrice; private String rentFree;
    private LocalDate startDate; private LocalDate endDate; private LocalDate signDate;
    private String status; private String remark;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}

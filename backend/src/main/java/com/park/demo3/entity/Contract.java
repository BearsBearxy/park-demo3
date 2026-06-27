package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.math.BigDecimal; import java.time.LocalDate; import java.time.LocalDateTime;
@Data @TableName("contract")
public class Contract {
    @TableId(type = IdType.AUTO) private Integer id;
    private String contractNo; private Integer tenantId; private Integer buildingId; private Integer unitId;
    private BigDecimal rentArea; private BigDecimal monthlyRent; private BigDecimal deposit;
    private LocalDate startDate; private LocalDate endDate; private LocalDate signDate;
    private String status; private String remark;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
    @TableField(fill = FieldFill.INSERT_UPDATE) private LocalDateTime updatedAt;
}

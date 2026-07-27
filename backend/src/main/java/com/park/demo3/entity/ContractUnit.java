package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
@Data @TableName("contract_unit")
public class ContractUnit {
    @TableId(type = IdType.AUTO) private Integer id;
    private Integer contractId;
    private Integer unitId;   // 附加单元(V58);主单元在 contract.unit_id
}

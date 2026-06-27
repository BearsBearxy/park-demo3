package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
@Data @TableName("tenant_category")
public class TenantCategory {
    @TableId(type = IdType.AUTO) private Integer id;
    private String name;
}

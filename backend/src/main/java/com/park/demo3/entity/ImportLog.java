package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;
@Data @TableName("import_log")
public class ImportLog {
    @TableId(type = IdType.AUTO) private Long id;
    private String dataType;
    private String typeLabel;
    private String fileName;
    private String target;
    @TableField("`rows`") private Integer rows;   // rows 是 MySQL 保留字,列名加反引号
    private Integer ok;
    private Integer warn;
    private String status;
    private String operator;
    @TableField(fill = FieldFill.INSERT) private LocalDateTime createdAt;
}

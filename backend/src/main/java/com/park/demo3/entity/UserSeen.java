package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;
// 系统类通知「看过」(V133,PAGE-BEHAVIOR-SPEC §5.3 末行)。一人一行,键是用户名。
@Data @TableName("user_seen")
public class UserSeen {
    @TableId(type = IdType.INPUT) private String username;
    private String changelogVersion;
    private String bellKey;
    private LocalDateTime updatedAt;
}

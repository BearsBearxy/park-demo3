package com.park.demo3.config;
import com.baomidou.mybatisplus.core.handlers.MetaObjectHandler;
import org.apache.ibatis.reflection.MetaObject;
import org.springframework.context.annotation.*;
import java.time.LocalDateTime;
@Configuration
public class MyBatisPlusConfig {
    @Bean MetaObjectHandler metaObjectHandler() {
        return new MetaObjectHandler() {
            @Override public void insertFill(MetaObject m) {
                strictInsertFill(m, "createdAt", LocalDateTime.class, LocalDateTime.now());
                strictInsertFill(m, "updatedAt", LocalDateTime.class, LocalDateTime.now());
            }
            @Override public void updateFill(MetaObject m) {
                strictUpdateFill(m, "updatedAt", LocalDateTime.class, LocalDateTime.now());
            }
        };
    }
}

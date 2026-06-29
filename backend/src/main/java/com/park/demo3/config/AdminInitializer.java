package com.park.demo3.config;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.park.demo3.entity.AuthUser;
import com.park.demo3.mapper.AuthUserMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

/**
 * 启动时若提供 app.admin.password（prod 强制注入 ADMIN_PASSWORD），则把管理员口令重置为该值，
 * 消除 V2 种子内众所周知的 admin/admin123 默认凭据。留空（dev）则保持种子默认，便于本地登录。
 */
@Slf4j
@Component
public class AdminInitializer implements ApplicationRunner {
    private final AuthUserMapper users;
    private final PasswordEncoder enc;
    private final String adminUsername;
    private final String adminPassword;

    public AdminInitializer(AuthUserMapper users, PasswordEncoder enc,
                            @Value("${app.admin.username:admin}") String adminUsername,
                            @Value("${app.admin.password:}") String adminPassword) {
        this.users = users; this.enc = enc;
        this.adminUsername = adminUsername; this.adminPassword = adminPassword;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (adminPassword == null || adminPassword.isBlank()) return;   // dev：保留种子默认
        AuthUser u = users.selectOne(Wrappers.<AuthUser>lambdaQuery().eq(AuthUser::getUsername, adminUsername));
        if (u == null) { log.warn("admin user '{}' not found; skip password reset", adminUsername); return; }
        if (enc.matches(adminPassword, u.getPasswordHash())) return;    // 已是目标口令，幂等跳过
        u.setPasswordHash(enc.encode(adminPassword));
        users.updateById(u);
        log.info("admin password reset from app.admin.password");
    }
}

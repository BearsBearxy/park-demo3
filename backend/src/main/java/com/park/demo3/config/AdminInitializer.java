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
 * 只读账号（V32 审计建议#8）：app.viewer.password 非空则创建/重置 viewer（role=viewer，GET-only）；
 * 留空则不创建——viewer 不走迁移种子，避免往任何新库塞已知口令。
 */
@Slf4j
@Component
public class AdminInitializer implements ApplicationRunner {
    private final AuthUserMapper users;
    private final PasswordEncoder enc;
    private final String adminUsername;
    private final String adminPassword;
    private final String viewerPassword;

    public AdminInitializer(AuthUserMapper users, PasswordEncoder enc,
                            @Value("${app.admin.username:admin}") String adminUsername,
                            @Value("${app.admin.password:}") String adminPassword,
                            @Value("${app.viewer.password:}") String viewerPassword) {
        this.users = users; this.enc = enc;
        this.adminUsername = adminUsername; this.adminPassword = adminPassword;
        this.viewerPassword = viewerPassword;
    }

    @Override
    public void run(ApplicationArguments args) {
        resetAdmin();
        initViewer();
    }

    private void resetAdmin() {
        if (adminPassword == null || adminPassword.isBlank()) return;   // dev：保留种子默认
        AuthUser u = users.selectOne(Wrappers.<AuthUser>lambdaQuery().eq(AuthUser::getUsername, adminUsername));
        if (u == null) { log.warn("admin user '{}' not found; skip password reset", adminUsername); return; }
        if (enc.matches(adminPassword, u.getPasswordHash())) return;    // 已是目标口令，幂等跳过
        u.setPasswordHash(enc.encode(adminPassword));
        users.updateById(u);
        log.info("admin password reset from app.admin.password");
    }

    private void initViewer() {
        if (viewerPassword == null || viewerPassword.isBlank()) return; // 未配置=不创建只读账号
        AuthUser u = users.selectOne(Wrappers.<AuthUser>lambdaQuery().eq(AuthUser::getUsername, "viewer"));
        if (u == null) {
            u = new AuthUser();
            u.setUsername("viewer");
            u.setDisplayName("只读账号");
            u.setStatus(1);
            u.setRole("viewer");
            u.setPasswordHash(enc.encode(viewerPassword));
            users.insert(u);
            log.info("viewer (read-only) user created from app.viewer.password");
            return;
        }
        if (enc.matches(viewerPassword, u.getPasswordHash())) return;   // 幂等跳过
        u.setPasswordHash(enc.encode(viewerPassword));
        users.updateById(u);
        log.info("viewer password reset from app.viewer.password");
    }
}

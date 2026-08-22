package com.park.demo3.config;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.park.demo3.entity.AuthRole;
import com.park.demo3.entity.AuthUser;
import com.park.demo3.entity.AuthUserRole;
import com.park.demo3.mapper.AuthRoleMapper;
import com.park.demo3.mapper.AuthUserMapper;
import com.park.demo3.mapper.AuthUserRoleMapper;
import com.park.demo3.security.UserPermissionCache;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

/**
 * 启动时若提供 app.admin.password（prod 强制注入 ADMIN_PASSWORD），则把管理员口令重置为该值，
 * 消除 V2 种子内众所周知的 admin/admin123 默认凭据。留空（dev）则保持种子默认，便于本地登录。
 * 只读账号（V32 审计建议#8）：app.viewer.password 非空则创建/重置 viewer；
 * 留空则不创建——viewer 不走迁移种子，避免往任何新库塞已知口令。
 *
 * ⚠ V101 起本类还负责两件事，缺一个都会让新建的账号「登得进但什么都干不了」：
 *   1. 新建账号必须挂上 auth_user_role（V101 的迁移只处理了迁移当时已存在的账号）
 *   2. 收尾必须 {@link UserPermissionCache#reload()} —— 缓存的 @PostConstruct 在
 *      ApplicationRunner 之前跑完，这里新建的 viewer 不在那份快照里，
 *      不 reload 的话 JwtAuthFilter 查不到它，viewer 带着有效令牌也会被 401。
 */
@Slf4j
@Component
public class AdminInitializer implements ApplicationRunner {
    private final AuthUserMapper users;
    private final AuthUserRoleMapper userRoles;
    private final AuthRoleMapper roles;
    private final UserPermissionCache cache;
    private final PasswordEncoder enc;
    private final String adminUsername;
    private final String adminPassword;
    private final String viewerPassword;

    public AdminInitializer(AuthUserMapper users, AuthUserRoleMapper userRoles, AuthRoleMapper roles,
                            UserPermissionCache cache, PasswordEncoder enc,
                            @Value("${app.admin.username:admin}") String adminUsername,
                            @Value("${app.admin.password:}") String adminPassword,
                            @Value("${app.viewer.password:}") String viewerPassword) {
        this.users = users; this.userRoles = userRoles; this.roles = roles; this.cache = cache; this.enc = enc;
        this.adminUsername = adminUsername; this.adminPassword = adminPassword;
        this.viewerPassword = viewerPassword;
    }

    @Override
    public void run(ApplicationArguments args) {
        resetAdmin();
        initViewer();
        cache.reload();   // ⚠ 必须收尾，见类注释
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
            u.setMustChangePassword(0);
            u.setPasswordHash(enc.encode(viewerPassword));
            users.insert(u);
            log.info("viewer (read-only) user created from app.viewer.password");
        } else if (!enc.matches(viewerPassword, u.getPasswordHash())) {
            u.setPasswordHash(enc.encode(viewerPassword));
            users.updateById(u);
            log.info("viewer password reset from app.viewer.password");
        }
        ensureRole(u, "viewer");
    }

    /** 幂等地把账号挂到角色上。挂不上（角色表里没这个 code）只告警不抛——不该因此启动失败。 */
    private void ensureRole(AuthUser u, String roleCode) {
        AuthRole r = roles.selectOne(Wrappers.<AuthRole>lambdaQuery().eq(AuthRole::getCode, roleCode));
        if (r == null) { log.warn("role '{}' not found; user '{}' left without role", roleCode, u.getUsername()); return; }
        Long n = userRoles.selectCount(Wrappers.<AuthUserRole>lambdaQuery()
            .eq(AuthUserRole::getUserId, u.getId()).eq(AuthUserRole::getRoleId, r.getId()));
        if (n != null && n > 0) return;
        AuthUserRole ur = new AuthUserRole();
        ur.setUserId(u.getId());
        ur.setRoleId(r.getId());
        userRoles.insert(ur);
        log.info("user '{}' assigned role '{}'", u.getUsername(), roleCode);
    }
}

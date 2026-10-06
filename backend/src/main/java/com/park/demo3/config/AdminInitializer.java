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
 * 启动时若提供 app.admin.password（prod 强制注入 ADMIN_PASSWORD），且 admin 仍是种子口令（或起点链的 {@link #UNSET_HASH}），则把它改成该值，
 * 消除 V2 种子内众所周知的 admin/admin123 默认凭据。留空（dev）则保持种子默认，便于本地登录。
 * admin 在系统里改过口令之后不再覆盖（2026-10-03 起；原来每次启动都改回 .env 里的值）。
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
    /** V2 种子口令。只有 admin 还是它的时候，app.admin.password 才生效。 */
    static final String SEED_PASSWORD = "admin123";
    /**
     * 起点链(新园区,db/baseline)上 admin 的 password_hash。不是 BCrypt 格式 —— BCryptPasswordEncoder 见格式不对直接判不匹配,
     * 任何口令(含 admin123、空串)都登不进。原来起点脚本照抄老链 admin123 的哈希,而本类是 ApplicationRunner、跑在 Tomcat
     * 开端口之后:新园区第一次启动的头几秒 admin/admin123 登得进(2026-10-05 实测)。见到它与见到种子口令一样换成
     * app.admin.password;没给就一直登不进(宁可锁死),启动日志写明该怎么办。由 BaselineSqlGenerator 的 VALUE_OVERRIDE
     * 写进起点脚本;老链(我园生产、dev、测试库)仍是 admin123 种子,不受影响。
     */
    public static final String UNSET_HASH = "!unset:ADMIN_PASSWORD";
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
        AuthUser u = users.selectOne(Wrappers.<AuthUser>lambdaQuery().eq(AuthUser::getUsername, adminUsername));
        boolean unset = u != null && UNSET_HASH.equals(u.getPasswordHash());
        if (adminPassword == null || adminPassword.isBlank()) {   // dev：保留种子默认
            // 起点链上没给口令 = admin 谁都登不进。compose 缺 ADMIN_PASSWORD 不让 up、prod 档里它没有默认值,
            // 走到这里多半是手动起的非 prod 档 —— 日志得说清楚怎么解,不然只看到登录一直失败
            if (unset) log.warn("admin '{}' has no password yet (new park, baseline chain) and app.admin.password is empty: "
                    + "nobody can log in as admin. Set ADMIN_PASSWORD (deploy/gen-env.sh writes it to .env) and restart the backend",
                    adminUsername);
            return;
        }
        if (u == null) { log.warn("admin user '{}' not found; skip password reset", adminUsername); return; }
        // 占位哈希先判掉:拿它去 BCrypt 比只会多打一行「does not look like BCrypt」告警,结果反正是不匹配
        if (!unset && enc.matches(adminPassword, u.getPasswordHash())) return;    // 已是目标口令，幂等跳过
        // 只覆盖种子口令(首次部署)。原来每次启动只要对不上就改回 .env 里的值 —— 管理员在系统里轮换过的口令
        // (比如怀疑泄露之后),下一次合并即部署就被悄悄改回旧值(安全审计 F06)。改过一次之后 .env 这项只剩开机必填的作用。
        if (!unset && !enc.matches(SEED_PASSWORD, u.getPasswordHash())) {
            log.info("admin password was changed in-app; app.admin.password not applied");
            return;
        }
        // 只写口令列(2026-10-04):跑到这里时 Web 端口已经开了,整行写回会把这一刻读到的 status / token_version
        // 盖回去 —— 同时有人登录、被停用就丢了(同 SystemService.updateUser)。
        AuthUser patch = new AuthUser();
        patch.setId(u.getId());
        patch.setPasswordHash(enc.encode(adminPassword));
        users.updateById(patch);
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
            AuthUser patch = new AuthUser();   // 只写口令列,同 resetAdmin
            patch.setId(u.getId());
            patch.setPasswordHash(enc.encode(viewerPassword));
            users.updateById(patch);
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

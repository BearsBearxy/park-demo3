package com.park.demo3.config;
import com.park.demo3.entity.AuthRole;
import com.park.demo3.entity.AuthUser;
import com.park.demo3.entity.AuthUserRole;
import com.park.demo3.mapper.AuthRoleMapper;
import com.park.demo3.mapper.AuthUserMapper;
import com.park.demo3.mapper.AuthUserRoleMapper;
import com.park.demo3.security.UserPermissionCache;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

// initViewer 三分支单测(无 Spring/Docker):IT 里 Spring 上下文跨类缓存,initializer 只跑一次,
// 幂等/重置分支(每次生产启动都会走)天然测不到,这里用 Mockito 直接锁定。
@ExtendWith(OutputCaptureExtension.class)   // 占位+空口令那条 warn 是运维唯一的线索,得有断言钉住它打没打
class AdminInitializerTest {
    private final PasswordEncoder enc = new BCryptPasswordEncoder();
    private final AuthUserMapper users = mock(AuthUserMapper.class);
    private final AuthUserRoleMapper userRoles = mock(AuthUserRoleMapper.class);
    private final AuthRoleMapper roles = mock(AuthRoleMapper.class);
    private final UserPermissionCache cache = mock(UserPermissionCache.class);

    private AdminInitializer init(String viewerPassword) {
        return new AdminInitializer(users, userRoles, roles, cache, enc, "admin", "", viewerPassword);
    }

    /** 角色表里有 viewer 角色时的桩;不打这个桩 = 模拟角色缺失(ensureRole 只告警不抛)。 */
    private void stubViewerRole(int roleId) {
        AuthRole r = new AuthRole();
        r.setId(roleId); r.setCode("viewer");
        when(roles.selectOne(any())).thenReturn(r);
    }

    private AuthUser viewer(String password) {
        AuthUser u = new AuthUser();
        u.setUsername("viewer"); u.setRole("viewer"); u.setStatus(1);
        u.setPasswordHash(enc.encode(password));
        return u;
    }

    // ── admin 口令只覆盖种子(安全审计 F06) ──

    private AuthUser admin(String password) {
        AuthUser u = new AuthUser();
        u.setUsername("admin"); u.setStatus(1);
        u.setPasswordHash(enc.encode(password));
        return u;
    }

    @Test
    void adminStillOnSeedPasswordGetsTheEnvPassword() {
        when(users.selectOne(any())).thenReturn(admin(AdminInitializer.SEED_PASSWORD));
        new AdminInitializer(users, userRoles, roles, cache, enc, "admin", "from-env-123", "").run(null);
        verify(users).updateById(org.mockito.ArgumentMatchers.<AuthUser>argThat(
                u -> enc.matches("from-env-123", u.getPasswordHash())));
    }

    /** 破坏验证:去掉 resetAdmin 里「不是种子口令就跳过」那句 → updateById 被调到,红。 */
    @Test
    void adminWhoRotatedInAppIsNotResetBackToTheEnvPassword() {
        when(users.selectOne(any())).thenReturn(admin("rotated-in-app-1"));
        new AdminInitializer(users, userRoles, roles, cache, enc, "admin", "from-env-123", "").run(null);
        verify(users, never()).updateById(any(AuthUser.class));
    }

    // ── 起点链(新园区):admin 口令列是占位 UNSET_HASH,首次启动前谁都登不进(2026-10-05 实测的 admin123 窗口) ──

    private AuthUser adminWithHash(String hash) {
        AuthUser u = new AuthUser();
        u.setUsername("admin"); u.setStatus(1);
        u.setPasswordHash(hash);
        return u;
    }

    /** 破坏验证:去掉种子判断前的 `!unset &&` → 占位被当成「在系统里改过」跳过,updateById 没调到,红。 */
    @Test
    void adminOnUnsetHashGetsTheEnvPassword() {
        when(users.selectOne(any())).thenReturn(adminWithHash(AdminInitializer.UNSET_HASH));
        new AdminInitializer(users, userRoles, roles, cache, enc, "admin", "from-env-123", "").run(null);
        verify(users).updateById(org.mockito.ArgumentMatchers.<AuthUser>argThat(
                u -> enc.matches("from-env-123", u.getPasswordHash())));
    }

    /** 没给 ADMIN_PASSWORD:占位原样留着(宁可锁死),不拿空串或种子口令去填。破坏验证:空口令不 return → 写进 encode(""),红;
     *  删掉那行 warn → 红(不然登录一直失败、日志里一个字都没有) */
    @Test
    void adminOnUnsetHashStaysLockedWithoutEnvPassword(CapturedOutput output) {
        when(users.selectOne(any())).thenReturn(adminWithHash(AdminInitializer.UNSET_HASH));
        init("").run(null);
        verify(users, never()).updateById(any(AuthUser.class));
        assertThat(output).contains("has no password yet").contains("Set ADMIN_PASSWORD");
    }

    /** 老链 dev(没设 ADMIN_PASSWORD):种子 admin123 原样保留,本地照旧用它登录,也不该喊「登不进」。
     *  破坏验证同上;warn 条件改成恒真 → 红 */
    @Test
    void legacySeedIsKeptWithoutEnvPassword(CapturedOutput output) {
        when(users.selectOne(any())).thenReturn(admin(AdminInitializer.SEED_PASSWORD));
        init("").run(null);
        verify(users, never()).updateById(any(AuthUser.class));
        assertThat(output).doesNotContain("has no password yet");
    }

    @Test
    void blankPasswordCreatesNothing() {
        init("").run(null);
        // 空口令也要查一次 admin(看它是不是起点链的占位,好在日志里说怎么解),除这一次读之外一概不许碰。
        // 只禁 insert/updateById 的话,有人往这条路上加个 update(wrapper)/delete 也照样绿
        verify(users).selectOne(any());
        verifyNoMoreInteractions(users);
        verify(cache).reload();   // 不建账号也要 reload:V101 迁移刚挂上的角色要进快照
    }

    @Test
    void missingViewerIsCreatedWithViewerRole() {
        when(users.selectOne(any())).thenReturn(null);
        init("viewer123").run(null);
        verify(users).insert(org.mockito.ArgumentMatchers.<AuthUser>argThat(u ->
                "viewer".equals(u.getUsername()) && "viewer".equals(u.getRole())
                        && u.getStatus() == 1 && enc.matches("viewer123", u.getPasswordHash())));
    }

    @Test
    void samePasswordIsIdempotentNoRehash() {
        when(users.selectOne(any())).thenReturn(viewer("viewer123"));
        init("viewer123").run(null);
        verify(users, never()).updateById(any(AuthUser.class));
        verify(users, never()).insert(any(AuthUser.class));
    }

    // ── V101 新增的两项职责 ──

    @Test
    void newViewerIsAssignedViewerRole() {
        when(users.selectOne(any())).thenReturn(null);
        stubViewerRole(7);
        when(userRoles.selectCount(any())).thenReturn(0L);
        init("viewer123").run(null);
        verify(userRoles).insert(org.mockito.ArgumentMatchers.<AuthUserRole>argThat(
                ur -> ur.getRoleId() == 7));
    }

    @Test
    void existingRoleLinkIsNotDuplicated() {
        when(users.selectOne(any())).thenReturn(viewer("viewer123"));
        stubViewerRole(7);
        when(userRoles.selectCount(any())).thenReturn(1L);
        init("viewer123").run(null);
        verify(userRoles, never()).insert(any(AuthUserRole.class));
    }

    @Test
    void cacheIsAlwaysReloadedLast() {
        // 不 reload 的话:缓存的 @PostConstruct 早于 ApplicationRunner 跑完,
        // 这里新建的 viewer 不在快照里,它带着有效令牌也会被 JwtAuthFilter 判成停用 → 401
        when(users.selectOne(any())).thenReturn(null);
        stubViewerRole(7);
        when(userRoles.selectCount(any())).thenReturn(0L);
        init("viewer123").run(null);
        verify(cache).reload();
    }

    @Test
    void changedPasswordIsReset() {
        when(users.selectOne(any())).thenReturn(viewer("old-secret"));
        init("new-secret").run(null);
        verify(users).updateById(org.mockito.ArgumentMatchers.<AuthUser>argThat(u ->
                enc.matches("new-secret", u.getPasswordHash())));
    }
}

package com.park.demo3.config;
import com.park.demo3.entity.AuthRole;
import com.park.demo3.entity.AuthUser;
import com.park.demo3.entity.AuthUserRole;
import com.park.demo3.mapper.AuthRoleMapper;
import com.park.demo3.mapper.AuthUserMapper;
import com.park.demo3.mapper.AuthUserRoleMapper;
import com.park.demo3.security.UserPermissionCache;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

// initViewer 三分支单测(无 Spring/Docker):IT 里 Spring 上下文跨类缓存,initializer 只跑一次,
// 幂等/重置分支(每次生产启动都会走)天然测不到,这里用 Mockito 直接锁定。
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

    @Test
    void blankPasswordCreatesNothing() {
        init("").run(null);
        verifyNoInteractions(users);
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

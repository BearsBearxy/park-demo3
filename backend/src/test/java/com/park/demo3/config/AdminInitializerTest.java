package com.park.demo3.config;
import com.park.demo3.entity.AuthUser;
import com.park.demo3.mapper.AuthUserMapper;
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

    private AdminInitializer init(String viewerPassword) {
        return new AdminInitializer(users, enc, "admin", "", viewerPassword);
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

    @Test
    void changedPasswordIsReset() {
        when(users.selectOne(any())).thenReturn(viewer("old-secret"));
        init("new-secret").run(null);
        verify(users).updateById(org.mockito.ArgumentMatchers.<AuthUser>argThat(u ->
                enc.matches("new-secret", u.getPasswordHash())));
    }
}

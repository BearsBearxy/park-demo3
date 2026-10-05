package com.park.demo3.security;

import com.park.demo3.AbstractMysqlIT;
import com.park.demo3.common.BizException;
import com.park.demo3.dto.SystemDtos.UserUpdateReq;
import com.park.demo3.entity.AuthUser;
import com.park.demo3.mapper.AuthUserMapper;
import com.park.demo3.service.SessionService;
import com.park.demo3.service.SystemService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import static java.util.concurrent.TimeUnit.SECONDS;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.assertj.core.api.SoftAssertions.assertSoftly;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

/**
 * auth_user 的丢失更新(2026-10-04 复查发现)。写方法原来整行 updateById 事务开头读到的那个对象,
 * MyBatis-Plus 把每个非空列都写回去 —— 这期间别人已提交的停用、版本号 +1 被旧值盖掉:
 * 停用被悄悄撤销,token_version 往回走。
 *
 * 不赛跑:外层事务先读一次,把读视图钉在停用提交之前(REPEATABLE READ,之后的普通读都看这一刻 ——
 * 同改密事务开头那一读之后还要验旧口令、算新哈希的几百毫秒);停用在另一条线程、另一个连接上提交;
 * 再在同一个外层事务里调写方法,它读到的是停用前的那份。
 * 不能 @Transactional:停用要真提交才看得见,建的号 @AfterEach 删掉(同 SessionCacheRaceIT)。
 */
@AutoConfigureMockMvc
class AuthUserLostUpdateIT extends AbstractMysqlIT {
    private static final String PASS = "lost-upd-pass-1", NEW = "lost-upd-pass-2", RESET = "lost-upd-pass-3";

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformTransactionManager txm;
    @Autowired AuthUserMapper users;
    @Autowired SystemService svc;
    @Autowired SessionService sessions;
    @Autowired UserPermissionCache cache;
    @Autowired JwtUtil jwt;
    @Autowired PasswordEncoder enc;

    private final ExecutorService pool = Executors.newSingleThreadExecutor();
    private AuthUser u;

    @BeforeEach
    void mkUser() {
        u = new AuthUser();
        u.setUsername("it_lost_" + System.nanoTime() % 1_000_000);
        u.setDisplayName("丢失更新");
        u.setPasswordHash(enc.encode(PASS));
        u.setStatus(1);
        u.setRole("viewer");
        u.setMustChangePassword(0);
        users.insert(u);
        cache.reload();
    }

    @AfterEach
    void cleanup() {
        pool.shutdownNow();
        jdbc.update("DELETE FROM auth_audit_log WHERE target=?", "user:" + u.getUsername());
        jdbc.update("DELETE FROM auth_session WHERE username=?", u.getUsername());
        jdbc.update("DELETE FROM auth_user WHERE id=?", u.getId());
        cache.reload();
    }

    // 破坏验证:① changeOwnPassword 改回整行 updateById(u)、不带 status=1 → 401、状态、快照、理由四条红;
    //          ② 去掉「0 行 → 401」→ 401、版本号两条红;③ 0 行那句不按停用名单分 → 「账号已停用」那条红
    @Test
    void disableCommitsDuringAPasswordChange_staysDisabled() throws Exception {
        String old = token(sessions.open(u, "127.0.0.1", "it", "relogin"));
        int[] tvAfterDisable = new int[1];
        Throwable thrown = catchThrowable(() -> as(u.getUsername(), () -> new TransactionTemplate(txm).executeWithoutResult(s -> {
            users.selectById(u.getId());                     // 改密事务开头那一读
            tvAfterDisable[0] = disableOnAnotherThread();    // 管理员在他验口令、算哈希的那几百毫秒里停用了他
            svc.changeOwnPassword(PASS, NEW);                // 读到的还是停用前那份:启用、旧版本号
        })));
        MockHttpServletResponse res = me(old);
        assertSoftly(s -> {
            s.assertThat(thrown).as("刚被停用,改密落空").isInstanceOf(BizException.class)
             .hasFieldOrPropertyWithValue("code", 401);
            s.assertThat(thrown).as("改密页上说「账号已停用」,同登录").hasMessage("账号已停用，请联系管理员");
            s.assertThat(statusInDb()).as("停用不被改密撤销").isZero();
            s.assertThat(tvInDb()).as("被拒的改密不动版本号,更不往回写").isEqualTo(tvAfterDisable[0]);
            s.assertThat(cache.get(u.getUsername())).as("快照里没有他").isNull();
            s.assertThat(res.getStatus() + " " + res.getHeader("X-Auth-Reason")).as("令牌不认,登录页说「账号已停用」")
             .isEqualTo("401 disabled");
        });
    }

    // 破坏验证:① updateUser 改回整行 updateById(u) → 状态、版本号、快照、理由四条红;② 补丁里不写显示名 → 改名那条红
    @Test
    void disableCommitsDuringARename_staysDisabled() throws Exception {
        String old = token(sessions.open(u, "127.0.0.1", "it", "relogin"));
        int[] tvAfterDisable = new int[1];
        as("admin", () -> new TransactionTemplate(txm).executeWithoutResult(s -> {
            users.selectById(u.getId());                     // 改名事务开头那一读(mustUser)
            tvAfterDisable[0] = disableOnAnotherThread();    // 另一位管理员同时停用了他
            svc.updateUser(u.getId(), new UserUpdateReq("改过的名字", List.of()));
        }));
        MockHttpServletResponse res = me(old);
        assertSoftly(s -> {
            s.assertThat(jdbc.queryForObject("SELECT display_name FROM auth_user WHERE id=?", String.class, u.getId()))
             .as("改名照样生效").isEqualTo("改过的名字");
            s.assertThat(statusInDb()).as("停用不被改名撤销").isZero();
            s.assertThat(tvInDb()).as("版本号不往回走").isGreaterThanOrEqualTo(tvAfterDisable[0]);
            s.assertThat(cache.get(u.getUsername())).as("快照里没有他").isNull();
            s.assertThat(res.getStatus() + " " + res.getHeader("X-Auth-Reason")).as("令牌不认,登录页说「账号已停用」")
             .isEqualTo("401 disabled");
        });
    }

    // 破坏验证:SessionService.bump 改回「u 里的数 + 1」→ 两条都红
    @Test
    void loginOnAStaleRead_bumpsFromTheDatabase() {
        AuthUser stale = users.selectById(u.getId());        // 登录先读人,再验几百毫秒口令
        sessions.revokeAll(u.getUsername(), "admin:it");     // 这期间库里的版本号走了两步(被踢、别处又登一次之类)
        sessions.revokeAll(u.getUsername(), "admin:it");
        int before = tvInDb();
        SessionService.Issued is = sessions.open(stale, "127.0.0.1", "it", "relogin");
        assertSoftly(s -> {
            s.assertThat(is.tokenVersion()).as("新令牌的版本号接着库里的往上数").isEqualTo(before + 1);
            s.assertThat(tvInDb()).as("库里的版本号不往回走").isEqualTo(before + 1);
        });
    }

    // 破坏验证:① changeOwnPassword 的条件里去掉「口令还是验过的那个」→ 401、口令、强制改密三条红;
    //          ② 0 行那句一律说「账号已停用」→ 「不说成停用」那条红
    @Test
    void resetCommitsDuringAPasswordChange_theResetStands() {
        Throwable thrown = catchThrowable(() -> as(u.getUsername(), () -> new TransactionTemplate(txm).executeWithoutResult(s -> {
            users.selectById(u.getId());                     // 改密事务开头那一读
            onAnotherThread(() -> svc.resetPassword(u.getId(), RESET));   // 管理员在他验口令、算哈希的那几百毫秒里重置了密码
            svc.changeOwnPassword(PASS, NEW);                // 验的还是重置前的旧口令
        })));
        AuthUser db = users.selectById(u.getId());
        assertSoftly(s -> {
            s.assertThat(thrown).as("口令刚被重置,改密落空").isInstanceOf(BizException.class)
             .hasFieldOrPropertyWithValue("code", 401);
            s.assertThat(thrown == null ? "" : thrown.getMessage()).as("不说成停用").doesNotContain("停用");
            s.assertThat(enc.matches(RESET, db.getPasswordHash())).as("库里还是管理员重置的那个").isTrue();
            s.assertThat(db.getMustChangePassword()).as("他下次登录仍要改密").isEqualTo(1);
        });
    }

    // 破坏验证:open 里版本号 +1 不带 status=1 → 三条都红
    @Test
    void disableCommitsDuringALogin_noSessionIsOpened() {
        AuthUser stale = users.selectById(u.getId());        // 登录先读人(启用),再验几百毫秒口令
        as("admin", () -> svc.setStatus(u.getId(), 0));      // 这期间管理员停用了他,已提交
        int before = tvInDb();
        Throwable thrown = catchThrowable(() -> sessions.open(stale, "127.0.0.1", "it", "relogin"));
        assertSoftly(s -> {
            s.assertThat(thrown).as("登录答「账号已停用」,同密码对了的停用号").isInstanceOf(BizException.class)
             .hasFieldOrPropertyWithValue("code", 403).hasMessage("账号已停用，请联系管理员");
            s.assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM auth_session WHERE username=? AND revoked_at IS NULL",
                Integer.class, u.getUsername())).as("「谁在线」里没有他").isZero();
            s.assertThat(tvInDb()).as("版本号不动").isEqualTo(before);
        });
    }

    /** 另一条线程、另一个连接上以 admin 停用他并提交,返回提交后库里的版本号。 */
    private int disableOnAnotherThread() {
        try {
            return pool.submit(() -> { as("admin", () -> svc.setStatus(u.getId(), 0)); return tvInDb(); }).get(30, SECONDS);
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    /** 另一条线程、另一个连接上以 admin 跑 body 并提交。 */
    private void onAnotherThread(Runnable body) {
        try {
            pool.submit(() -> as("admin", body)).get(30, SECONDS);
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    /** 以 name 的身份在本线程跑 body。直接调 service 没有请求:验旧口令要按 IP 限流、换新令牌要读 User-Agent,给一个空请求。 */
    private static void as(String name, Runnable body) {
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(name, null, List.of()));
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(new MockHttpServletRequest()));
        try { body.run(); } finally { SecurityContextHolder.clearContext(); RequestContextHolder.resetRequestAttributes(); }
    }

    private int statusInDb() {
        return jdbc.queryForObject("SELECT status FROM auth_user WHERE id=?", Integer.class, u.getId());
    }

    private int tvInDb() {
        return jdbc.queryForObject("SELECT token_version FROM auth_user WHERE id=?", Integer.class, u.getId());
    }

    private String token(SessionService.Issued is) {
        return jwt.generate(u.getUsername(), "viewer", is.tokenVersion(), is.sessionId());
    }

    private MockHttpServletResponse me(String token) throws Exception {
        return mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token)).andReturn().getResponse();
    }
}

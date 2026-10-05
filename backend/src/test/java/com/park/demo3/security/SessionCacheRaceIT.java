package com.park.demo3.security;

import com.park.demo3.AbstractMysqlIT;
import com.park.demo3.entity.AuthUser;
import com.park.demo3.mapper.AuthUserMapper;
import com.park.demo3.service.SessionService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static java.util.concurrent.TimeUnit.SECONDS;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.SoftAssertions.assertSoftly;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

/**
 * 刚签的令牌被同时进行的一次 cache.reload() 盖掉(2026-10-04 实测:后端刚重启,新建的账号登进来改密码,401)。
 *
 * reload 从库里读 token_version、从快照里抄 sid。它那次读要是早于某次登录/踢人的提交 ——
 * 登录还没提交时别的线程在 reload(AdminInitializer、任何一次角色/账号保存),
 * 或者 reload 跑在一个开得更早的事务里(SystemService 的写方法收尾那次,REPEATABLE READ 读的是事务第一次读那一刻)——
 * 就把旧版本号和新 sid 拼在一起发布出去:刚签的那张 tv 对不上,401,直到下一次 reload。
 *
 * 不赛跑:用 join / latch 把「reload 读库」钉在「登录提交」之前,每次都复现。
 * 不能 @Transactional:要两个连接之间真提交才看得见,建的号 @AfterEach 删掉(同 LastAdminLockIT)。
 */
@AutoConfigureMockMvc
class SessionCacheRaceIT extends AbstractMysqlIT {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformTransactionManager txm;
    @Autowired AuthUserMapper users;
    @Autowired SessionService sessions;
    @Autowired UserPermissionCache cache;
    @Autowired JwtUtil jwt;

    private final ExecutorService pool = Executors.newSingleThreadExecutor();
    private AuthUser u;

    @BeforeEach
    void mkUser() {
        u = new AuthUser();
        u.setUsername("it_race_" + System.nanoTime() % 1_000_000);
        u.setDisplayName("会话竞态");
        u.setPasswordHash("x");              // 不走口令登录,直接 sessions.open
        u.setStatus(1);
        u.setRole("viewer");
        u.setMustChangePassword(0);
        users.insert(u);
        cache.reload();
    }

    @AfterEach
    void cleanup() {
        pool.shutdownNow();
        jdbc.update("DELETE FROM auth_session WHERE username=?", u.getUsername());
        jdbc.update("DELETE FROM auth_user WHERE id=?", u.getId());
        cache.reload();
    }

    // 破坏验证:reload 里 tv 不取快照与库的较大者 → 两条都红
    @Test
    void reloadBeforeTheLoginCommits_keepsTheNewSession() throws Exception {
        SessionService.Issued is = new TransactionTemplate(txm).execute(s -> {
            SessionService.Issued i = sessions.open(u, "127.0.0.1", "it", "relogin");
            reloadOnAnotherThread();         // 读不到这次还没提交的 token_version
            return i;
        });
        assertLive(is);
    }

    // 破坏验证:同上。要在那个事务提交前看:提交后 reload 会再读一次库(R1 / R2 的修法),那时已经对了
    @Test
    void reloadInsideAnOlderTransaction_keepsACommittedLogin() throws Exception {
        CountDownLatch snapped = new CountDownLatch(1), loggedIn = new CountDownLatch(1);
        CountDownLatch reloaded = new CountDownLatch(1), checked = new CountDownLatch(1);
        Future<?> admin = pool.submit(() -> new TransactionTemplate(txm).executeWithoutResult(s -> {
            users.selectById(u.getId());     // 第一次读定下这个事务的读视图
            snapped.countDown();
            await(loggedIn);
            cache.reload();                  // 形同 SystemService 写方法收尾的那次 reload
            reloaded.countDown();
            await(checked);                  // 还没提交
        }));
        await(snapped);
        SessionService.Issued is = sessions.open(u, "127.0.0.1", "it", "relogin");   // 自己的事务,已提交
        loggedIn.countDown();
        await(reloaded);
        try { assertLive(is); } finally { checked.countDown(); }
        admin.get(30, SECONDS);
    }

    // 破坏验证:① 同上 → 版本号那条红(sid 已置空,旧令牌照样不认);② revokeAll 不改快照 → 401 那条红
    @Test
    void reloadBeforeTheRevokeCommits_theOldTokenStaysDead() throws Exception {
        String old = token(sessions.open(u, "127.0.0.1", "it", "relogin"));
        assertThat(me(old).getStatus()).isEqualTo(200);

        new TransactionTemplate(txm).executeWithoutResult(s -> {
            sessions.revokeAll(u.getUsername(), "admin:it");
            reloadOnAnotherThread();
        });

        MockHttpServletResponse res = me(old);
        int tv = jdbc.queryForObject("SELECT token_version FROM auth_user WHERE id=?", Integer.class, u.getId());
        int cached = cache.get(u.getUsername()).tokenVersion();
        assertSoftly(s -> {
            s.assertThat(res.getStatus()).as("踢掉之后旧令牌不认").isEqualTo(401);
            s.assertThat(res.getHeader("X-Auth-Reason")).as("被踢的一方知道是谁踢的").isEqualTo("admin:it");
            s.assertThat(cached).as("快照里的版本号 = 已提交的").isEqualTo(tv);
        });
    }

    // 下面三条不是 tv:reload 读到提交前的库,别的字段也一样被发布成旧值(2026-10-04 对抗复查 R1 / R2)。
    // 写方法事务里那次 reload 读得到本事务的写,可它之后、提交之前别的线程的 reload 读不到,发布在它后面。
    // 破坏验证:reload 不在事务结束后再跑一次 → 三条都红

    @Test
    void reloadBeforeTheNewAccountCommits_itCanStillLogIn() throws Exception {
        jdbc.update("DELETE FROM auth_user WHERE id=?", u.getId());
        cache.reload();
        u.setId(null);
        new TransactionTemplate(txm).executeWithoutResult(s -> {
            users.insert(u);
            cache.reload();                  // 形同 SystemService.createUser 收尾那次
            reloadOnAnotherThread();         // 读不到还没提交的新号,发布一份没有它的快照
        });
        // 快照里没有这个号,applySession 找不到人、新 sid 落空
        SessionService.Issued is = sessions.open(u, "127.0.0.1", "it", "relogin");
        assertThat(me(token(is)).getStatus()).as("新号刚登进来的令牌能用").isEqualTo(200);
    }

    @Test
    void reloadBeforeThePasswordChangeCommits_theNewTokenIsLetThrough() throws Exception {
        jdbc.update("UPDATE auth_user SET must_change_password=1 WHERE id=?", u.getId());
        cache.reload();
        SessionService.Issued is = new TransactionTemplate(txm).execute(s -> {
            jdbc.update("UPDATE auth_user SET must_change_password=0 WHERE id=?", u.getId());
            cache.reload();                  // 形同 changeOwnPassword:先 reload,再给本机换新令牌
            reloadOnAnotherThread();         // 读到已提交的 must_change=1,又把他放回 mustChange
            return sessions.open(u, "127.0.0.1", "it", "password");
        });
        // /api/auth/perms 不在改密前的白名单里:还在 mustChange 里就是 403
        int status = mvc.perform(get("/api/auth/perms").header("Authorization", "Bearer " + token(is)))
            .andReturn().getResponse().getStatus();
        assertThat(status).as("改完密码,新令牌不再被拦回改密页").isEqualTo(200);
    }

    @Test
    void reloadBeforeTheDisableCommits_theKickedSideHearsDisabled() throws Exception {
        String old = token(sessions.open(u, "127.0.0.1", "it", "relogin"));
        new TransactionTemplate(txm).executeWithoutResult(s -> {
            jdbc.update("UPDATE auth_user SET status=0 WHERE id=?", u.getId());
            cache.reload();                  // 形同 SystemService.setStatus
            sessions.revokeAll(u.getUsername(), "disabled");
            reloadOnAnotherThread();         // 读到已提交的 status=1,把他放回快照,理由是空的
        });
        MockHttpServletResponse res = me(old);
        assertSoftly(s -> {
            s.assertThat(res.getStatus()).as("停用之后旧令牌不认").isEqualTo(401);
            s.assertThat(res.getHeader("X-Auth-Reason")).as("登录页说「账号已停用」").isEqualTo("disabled");
        });
    }

    private void assertLive(SessionService.Issued is) throws Exception {
        int status = me(token(is)).getStatus();
        UserPermissionCache.UserAuth ua = cache.get(u.getUsername());
        assertSoftly(s -> {
            s.assertThat(status).as("刚签的令牌能用").isEqualTo(200);
            s.assertThat(List.<Object>of(ua.tokenVersion(), ua.sessionId())).as("快照里是这次登录的 tv / sid")
             .containsExactly(is.tokenVersion(), is.sessionId());
        });
    }

    private String token(SessionService.Issued is) {
        return jwt.generate(u.getUsername(), "viewer", is.tokenVersion(), is.sessionId());
    }

    private MockHttpServletResponse me(String token) throws Exception {
        return mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token)).andReturn().getResponse();
    }

    private void reloadOnAnotherThread() {
        try { pool.submit(cache::reload).get(30, SECONDS); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }

    private static void await(CountDownLatch l) {
        try { if (!l.await(30, SECONDS)) throw new IllegalStateException("latch timeout"); }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new IllegalStateException(e); }
    }
}

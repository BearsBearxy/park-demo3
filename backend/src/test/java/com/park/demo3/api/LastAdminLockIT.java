package com.park.demo3.api;

import com.park.demo3.AbstractMysqlIT;
import com.park.demo3.dto.SystemDtos.UserCreateReq;
import com.park.demo3.security.UserPermissionCache;
import com.park.demo3.service.SystemService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.concurrent.*;

import static java.util.concurrent.TimeUnit.MILLISECONDS;
import static java.util.concurrent.TimeUnit.SECONDS;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 「至少留一个启用的系统管理员」的并发那一半(RBAC-SPEC §12.3)。
 *
 * 两个系统管理员同时互相停用:守卫用普通读的话,各自看见对方还启用着、双双放行,提交后一个都不剩。
 * 这里不赛跑(赛不准),验的是守卫在三处真的上了锁 —— 另一个事务先锁住其中一处,
 * 停用一个系统管理员就得排队等它;普通读不排队,当场走完。
 *
 * 不能 @Transactional:锁要在两个连接之间才看得见,所以建的号是提交了的,@AfterEach 删掉。
 */
class LastAdminLockIT extends AbstractMysqlIT {

    @Autowired SystemService svc;
    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformTransactionManager txm;
    @Autowired UserPermissionCache cache;

    private final ExecutorService pool = Executors.newFixedThreadPool(2);
    private String uname;
    private Integer uid;
    private int adminRole, adminUser;

    @BeforeEach
    void mkSecondAdmin() throws Exception {
        adminRole = jdbc.queryForObject("SELECT id FROM auth_role WHERE code='admin'", Integer.class);
        adminUser = jdbc.queryForObject("SELECT id FROM auth_user WHERE username='admin'", Integer.class);
        uname = "it_lastadm_" + System.nanoTime() % 1_000_000;
        uid = pool.submit(() -> asAdmin(() ->
            svc.createUser(new UserCreateReq(uname, "并发测试管理员", "init-pass-123", List.of(adminRole))).id())).get(30, SECONDS);
    }

    @AfterEach
    void cleanup() {
        pool.shutdownNow();
        jdbc.update("DELETE FROM auth_audit_log WHERE target=?", "user:" + uname);
        jdbc.update("DELETE FROM auth_session WHERE username=?", uname);
        jdbc.update("DELETE FROM auth_user_role WHERE user_id=?", uid);
        jdbc.update("DELETE FROM auth_user WHERE id=?", uid);
        cache.reload();
    }

    @Test
    void disablingAnAdmin_queuesBehindTheAdminRoleRow() throws Exception {
        assertDisableWaitsWhile("SELECT id FROM auth_role WHERE id=" + adminRole + " FOR UPDATE");
    }

    /** 走 role_id 那条索引锁(守卫按 role_id 查,读的是那条索引;并发的摘角色删行也锁它)。按主键锁的话守卫的共享读碰不上 */
    @Test
    void disablingAnAdmin_readsWhoHoldsTheAdminRoleWithALock() throws Exception {
        assertDisableWaitsWhile("SELECT user_id FROM auth_user_role FORCE INDEX (idx_aur_role) WHERE role_id=" + adminRole
            + " AND user_id=" + adminUser + " FOR UPDATE");
    }

    @Test
    void disablingAnAdmin_readsTheOtherAdminsStatusWithALock() throws Exception {
        assertDisableWaitsWhile("SELECT id FROM auth_user WHERE id=" + adminUser + " FOR UPDATE");
    }

    /** 另一个事务拿 lockSql 锁住一处 → 停用 uname(一个系统管理员)必须等;锁一放就照常停掉(还有 admin,不是最后一个)。 */
    private void assertDisableWaitsWhile(String lockSql) throws Exception {
        CountDownLatch held = new CountDownLatch(1), release = new CountDownLatch(1);
        Future<?> holder = pool.submit(() -> new TransactionTemplate(txm).executeWithoutResult(s -> {
            jdbc.queryForList(lockSql);
            held.countDown();
            try { release.await(15, SECONDS); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            s.setRollbackOnly();
        }));
        assertThat(held.await(15, SECONDS)).isTrue();
        Future<?> disable = pool.submit(() -> asAdmin(() -> svc.setStatus(uid, 0)));
        try {
            assertThatThrownBy(() -> disable.get(1500, MILLISECONDS))
                .as("别人锁着这一处时,停用系统管理员必须排队等;不等 = 普通读,互相停用会双双放行")
                .isInstanceOf(TimeoutException.class);
        } finally {
            release.countDown();
        }
        holder.get(15, SECONDS);
        disable.get(15, SECONDS);
        assertThat(jdbc.queryForObject("SELECT status FROM auth_user WHERE id=?", Integer.class, uid)).isZero();
    }

    private static <T> T asAdmin(Callable<T> body) throws Exception {
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken("admin", null, List.of()));
        try { return body.call(); } finally { SecurityContextHolder.clearContext(); }
    }
}

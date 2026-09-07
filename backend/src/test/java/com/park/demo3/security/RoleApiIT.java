package com.park.demo3.security;
import com.jayway.jsonpath.JsonPath;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.park.demo3.AbstractMysqlIT;
import com.park.demo3.entity.AuthRole;
import com.park.demo3.entity.AuthRolePerm;
import com.park.demo3.mapper.AuthRoleMapper;
import com.park.demo3.mapper.AuthRolePermMapper;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import static org.assertj.core.api.Assertions.assertThat;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

// 只读角色(V32 审计建议#8):GET=读(两角色),非 GET=写(按 V101 的权限映射表)。
// viewer 账号由 AdminInitializer 按 app.viewer.password(application.yml dev 默认 viewer123)创建。
//
// V101(RBAC v2「读全开,写分权」)带来两点变化,本类锁住它们:
//  1. 令牌里**不再有可陈旧的授权信息** —— 权限每请求从 UserPermissionCache 现查
//  2. 停用账号立刻失效,不必等令牌过期
@AutoConfigureMockMvc
class RoleApiIT extends AbstractMysqlIT {
    @Autowired MockMvc mvc;
    @Autowired JwtUtil jwt;
    @Autowired AuthRoleMapper roles;
    @Autowired AuthRolePermMapper rolePerms;

    private Set<String> permsOf(String roleCode) {
        AuthRole r = roles.selectOne(Wrappers.<AuthRole>lambdaQuery().eq(AuthRole::getCode, roleCode));
        assertThat(r).as("预置角色 %s 不存在(V101 种子被改坏了?)", roleCode).isNotNull();
        return rolePerms.selectList(Wrappers.<AuthRolePerm>lambdaQuery()
                .eq(AuthRolePerm::getRoleId, r.getId()))
            .stream().map(AuthRolePerm::getPerm).collect(Collectors.toSet());
    }

    private String login(String user, String pass) throws Exception {
        String body = mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"" + user + "\",\"password\":\"" + pass + "\"}"))
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.data.token");
    }

    // ══ V101 预置角色种子 ══

    @Test
    void adminRoleHoldsEveryPermission() {
        // **这条防的是一类会静默烂掉的东西**:将来往 Perm.ALL 加第 15 个权限点,
        // 却忘了同步 V101 的 admin 种子 —— 系统管理员会安静地做不了那件新事,没有任何报错。
        assertThat(permsOf("admin"))
            .as("系统管理员必须持有 Perm.ALL 的全部权限点;新增权限点时记得补种子迁移")
            .containsExactlyInAnyOrderElementsOf(Perm.ALL);
    }

    /**
     * 第 18 个权限点 review:approve(SIDEBAR-UX-REDESIGN §7.3)。四处齐了才算加完:
     * 常量 / ALL(决定角色屏矩阵行序) / META(矩阵渲染读的是它 —— 只加 ALL 永远勾不上) /
     * NOT_ELEVATABLE。少任一处这条就红。
     */
    @Test
    void perm18_reviewApprove_isRegisteredEverywhere() {
        assertThat(Perm.ALL).hasSize(18).contains(Perm.REVIEW_APPROVE);
        assertThat(Perm.META.stream().map(Perm.Meta::key)).contains(Perm.REVIEW_APPROVE);
        assertThat(Perm.elevatable(Perm.REVIEW_APPROVE))
            .as("审核不是能当场借的权限(§7.3):借得到就等于录入方能请主管借一次权把自己录的东西审掉")
            .isFalse();
        // 没有断言的常量就是没有护栏。423 与 409 分开是 R1 的一条明确裁定,钉住它。
        assertThat(com.park.demo3.common.ResultCode.LOCKED.code).isEqualTo(423);
        assertThat(com.park.demo3.common.ResultCode.CONFLICT.code).isEqualTo(409);
    }

    /** reviewer 是第 7 个预置角色:只审不录 —— 只有 review:approve,一个 :edit 都没有(D16)。 */
    @Test
    void reviewerRoleIsSeeded_withReviewApproveOnly() {
        assertThat(permsOf("reviewer")).containsExactly(Perm.REVIEW_APPROVE);
    }

    @Test
    void presetRolesMatchSpec() {
        // 钉住 RBAC-SPEC §3 的角色矩阵。改这里之前先改规范,别让代码和文档对不上。
        assertThat(permsOf("finance_manager"))
            .as("财务主管 = 除 system 外的业务全部 + 授权接管 + 可请求提权")
            .containsExactlyInAnyOrder(
                Perm.MASTER_EDIT, Perm.CONTRACT_EDIT, Perm.PARAM_POLICY_EDIT, Perm.PARAM_MONTHLY_EDIT,
                Perm.METER_MASTER_EDIT, Perm.METER_READING_EDIT, Perm.BILLING_RUN_EDIT,
                Perm.BILLING_ISSUE_EDIT, Perm.ENTRY_EDIT, Perm.REPORT_EDIT, Perm.LOCK_TAKEOVER,
                Perm.ELEVATE_REQUEST);

        assertThat(permsOf("finance_clerk"))
            .as("财务专员 = 抄读数/台账附表录入/出账运行/报表。"
              + "⚠ V104 起**不含 param-monthly**:月度电价决定每一户的账单,收归主管级,"
              + "专员每月请主管当场授权一次(ELEVATION-SPEC 让这条从'不可行'变成'可行')")
            .containsExactlyInAnyOrder(
                Perm.METER_READING_EDIT, Perm.BILLING_RUN_EDIT,
                Perm.ENTRY_EDIT, Perm.REPORT_EDIT, Perm.ELEVATE_REQUEST);
        assertThat(permsOf("finance_clerk"))
            .as("电价与计费口径都必须在专员手上之外 —— 这两项一起构成'账单数字'那道门")
            .doesNotContain(Perm.PARAM_MONTHLY_EDIT, Perm.PARAM_POLICY_EDIT);

        // ── 三个只读角色不再完全相同(2026-08-22 用户拍板,ELEVATION-SPEC §1) ──
        // 总经理是做业务的人,遇到要改的东西可以请主管当场授权;
        // 只读账号与园区股东**连问都不能问** —— 他们连编辑模式按钮都不该看见。
        assertThat(permsOf("gm"))
            .as("总经理:零写权限,但可请求提权")
            .containsExactly(Perm.ELEVATE_REQUEST);
        for (String code : List.of("shareholder", "viewer")) {
            assertThat(permsOf(code))
                .as("%s 必须**一个权限都没有** —— 有 elevate:request 就等于给了他们编辑模式入口", code)
                .isEmpty();
        }
        assertThat(roles.selectOne(Wrappers.<AuthRole>lambdaQuery().eq(AuthRole::getCode, "shareholder"))
                .getNavLayers()).as("园区股东只看经营分析层").isEqualTo("analysis");
    }

    @Test
    void loginRespCarriesRole() throws Exception {
        mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"viewer\",\"password\":\"viewer123\"}"))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.code").value(0))
           .andExpect(jsonPath("$.data.role").value("viewer"))
           .andExpect(jsonPath("$.data.displayName").value("只读账号"));
        mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
           .andExpect(jsonPath("$.data.role").value("admin"));
    }

    @Test
    void viewerCanRead() throws Exception {
        String t = login("viewer", "viewer123");
        mvc.perform(get("/api/tenants").header("Authorization", "Bearer " + t))
           .andExpect(status().isOk())
           .andExpect(jsonPath("$.code").value(0));
    }

    @Test
    void viewerWriteForbiddenWithEnvelope() throws Exception {
        String t = login("viewer", "viewer123");
        // 角色门在控制器/校验之前:非 GET 一律 HTTP 403 + code 403 信封,不触达业务层(零数据污染)
        mvc.perform(post("/api/tenants").header("Authorization", "Bearer " + t)
                .contentType("application/json").content("{}"))
           .andExpect(status().isForbidden())
           .andExpect(jsonPath("$.code").value(403))
           .andExpect(jsonPath("$.message").value("无操作权限：当前账号没有修改这项数据的权限（可查看，如需修改请联系管理员开通）"));
        mvc.perform(delete("/api/tenants/999999").header("Authorization", "Bearer " + t))
           .andExpect(status().isForbidden())
           .andExpect(jsonPath("$.code").value(403));
    }

    @Test
    void adminWritePassesRoleGate() throws Exception {
        String t = login("admin", "admin123");
        // 空体过角色门抵达 @Valid 校验层返 400(≠403 即证明 admin 通过写门),不产生数据
        mvc.perform(post("/api/tenants").header("Authorization", "Bearer " + t)
                .contentType("application/json").content("{}"))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value(400));
    }

    @Test
    void legacyTokenResolvesToCurrentPermissions() throws Exception {
        // V32 的做法是「无 role claim 的老令牌降级成 viewer」—— 那是因为**角色当时住在令牌里**,
        // 一份半年前签发的令牌可能带着早已作废的角色。
        //
        // V101 起权限一律服务端现查(UserPermissionCache),令牌只带用户名、不带任何授权信息,
        // 「陈旧 claim」这回事就不存在了。所以老令牌解析成该账号的**当前**权限才是对的:
        // 拿着老令牌的 admin 就是 admin,不需要重登录一次去"恢复"。
        //
        // 空体过写门后抵达 @Valid 返 400(≠403 即证明通过了写门),不产生数据。
        String legacy = jwt.generate("admin", null);
        mvc.perform(get("/api/tenants").header("Authorization", "Bearer " + legacy))
           .andExpect(status().isOk());
        mvc.perform(post("/api/tenants").header("Authorization", "Bearer " + legacy)
                .contentType("application/json").content("{}"))
           .andExpect(status().isBadRequest())
           .andExpect(jsonPath("$.code").value(400));
    }

    @Test
    void unknownUserTokenIsRejected() throws Exception {
        // 缓存里查不到 = 账号不存在或已停用 → 保持匿名 → 401。
        // 这是 V101 换来的能力:**停用一个人,他手上的有效令牌下一个请求就失效**,
        // 不必等 120 分钟过期(权限烤进令牌的话就只能等)。
        String ghost = jwt.generate("no-such-user", "admin");
        mvc.perform(get("/api/tenants").header("Authorization", "Bearer " + ghost))
           .andExpect(status().isUnauthorized())
           .andExpect(jsonPath("$.code").value(401));
    }
}

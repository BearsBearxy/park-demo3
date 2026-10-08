package com.park.demo3.security;
import com.jayway.jsonpath.JsonPath;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.park.demo3.AbstractMysqlIT;
import com.park.demo3.entity.AuthRole;
import com.park.demo3.entity.AuthRolePerm;
import com.park.demo3.mapper.AuthRoleMapper;
import com.park.demo3.mapper.AuthRolePermMapper;
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

    /** 预置角色勾的、新代码认得的权限点:V140 只增不删,旧键行还在库里,新代码一律当不存在(RBAC-SPEC §15.8)。 */
    private Set<String> permsOf(String roleCode) {
        AuthRole r = roles.selectOne(Wrappers.<AuthRole>lambdaQuery().eq(AuthRole::getCode, roleCode));
        assertThat(r).as("预置角色 %s 不存在(种子被改坏了?)", roleCode).isNotNull();
        return rolePerms.selectList(Wrappers.<AuthRolePerm>lambdaQuery()
                .eq(AuthRolePerm::getRoleId, r.getId()))
            .stream().map(AuthRolePerm::getPerm).filter(Perm::exists).collect(Collectors.toSet());
    }

    private String login(String user, String pass) throws Exception {
        String body = mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"" + user + "\",\"password\":\"" + pass + "\"}"))
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.data.token");
    }

    // ══ 预置角色种子(v4,V140 迁移后) ══

    @Test
    void adminRoleHoldsEveryPermission() {
        // **这条防的是一类会静默烂掉的东西**:将来往 Perm.ALL 加一项,却忘了同步 admin 的种子迁移 ——
        // 系统管理员会安静地做不了那件新事,没有任何报错。
        assertThat(permsOf("admin"))
            .as("系统管理员必须持有 Perm.ALL 的全部 107 项;新增权限点时记得补种子迁移")
            .containsExactlyInAnyOrderElementsOf(Perm.ALL).hasSize(107);
    }

    /**
     * review:approve(SIDEBAR-UX-REDESIGN §7.3)。四处齐了才算加完:常量 / ALL / META / 不可提权。少任一处这条就红。
     */
    @Test
    void perm18_reviewApprove_isRegisteredEverywhere() {
        assertThat(Perm.ALL).hasSize(107).contains(Perm.REVIEW_APPROVE);
        assertThat(Perm.META.stream().map(Perm.Meta::key)).contains(Perm.REVIEW_APPROVE);
        assertThat(Perm.elevatable(Perm.REVIEW_APPROVE))
            .as("审核不是能当场借的权限(§7.3):借得到就等于录入方能请主管借一次权把自己录的东西审掉")
            .isFalse();
        // 没有断言的常量就是没有护栏。423 与 409 分开是 R1 的一条明确裁定,钉住它。
        assertThat(com.park.demo3.common.ResultCode.LOCKED.code).isEqualTo(423);
        assertThat(com.park.demo3.common.ResultCode.CONFLICT.code).isEqualTo(409);
    }

    /** RBAC-SPEC §15.4:七个预置角色迁移后的屏级权限与 v3 逐格相等(那张表逐格写在 PresetRolesV4)。 */
    @Test
    void presetRolesMatchSpec() {
        PresetRolesV4.EXPECTED.forEach((code, want) ->
            assertThat(permsOf(code)).as(code).containsExactlyInAnyOrderElementsOf(want));
        assertThat(permsOf("finance_clerk"))
            .as("专员看不到工资也录不了工资;电价与计费口径都在专员手上之外 —— 这两项一起构成「账单数字」那道门")
            .doesNotContain("salary:view", Perm.SALARY_EDIT, Perm.PARAMS_MONTHLY, Perm.PARAMS_EDIT);
        assertThat(permsOf("viewer")).as("只读账号连问都不能问").doesNotContain(Perm.ELEVATE_REQUEST);
        assertThat(permsOf("reviewer")).as("只审不录:一个写权都没有").noneMatch(Perm::isWrite);
        assertThat(roles.selectOne(Wrappers.<AuthRole>lambdaQuery().eq(AuthRole::getCode, "shareholder"))
                .getNavLayers()).as("园区股东看经营分析与报表两层(V134)").isEqualTo("analysis,reports");
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
           .andExpect(jsonPath("$.message").value("无修改权限：需要「租户管理 · 编辑」，请联系系统管理员在角色里勾上"));
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
    void legacyTokenWithoutSessionClaimsIsRejected() throws Exception {
        // 这条的判据 2026-09-12 反了。
        //
        // 原来它叫 legacyTokenResolvesToCurrentPermissions,断言「没有 role claim 的老令牌照样能用」——
        // 那在 V101 的前提下是对的:令牌只带用户名,授权全部现查,所以令牌新旧无关紧要。
        //
        // V125 给令牌加了 tv（令牌版本）与 sid（会话 id）两个 claim,而它们不是授权,
        // 是「这张是不是还活着」的凭据。没有这两个 claim 就无法回答这个问题,
        // 而「答不上来就放行」等于把改密码立刻生效这件事开一个永久的后门:
        // 任何人拿一张升级前签的令牌就能绕过。所以一律拒。
        //
        // 代价写在这里:**升级当天所有人要重新登录一次**。一次性的。
        String legacy = jwt.generate("admin", null, -1, null);
        mvc.perform(get("/api/tenants").header("Authorization", "Bearer " + legacy))
           .andExpect(status().isUnauthorized())
           .andExpect(jsonPath("$.code").value(401));
    }

    @Test
    void unknownUserTokenIsRejected() throws Exception {
        // 缓存里查不到 = 账号不存在或已停用 → 保持匿名 → 401。
        // 这是 V101 换来的能力:**停用一个人,他手上的有效令牌下一个请求就失效**,
        // 不必等 120 分钟过期(权限烤进令牌的话就只能等)。
        String ghost = jwt.generate("no-such-user", "admin", 0, "whatever");
        mvc.perform(get("/api/tenants").header("Authorization", "Bearer " + ghost))
           .andExpect(status().isUnauthorized())
           .andExpect(jsonPath("$.code").value(401));
    }
}

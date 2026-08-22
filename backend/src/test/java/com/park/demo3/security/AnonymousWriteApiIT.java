package com.park.demo3.security;

import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * **没带令牌就不许写。**
 *
 * 听起来是废话,但 2026-08-22 实测发现三个 `ANY_AUTHENTICATED` 端点对**匿名**是敞开的:
 * 不带任何 Authorization 头 `DELETE /api/auth/elevate` → HTTP 200,
 * `POST /api/import-log` → 200 且库里落一行 `operator='anonymousUser'`。
 *
 * 根因见 {@link WriteAccessManager#trustResolver} 的注释:Spring 默认装了
 * AnonymousAuthenticationFilter,而 `AnonymousAuthenticationToken.isAuthenticated()` **恒为 true** ——
 * 手写的那句 `if (!auth.isAuthenticated()) 拒绝` 一个请求都挡不住。
 *
 * ⚠ **这个洞能活下来,是因为当时 688 个测试里没有一条断言过「匿名会被挡」。**
 *   把那行守卫整个删掉,全绿。所以这个文件的存在本身比它的断言更重要。
 */
@AutoConfigureMockMvc
class AnonymousWriteApiIT extends AbstractMysqlIT {
    @Autowired MockMvc mvc;
    @Autowired PermissionRegistry registry;

    @Test
    void anyAuthenticatedEndpointsStillRejectAnonymous() throws Exception {
        // 自动枚举,不手抄 —— 手抄的那份加第四条时必忘,而那正是这个洞能存活的原因
        List<String> endpoints = registry.anyAuthenticatedEndpoints();
        assertThat(endpoints).as("ANY_AUTHENTICATED 名单不该是空的,否则本用例是空跑").isNotEmpty();

        for (String ep : endpoints) {
            String[] parts = ep.split(" ", 2);
            // ANY = 没限定方法的规则,拿 POST 探它
            HttpMethod m = "ANY".equals(parts[0]) ? HttpMethod.POST : HttpMethod.valueOf(parts[0]);
            String path = parts[1].replace("**", "probe").replace("*", "probe");

            MockHttpServletRequestBuilder rb = MockMvcRequestBuilders.request(m, path)
                .contentType("application/json").content("{}");
            mvc.perform(rb)
               .andExpect(status().isUnauthorized());     // 不带令牌 → 401,不是 200
        }
    }

    @Test
    void importLogIsNotAnOpenWriteEndpoint() throws Exception {
        // 单拎出来:这是三条里**唯一会真落库**的一条。放行等于任何人都能往
        // 导入中心概览 / 操作日志时间线的数据源里灌行。
        mvc.perform(post("/api/import-log").contentType("application/json")
                .content("{\"dataType\":\"salary\",\"typeLabel\":\"探针\",\"fileName\":\"anon.xlsx\","
                       + "\"rows\":1,\"ok\":1,\"warn\":0,\"status\":\"complete\"}"))
           .andExpect(status().isUnauthorized());
    }

    @Test
    void gettersAlreadyRejectedAnonymousAndStillDo() throws Exception {
        // 对照组:GET 走 .authenticated(),Spring 自己用 TrustResolver 排除了匿名 ——
        // 它一直是对的。两边现在口径一致了。
        mvc.perform(get("/api/tenants")).andExpect(status().isUnauthorized());
    }

    @Test
    void unmappedWritePathsAreStillDeniedByDefault() throws Exception {
        // 默认拒绝那条铁律不能因为这次改动松掉
        mvc.perform(post("/api/definitely-not-a-real-endpoint").contentType("application/json").content("{}"))
           .andExpect(status().isUnauthorized());
    }
}

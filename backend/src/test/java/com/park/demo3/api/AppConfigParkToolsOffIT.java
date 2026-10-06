package com.park.demo3.api;

import com.jayway.jsonpath.JsonPath;
import com.park.demo3.AbstractMysqlIT;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// 客户园区的部署(gen-env.sh 写的那两行):模拟填充三条接口拒绝,配置照实回给前端(2026-10-05 用户拍板「按你建议修改」)。
// 单独一个 Spring 上下文(属性不同);@Transactional 回滚,万一闸漏了写进 2099 的也不落共享容器。
// 破坏验证:任一控制器删掉 deploy.requireParkTools() → 对应那条 simulate 回 code 0 红;
//          DeployConfig 的 @Value 键名写错(如 app.park-tool.enabled)→ 落回默认 true,parkTools 那格与三条 simulate 一起红。
@AutoConfigureMockMvc
@Transactional
@TestPropertySource(properties = {"app.park-tools.enabled=false", "app.release-baseline=0.29.0"})
class AppConfigParkToolsOffIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;

    private String admin() throws Exception {
        String body = mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return "Bearer " + JsonPath.read(body, "$.data.token");
    }

    @Test
    void configReportsCustomerDeployment() throws Exception {
        mvc.perform(get("/api/app/config").header("Authorization", admin()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.parkTools").value(false))
                .andExpect(jsonPath("$.data.releaseBaseline").value("0.29.0"));
    }

    @Test
    void threeSimulatesAreRejected() throws Exception {
        String admin = admin();
        // 管理员有这三条的写权限 —— 拒绝来自部署开关,不是权限门
        for (String p : new String[]{"/api/pv-meter/simulate", "/api/elec-cost/simulate", "/api/cp-meter/simulate"}) {
            mvc.perform(post(p).param("year", "2099").header("Authorization", admin))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.code").value(404))
                    .andExpect(jsonPath("$.message").value("这套系统没有模拟填充"));
        }
    }

    @Test
    void missingHintDoesNotPointAtSimulate() throws Exception {
        // 电费成本总览「派生指标」的缺源提示(也进导出 Excel):客户园区没有那个按钮,提示里不许再说「可模拟填充」
        String body = mvc.perform(get("/api/elec-cost/metrics").param("year", "2094").param("month", "5")
                .header("Authorization", admin()))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        java.util.List<String> missing = JsonPath.read(body, "$.data[*].missing[*]");
        org.assertj.core.api.Assertions.assertThat(missing).contains("总表电费支出未录", "光伏上网收益未录",
                "总表基本电费未录", "运营性电表费用未录").noneMatch(s -> s.contains("模拟填充"));
    }
}

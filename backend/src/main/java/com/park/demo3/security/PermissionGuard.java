package com.park.demo3.security;

import com.park.demo3.common.BizException;
import com.park.demo3.common.ResultCode;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;

import java.util.List;

/**
 * **业务层**的权限判定(含提权)。
 *
 * 绝大多数写端点在 {@link WriteAccessManager} 那一道就判完了,业务代码无感。
 * 这个类只给「URL 判不了、必须看请求体才知道要哪个权限」的少数几处用 ——
 * 目前只有一处:PUT /api/params 按 cfg_key 分月度录入 / 计费口径两档。
 *
 * ⚠ 这一处曾经**只写在注释里没有实现**(2026-08-22 发现):PermissionRegistry 给 PUT /api/params
 *   登记的是「policy 或 monthly 任一」,而 ParamService 里没有细分判定 ——
 *   于是只有 param-monthly:edit 的财务专员,绕开前端直接调 API 就能改任何一个计费口径键。
 *   前端把按钮藏了,后端的门是开的。加新的「URL 判不了」的规则时,实现和注释必须一起落地。
 */
@Component
public class PermissionGuard {

    private final ElevationStore elevations;

    public PermissionGuard(ElevationStore elevations) { this.elevations = elevations; }

    /** 角色给的,或主管当场授权的。 */
    public boolean has(String perm) {
        Authentication a = SecurityContextHolder.getContext().getAuthentication();
        if (a == null || !a.isAuthenticated()) return false;
        for (GrantedAuthority g : a.getAuthorities()) if (perm.equals(g.getAuthority())) return true;

        ElevationStore.Grant grant = elevations.find(a.getName(), List.of(perm));
        if (grant == null) return false;
        // 与 WriteAccessManager 同款:记下授权人,本次请求的审计自动带上他
        RequestAttributes ra = RequestContextHolder.getRequestAttributes();
        if (ra != null) {
            ra.setAttribute(ElevationStore.REQ_ATTR_AUTHORIZER, grant.authorizer(), RequestAttributes.SCOPE_REQUEST);
        }
        return true;
    }

    /** 没有就 403。what 是给人看的东西名,如「计费口径」。 */
    public void require(String perm, String what) {
        if (has(perm)) return;
        throw new BizException(ResultCode.FORBIDDEN,
            "没有修改「" + what + "」的权限。可以查看,如需修改请点编辑模式旁的授权按钮,请主管当场授权。");
    }
}

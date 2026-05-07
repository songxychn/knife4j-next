/*
 * Copyright © 2017-2023 Knife4j(xiaoymin@foxmail.com)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


package com.github.xiaoymin.knife4j.spring.gateway.endpoint;

import com.github.xiaoymin.knife4j.spring.gateway.Knife4jGatewayProperties;
import com.github.xiaoymin.knife4j.spring.gateway.discover.ServiceDiscoverHandler;
import com.github.xiaoymin.knife4j.spring.gateway.enums.GatewayStrategy;
import com.github.xiaoymin.knife4j.spring.gateway.spec.v2.OpenAPI2Resource;
import com.github.xiaoymin.knife4j.spring.gateway.spec.v3.OpenAPI3Response;
import com.github.xiaoymin.knife4j.spring.gateway.utils.PathUtils;
import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.ApplicationContext;
import org.springframework.http.ResponseEntity;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.util.CollectionUtils;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

import java.util.*;

/**
 * @author <a href="milo.xiaomeng@gmail.com">milo.xiaomeng@gmail.com</a>
 *     23/02/26 20:43
 * @since gateway-spring-boot-starter v4.1.0
 */
@Slf4j
@AllArgsConstructor
@RestController
@ConditionalOnProperty(name = "knife4j.gateway.enabled", havingValue = "true")
public class OpenAPIEndpoint {

    final Knife4jGatewayProperties knife4jGatewayProperties;
    final ApplicationContext applicationContext;
    /**
     * OpenAPI Group Endpoint
     * @param request request
     * @return group element
     */
    @GetMapping("/v3/api-docs/swagger-config")
    public Mono<ResponseEntity<OpenAPI3Response>> swaggerConfig(ServerHttpRequest request) {
        OpenAPI3Response response = new OpenAPI3Response();
        final String basePath = PathUtils.getDefaultContextPath(request);
        log.debug("base-path:{}", basePath);
        response.setConfigUrl(PathUtils.append(basePath, "/v3/api-docs/swagger-config"));
        response.setOauth2RedirectUrl(this.knife4jGatewayProperties.getDiscover().getOas3().getOauth2RedirectUrl());
        response.setValidatorUrl(this.knife4jGatewayProperties.getDiscover().getOas3().getValidatorUrl());
        // 设置排序规则,add at 2023/07/02 11:30:00
        response.setTagsSorter(this.knife4jGatewayProperties.getTagsSorter().name());
        response.setOperationsSorter(this.knife4jGatewayProperties.getOperationsSorter().name());
        // 注入 knife4j.gateway.setting 配置，修复 upstream#710：网关模式下 knife4j.setting 配置不生效
        response.setSetting(this.knife4jGatewayProperties.getSetting());
        log.debug("forward-path:{}", basePath);
        // 判断当前模式是手动还是服务发现
        if (knife4jGatewayProperties.getStrategy() == GatewayStrategy.MANUAL) {
            log.debug("manual strategy.");
            List<Object> sortedSet = new LinkedList<>();
            List<Knife4jGatewayProperties.Router> routers = resolveRouters(request);
            if (routers != null && !routers.isEmpty()) {
                routers.sort(Comparator.comparing(Knife4jGatewayProperties.Router::getOrder));
                for (Knife4jGatewayProperties.Router router : routers) {
                    // copy one,https://gitee.com/xiaoym/knife4j/issues/I73AOG
                    // 在nginx代理情况下，刷新文档会叠加是由于直接使用了Router对象进行Set操作，导致每次刷新都从内存拿属性值对象产生了叠加的bug
                    // 此处每次调用时直接copy新对象进行赋值返回，避免和开发者在Config配置时对象属性冲突
                    OpenAPI2Resource copyRouter = new OpenAPI2Resource(router);
                    copyRouter.setUrl(PathUtils.append(basePath, copyRouter.getUrl()));
                    // 得到contextPath后再处理一次
                    copyRouter.setContextPath(PathUtils.processContextPath(PathUtils.append(basePath, copyRouter.getContextPath())));
                    log.debug("api-resources:{}", copyRouter);
                    sortedSet.add(copyRouter);
                }
                response.setUrls(sortedSet);
            }
        } else {
            log.debug("discover strategy.");
            ServiceDiscoverHandler serviceDiscoverHandler = applicationContext.getBean(ServiceDiscoverHandler.class);
            response.setUrls(serviceDiscoverHandler.getResources(basePath));
        }
        return Mono.just(ResponseEntity.ok().body(response));
    }

    /**
     * 根据请求 Host 选择路由列表。
     * <ol>
     *   <li>若 {@code routesByHost} 不为空，且当前请求的 Host（忽略端口）命中某个 key，则返回该 key 对应的路由列表。</li>
     *   <li>否则回退到全局 {@code routes}。</li>
     * </ol>
     * @param request 当前请求
     * @return 选中的路由列表（不会为 null）
     * @since 4.5.0
     */
    private List<Knife4jGatewayProperties.Router> resolveRouters(ServerHttpRequest request) {
        Map<String, List<Knife4jGatewayProperties.Router>> routesByHost = knife4jGatewayProperties.getRoutesByHost();
        if (!CollectionUtils.isEmpty(routesByHost)) {
            String host = extractHost(request);
            log.debug("routes-by-host lookup, request host:{}", host);
            if (StringUtils.hasLength(host) && routesByHost.containsKey(host)) {
                List<Knife4jGatewayProperties.Router> hostRoutes = routesByHost.get(host);
                log.debug("routes-by-host matched key:{}, routes-count:{}", host, hostRoutes == null ? 0 : hostRoutes.size());
                return hostRoutes;
            }
        }
        return knife4jGatewayProperties.getRoutes();
    }

    /**
     * 从请求中提取 Host（去除端口号部分）。
     * @param request 当前请求
     * @return host 字符串，如 "api.internal.com"；若无法获取则返回空字符串
     */
    private String extractHost(ServerHttpRequest request) {
        String hostHeader = request.getHeaders().getFirst("Host");
        if (StringUtils.hasLength(hostHeader)) {
            // 去除端口号，例如 "api.internal.com:8080" -> "api.internal.com"
            int colonIdx = hostHeader.lastIndexOf(':');
            if (colonIdx > 0) {
                return hostHeader.substring(0, colonIdx);
            }
            return hostHeader;
        }
        // fallback：从 URI 中获取
        if (request.getURI() != null && StringUtils.hasLength(request.getURI().getHost())) {
            return request.getURI().getHost();
        }
        return "";
    }
}

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


package com.github.xiaoymin.knife4j.aggre.core.filter;

import cn.hutool.core.util.StrUtil;
import com.github.xiaoymin.knife4j.aggre.core.RouteDispatcher;
import com.github.xiaoymin.knife4j.aggre.core.pojo.SwaggerRoute;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.servlet.*;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.PrintWriter;

/***
 *
 * @since  2.0.8
 * @author <a href="mailto:xiaoymin@foxmail.com">xiaoymin@foxmail.com</a>
 * 2020/10/29 20:06
 */
public class Knife4jRouteProxyFilter implements Filter {

    private final RouteDispatcher routeDispatcher;
    private final Gson gson = new GsonBuilder().create();

    Logger logger = LoggerFactory.getLogger(Knife4jRouteProxyFilter.class);

    public Knife4jRouteProxyFilter(RouteDispatcher routeDispatcher) {
        this.routeDispatcher = routeDispatcher;
    }

    @Override
    public void init(FilterConfig filterConfig) throws ServletException {

    }

    @Override
    public void doFilter(ServletRequest servletRequest, ServletResponse servletResponse, FilterChain filterChain) throws IOException, ServletException {
        HttpServletRequest request = (HttpServletRequest) servletRequest;
        HttpServletResponse response = (HttpServletResponse) servletResponse;
        String uri = request.getRequestURI();
        if (routeDispatcher.checkRoute(request.getHeader(RouteDispatcher.ROUTE_PROXY_HEADER_NAME))) {
            if (StrUtil.endWith(uri, RouteDispatcher.OPENAPI_GROUP_INSTANCE_ENDPOINT)) {
                handleSwaggerInstance(request, response);
                // 响应当前服务disk-实例
            } else {
                if (logger.isDebugEnabled()) {
                    logger.debug("Current Request URI:{},Proxy Request", uri);
                }
                routeDispatcher.execute(request, response);
            }
        } else {
            // go on
            if (StrUtil.endWith(uri, RouteDispatcher.OPENAPI_GROUP_ENDPOINT)) {
                // 响应当前服务聚合结构
                writeRouteResponse(response, gson.toJson(routeDispatcher.getRoutes()));
            } else if (StrUtil.endWith(uri, RouteDispatcher.OPENAPI_GROUP_INSTANCE_ENDPOINT)) {
                // 响应当前服务disk-实例
                handleSwaggerInstance(request, response);
            } else {
                filterChain.doFilter(servletRequest, servletResponse);
            }
        }
    }

    /**
     * 处理 {@code /swagger-instance?group=<pkId>} 端点。
     * <p>
     * - disk 模式：路由内已经持有 OpenAPI 文档内容，直接回写；<br>
     * - cloud/eureka/nacos/polaris 远程模式：路由没有缓存内容，
     *   通过 {@link RouteDispatcher#executeSwaggerInstance} 把请求转发到远程实例拉取。
     */
    private void handleSwaggerInstance(HttpServletRequest request, HttpServletResponse response) throws IOException {
        String group = request.getParameter("group");
        SwaggerRoute swaggerRoute = routeDispatcher.getRoute(group);
        if (swaggerRoute == null) {
            writeRouteResponse(response, "");
            return;
        }
        if (StrUtil.isNotBlank(swaggerRoute.getContent())) {
            // disk 模式：直接返回 content
            writeRouteResponse(response, swaggerRoute.getContent());
            return;
        }
        if (StrUtil.isNotBlank(swaggerRoute.getUri()) && StrUtil.isNotBlank(swaggerRoute.getOriginalLocation())) {
            // cloud/eureka/nacos/polaris 远程模式：通过 RouteDispatcher 代理远程请求
            routeDispatcher.executeSwaggerInstance(request, response, swaggerRoute);
            return;
        }
        writeRouteResponse(response, "");
    }

    /**
     * 响应服务端的内容
     * @param response 响应流
     * @param content 内容
     * @throws IOException 异常
     */
    protected void writeRouteResponse(HttpServletResponse response, String content) throws IOException {
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");
        PrintWriter printWriter = response.getWriter();
        printWriter.write(content);
        printWriter.close();
    }
    @Override
    public void destroy() {

    }

}

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


package com.github.xiaoymin.knife4j.aggre.spring.configuration;

import com.github.xiaoymin.knife4j.aggre.core.RouteCache;
import com.github.xiaoymin.knife4j.aggre.core.RouteDispatcher;
import com.github.xiaoymin.knife4j.aggre.core.RouteRepository;
import com.github.xiaoymin.knife4j.aggre.core.common.ExecutorEnum;
import com.github.xiaoymin.knife4j.aggre.core.pojo.SwaggerRoute;

final class RouteDispatcherFactory {

    private RouteDispatcherFactory() {
    }

    static RouteDispatcher create(RouteRepository routeRepository, RouteCache<String, SwaggerRoute> routeCache,
                                  String contextPath, Knife4jAggregationProperties properties) {
        return new RouteDispatcher(routeRepository, routeCache, ExecutorEnum.APACHE, contextPath,
                properties.getOpenAPIV3(), properties.getProviderTimeoutMs());
    }
}

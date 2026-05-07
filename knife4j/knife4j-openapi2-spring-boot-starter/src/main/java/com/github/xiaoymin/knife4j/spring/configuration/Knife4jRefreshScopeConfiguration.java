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

package com.github.xiaoymin.knife4j.spring.configuration;

import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.cloud.context.config.annotation.RefreshScope;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

/**
 * When Spring Cloud Context is on the classpath (e.g. Nacos, Spring Cloud Config),
 * register {@link Knife4jProperties} with {@code @RefreshScope} so that changes
 * pushed via the config server are reflected in the OpenAPI info without a restart.
 * <p>
 * The {@code @Primary} annotation ensures this bean takes precedence over the
 * {@code @Component}-registered bean in {@link Knife4jProperties}.
 *
 * @since 4.5.0
 * @author <a href="mailto:xiaoymin@foxmail.com">xiaoymin@foxmail.com</a>
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnClass(RefreshScope.class)
@EnableConfigurationProperties
public class Knife4jRefreshScopeConfiguration {

    @Bean
    @Primary
    @RefreshScope
    public Knife4jProperties knife4jProperties() {
        return new Knife4jProperties();
    }
}

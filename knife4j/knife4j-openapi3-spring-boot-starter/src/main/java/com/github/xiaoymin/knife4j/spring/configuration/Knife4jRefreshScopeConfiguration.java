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
 * When spring-cloud-context is on the classpath (e.g. Apollo, Nacos, Spring Cloud Config),
 * register {@link Knife4jProperties} as a {@code @RefreshScope} bean so that configuration
 * changes pushed by the config center take effect without restarting the application.
 *
 * <p>The {@code @Primary} annotation ensures this bean wins over the {@code @Component}
 * singleton declared on {@link Knife4jProperties} itself.
 *
 * @since 4.5.0
 * @see <a href="https://github.com/songxychn/knife4j-next/issues/317">issue #317</a>
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnClass(RefreshScope.class)
@EnableConfigurationProperties(Knife4jProperties.class)
public class Knife4jRefreshScopeConfiguration {

    @Bean
    @Primary
    @RefreshScope
    public Knife4jProperties knife4jPropertiesRefresh() {
        return new Knife4jProperties();
    }
}

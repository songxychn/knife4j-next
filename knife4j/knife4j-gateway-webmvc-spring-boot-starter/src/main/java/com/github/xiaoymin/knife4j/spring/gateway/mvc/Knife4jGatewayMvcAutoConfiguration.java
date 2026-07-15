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


package com.github.xiaoymin.knife4j.spring.gateway.mvc;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.AutoConfigureAfter;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.cloud.client.discovery.DiscoveryClient;
import org.springframework.cloud.gateway.server.mvc.config.GatewayMvcProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.core.env.Environment;
import org.springframework.web.servlet.DispatcherServlet;

@Configuration(proxyBeanMethods = false)
@AutoConfigureAfter(name = "org.springframework.cloud.gateway.server.mvc.GatewayServerMvcAutoConfiguration")
@EnableConfigurationProperties(Knife4jGatewayMvcProperties.class)
@ConditionalOnClass({DispatcherServlet.class, GatewayMvcProperties.class})
@ConditionalOnProperty(name = "knife4j.gateway.enabled", havingValue = "true")
public class Knife4jGatewayMvcAutoConfiguration {

    @Bean
    public MvcSwaggerConfigController mvcSwaggerConfigController(Knife4jGatewayMvcProperties properties,
                                                                 ObjectProvider<MvcGatewayDiscoveryService> discoveryService) {
        return new MvcSwaggerConfigController(properties, discoveryService);
    }

    @Bean
    @ConditionalOnProperty(name = "knife4j.gateway.strategy", havingValue = "DISCOVER")
    public MvcGatewayDiscoveryService mvcGatewayDiscoveryService(ObjectProvider<DiscoveryClient> discoveryClient,
                                                                 GatewayMvcProperties gatewayProperties,
                                                                 Knife4jGatewayMvcProperties knife4jProperties,
                                                                 Environment environment) {
        return new MvcGatewayDiscoveryService(discoveryClient.getIfAvailable(), gatewayProperties, knife4jProperties,
                environment);
    }

    @Bean
    @ConditionalOnProperty(name = "knife4j.gateway.basic.enable", havingValue = "true")
    public FilterRegistrationBean<MvcBasicAuthFilter> mvcBasicAuthFilter(Knife4jGatewayMvcProperties properties) {
        FilterRegistrationBean<MvcBasicAuthFilter> registration = new FilterRegistrationBean<>();
        registration.setFilter(new MvcBasicAuthFilter(properties.getBasic()));
        registration.addUrlPatterns("/*");
        registration.setOrder(Ordered.HIGHEST_PRECEDENCE);
        return registration;
    }
}

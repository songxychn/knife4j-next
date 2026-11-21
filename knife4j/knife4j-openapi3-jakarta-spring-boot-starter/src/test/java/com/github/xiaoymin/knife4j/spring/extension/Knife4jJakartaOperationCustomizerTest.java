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


package com.github.xiaoymin.knife4j.spring.extension;

import com.github.xiaoymin.knife4j.spring.configuration.Knife4jAutoConfiguration;
import com.github.xiaoymin.knife4j.spring.configuration.Knife4jProperties;
import io.swagger.v3.oas.models.Operation;
import org.junit.Assert;
import org.junit.Test;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;
import org.springframework.web.method.HandlerMethod;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Collections;

public class Knife4jJakartaOperationCustomizerTest {

    static class SampleController {

        public String findUser() {
            return "ok";
        }
    }

    @Test
    public void blankOperationIdFallsBackToMethodName() throws Exception {
        Knife4jJakartaOperationCustomizer customizer = new Knife4jJakartaOperationCustomizer();
        HandlerMethod handlerMethod = new HandlerMethod(new SampleController(), SampleController.class.getMethod("findUser"));

        Operation nullIdOp = new Operation();
        customizer.customize(nullIdOp, handlerMethod);
        Assert.assertEquals("SampleController_findUser", nullIdOp.getOperationId());

        Operation blankIdOp = new Operation().operationId("   ");
        customizer.customize(blankIdOp, handlerMethod);
        Assert.assertEquals("SampleController_findUser", blankIdOp.getOperationId());
    }

    @Test
    public void explicitOperationIdIsPreservedWithClassPrefix() throws Exception {
        Knife4jJakartaOperationCustomizer customizer = new Knife4jJakartaOperationCustomizer();
        HandlerMethod handlerMethod = new HandlerMethod(new SampleController(), SampleController.class.getMethod("findUser"));

        Operation customOp = new Operation().operationId("customFindUser");
        customizer.customize(customOp, handlerMethod);
        Assert.assertEquals("SampleController_customFindUser", customOp.getOperationId());
    }

    @Test
    public void corsFilterAllowsCredentialsWithOriginPattern() throws Exception {
        Knife4jAutoConfiguration configuration = new Knife4jAutoConfiguration(new Knife4jProperties(), new StandardEnvironment());
        CorsFilter corsFilter = configuration.corsFilter();

        Field sourceField = CorsFilter.class.getDeclaredField("configSource");
        sourceField.setAccessible(true);
        UrlBasedCorsConfigurationSource source = (UrlBasedCorsConfigurationSource) sourceField.get(corsFilter);
        CorsConfiguration corsConfiguration = source.getCorsConfigurations().get("/**");

        Assert.assertNotNull(corsConfiguration);
        Assert.assertEquals(Boolean.TRUE, corsConfiguration.getAllowCredentials());
        Assert.assertNull(corsConfiguration.getAllowedOrigins());
        Assert.assertEquals(Collections.singletonList("*"), corsConfiguration.getAllowedOriginPatterns());
        corsConfiguration.validateAllowCredentials();
    }

    @Test
    public void kotlinIsPrefixCustomizerIsGatedOnJackson3() throws Exception {
        Method beanMethod = Knife4jAutoConfiguration.class.getMethod(
                "knife4jKotlinIsPrefixOpenApiCustomizer",
                org.springframework.beans.factory.ObjectProvider.class);
        ConditionalOnClass condition = beanMethod.getAnnotation(ConditionalOnClass.class);
        Assert.assertNotNull(condition);
        Assert.assertArrayEquals(new String[]{"tools.jackson.databind.ObjectMapper"}, condition.name());
    }
}

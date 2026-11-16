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

import com.github.xiaoymin.knife4j.aggre.spring.condiotion.PolarisSettingCondition;
import com.github.xiaoymin.knife4j.aggre.spring.support.NacosSetting;
import com.github.xiaoymin.knife4j.aggre.spring.support.PolarisSetting;
import java.lang.reflect.Proxy;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Properties;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.config.YamlPropertiesFactoryBean;
import org.springframework.boot.context.properties.bind.Bindable;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.bind.BindHandler;
import org.springframework.boot.context.properties.bind.handler.NoUnboundElementsBindHandler;
import org.springframework.boot.context.properties.source.ConfigurationPropertySources;
import org.springframework.boot.context.properties.source.MapConfigurationPropertySource;
import org.springframework.context.annotation.ConditionContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.io.FileSystemResource;

class DocumentationConfigurationTest {

    private Map<String, Object> example(String name) {
        Path root = Paths.get("").toAbsolutePath();
        while (root != null && !Files.isDirectory(root.resolve("docs/snippets/config"))) {
            root = root.getParent();
        }
        Assertions.assertNotNull(root, "Cannot locate documentation snippets");
        YamlPropertiesFactoryBean loader = new YamlPropertiesFactoryBean();
        loader.setResources(new FileSystemResource(root.resolve("docs/snippets/config/" + name + ".yml").toFile()));
        Properties properties = loader.getObject();
        Assertions.assertNotNull(properties);
        Map<String, Object> values = new LinkedHashMap<>();
        properties.forEach((key, value) -> values.put(key.toString(), value));
        return values;
    }

    @Test
    void documentedNacosAndConnectionPropertiesBindToTheActualClasses() {
        NacosSetting nacos = new Binder(new MapConfigurationPropertySource(example("nacos")))
                .bind("knife4j.nacos", Bindable.of(NacosSetting.class), new NoUnboundElementsBindHandler(BindHandler.DEFAULT)).get();
        Assertions.assertEquals("", nacos.getRoutes().get(0).getNamespaceId());
        Assertions.assertEquals("user-service", nacos.getRoutes().get(0).getServiceName());
        HttpConnectionSetting connection = new Binder(new MapConfigurationPropertySource(example("connection")))
                .bind("knife4j.connection-setting", Bindable.of(HttpConnectionSetting.class), new NoUnboundElementsBindHandler(BindHandler.DEFAULT)).get();
        Assertions.assertEquals(60000, connection.getSocketTimeout());
        Assertions.assertEquals(10000, connection.getConnectTimeout());
        Assertions.assertEquals(200, connection.getMaxConnectionTotal());
        Assertions.assertEquals(20, connection.getMaxPreRoute());
    }

    @Test
    void documentedPolarisPropertiesPassBothBindingAndTheActualStartupCondition() {
        Map<String, Object> values = example("polaris");
        PolarisSetting settings = new Binder(new MapConfigurationPropertySource(values))
                .bind("knife4j.polaris", Bindable.of(PolarisSetting.class), new NoUnboundElementsBindHandler(BindHandler.DEFAULT)).get();
        Assertions.assertEquals("http://polaris-server:8080", settings.getServiceUrl());
        Assertions.assertEquals("user-service", settings.getRoutes().get(0).getService());
        Assertions.assertEquals("default", settings.getRoutes().get(0).getNamespace());
        values.put("POLARIS_USERNAME", "documentation-test-only");
        values.put("POLARIS_PASSWORD", "documentation-test-only");
        StandardEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().addFirst(new MapPropertySource("documented-example", values));
        ConfigurationPropertySources.attach(environment);
        ConditionContext context = (ConditionContext) Proxy.newProxyInstance(
                ConditionContext.class.getClassLoader(), new Class[]{ConditionContext.class},
                (proxy, method, args) -> method.getName().equals("getEnvironment") ? environment : null);
        Assertions.assertTrue(new PolarisSettingCondition().matches(context, null));
    }
}

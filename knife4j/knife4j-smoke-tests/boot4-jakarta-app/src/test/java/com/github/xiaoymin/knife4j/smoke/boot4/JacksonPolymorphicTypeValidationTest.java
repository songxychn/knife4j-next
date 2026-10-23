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


package com.github.xiaoymin.knife4j.smoke.boot4;

import org.junit.Assert;
import org.junit.Test;

import java.util.Map;

/** Regression for CVE-2026-110879: approving Map must not approve arbitrary key classes. */
public class JacksonPolymorphicTypeValidationTest {

    private static final String SAFE_MAP = "[\"java.util.HashMap<java.lang.String,java.lang.String>\",{\"key\":\"value\"}]";
    private static final String UNAPPROVED_KEY = "[\"java.util.HashMap<" + UnapprovedKey.class.getName()
            + ",java.lang.String>\",{\"key\":\"value\"}]";

    @Test
    public void jackson2MustValidateGenericTypeArguments() throws Exception {
        com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
        mapper.activateDefaultTyping(com.fasterxml.jackson.databind.jsontype.BasicPolymorphicTypeValidator.builder()
                .allowIfBaseType(Map.class).build(), com.fasterxml.jackson.databind.ObjectMapper.DefaultTyping.NON_FINAL);

        Assert.assertEquals(Map.of("key", "value"), mapper.readValue(SAFE_MAP, Map.class));
        Assert.assertThrows(com.fasterxml.jackson.databind.exc.InvalidTypeIdException.class,
                () -> mapper.readValue(UNAPPROVED_KEY, Map.class));
    }

    @Test
    public void jackson3MustValidateGenericTypeArguments() {
        tools.jackson.databind.json.JsonMapper mapper = tools.jackson.databind.json.JsonMapper.builder()
                .activateDefaultTyping(tools.jackson.databind.jsontype.BasicPolymorphicTypeValidator.builder()
                        .allowIfBaseType(Map.class).build(), tools.jackson.databind.DefaultTyping.NON_FINAL)
                .build();

        Assert.assertEquals(Map.of("key", "value"), mapper.readValue(SAFE_MAP, Map.class));
        Assert.assertThrows(tools.jackson.databind.exc.InvalidTypeIdException.class,
                () -> mapper.readValue(UNAPPROVED_KEY, Map.class));
    }

    // A harmless String constructor reproduces the bypass without files, processes or network access.
    public static class UnapprovedKey {

        public UnapprovedKey(String value) {
        }
    }
}

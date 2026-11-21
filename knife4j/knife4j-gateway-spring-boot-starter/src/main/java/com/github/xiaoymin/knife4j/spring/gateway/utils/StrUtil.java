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


package com.github.xiaoymin.knife4j.spring.gateway.utils;

/**
 * @deprecated Use {@link com.github.xiaoymin.knife4j.core.util.StrUtil} instead.
 */
@Deprecated
public class StrUtil {

    public static boolean isBlankChar(int c) {
        return com.github.xiaoymin.knife4j.core.util.StrUtil.isBlankChar(c);
    }

    public static boolean isBlank(CharSequence str) {
        return com.github.xiaoymin.knife4j.core.util.StrUtil.isBlank(str);
    }

    public static boolean isNotBlank(CharSequence str) {
        return com.github.xiaoymin.knife4j.core.util.StrUtil.isNotBlank(str);
    }

    public static String defaultTo(String value, String defaultStr) {
        return com.github.xiaoymin.knife4j.core.util.StrUtil.defaultTo(value, defaultStr);
    }
}

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


package com.github.xiaoymin.knife4j.aggre.core.common;

import com.github.xiaoymin.knife4j.core.util.StrUtil;

public final class TextUtils {

    private TextUtils() {
    }

    public static boolean isBlank(CharSequence value) {
        if (value == null || value.length() == 0) {
            return true;
        }
        for (int i = 0; i < value.length(); i++) {
            if (!isBlankChar(value.charAt(i))) {
                return false;
            }
        }
        return true;
    }

    public static boolean isNotBlank(CharSequence value) {
        return !isBlank(value);
    }

    private static boolean isBlankChar(int value) {
        return StrUtil.isBlankChar(value) || value == '\0' || value == '\u3164' || value == '\u2800' || value == '\u180e';
    }
}

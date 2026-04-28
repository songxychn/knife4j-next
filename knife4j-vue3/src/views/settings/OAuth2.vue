<template>
  <a-row style="margin: 30px auto; width: 98%;">
    <a-card title="OAuth2">
      <p>{{ $t('auth.oauth2RedirectText') || 'OAuth2 Redirect Page' }}</p>
      <a-row v-if="tokenInfo.accessToken" style="margin-top:15px;">
        <a-col :span="4">Token Type</a-col>
        <a-col :span="18">
          <a-input read-only :value="tokenInfo.tokenType" />
        </a-col>
      </a-row>
      <a-row v-if="tokenInfo.accessToken" style="margin-top:15px;">
        <a-col :span="4">Access Token</a-col>
        <a-col :span="18">
          <a-input read-only :value="tokenInfo.accessToken" />
        </a-col>
      </a-row>
      <a-row v-if="!tokenInfo.accessToken && !tokenInfo.code" style="margin-top:15px;">
        <a-alert type="info" message="No OAuth2 token or authorization code found in URL." showIcon />
      </a-row>
      <a-row v-if="tokenInfo.code" style="margin-top:15px;">
        <a-col :span="4">Code</a-col>
        <a-col :span="18">
          <a-input read-only :value="tokenInfo.code" />
        </a-col>
      </a-row>
    </a-card>
  </a-row>
</template>
<script>
import KUtils from "@/core/utils";

export default {
  name: "OAuth2",
  data() {
    return {
      tokenInfo: {
        accessToken: null,
        tokenType: null,
        code: null
      }
    };
  },
  mounted() {
    this.parseOAuth2Callback();
  },
  methods: {
    parseOAuth2Callback() {
      var href = window.location.href;
      // Try to parse access_token from hash (implicit flow)
      var accessToken = this.getUrlParam(href, "access_token", "");
      var tokenType = this.getUrlParam(href, "token_type", "Bearer");
      // Try to parse code from query (authorization code flow)
      var code = this.getUrlParam(href, "code", "");

      if (KUtils.strNotBlank(accessToken)) {
        this.tokenInfo.accessToken = tokenType + " " + accessToken;
        this.tokenInfo.tokenType = tokenType;
      }
      if (KUtils.strNotBlank(code)) {
        this.tokenInfo.code = code;
      }
    },
    getUrlParam(url, key, defaultValue) {
      var reg = new RegExp(".*?" + key + "=(.*?)(&.*)?$", "ig");
      var val = defaultValue;
      if (reg.test(url)) {
        val = RegExp.$1;
      }
      return val;
    }
  }
};
</script>
<style scoped>
</style>

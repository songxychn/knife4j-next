<template>
  <a-sub-menu :key="menuInfo.key">
    <template #title>
      <mail-outlined /><span>{{ menuInfo.name }}</span>
    </template>
    <template v-for="item in menuInfo.children">
      <a-menu-item v-if="!item.children" :key="item.key">
        <pie-chart-outlined />
        <span>{{ item.name }}</span>
      </a-menu-item>
      <sub-menu v-else :key="item.key" :menu-info="item" />
    </template>
  </a-sub-menu>
</template>
<script>
import { MailOutlined, PieChartOutlined } from '@ant-design/icons-vue'
export default {
  props: ["menuInfo"],
  components: {
    MailOutlined,
    PieChartOutlined
  }
};
</script>

<template>
  <el-card class="log-panel" shadow="never">
    <template #header><div class="log-header"><span>Startup log</span><span class="log-dots"><i></i><i></i><i></i></span></div></template>
    <pre ref="logRef">{{ text }}</pre>
  </el-card>
</template>

<script setup>
import { nextTick, watch, ref } from "vue";

const props = defineProps({ text: { type: String, default: "" } });
const logRef = ref(null);

watch(() => props.text, () => {
  nextTick(() => { if (logRef.value) logRef.value.scrollTop = logRef.value.scrollHeight; });
});
</script>

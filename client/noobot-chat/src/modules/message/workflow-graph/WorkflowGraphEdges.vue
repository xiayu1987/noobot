<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, nextTick, onMounted, ref, watch } from "vue";

const props = defineProps({
  width: { type: Number, default: 0 },
  height: { type: Number, default: 0 },
  segments: { type: Array, default: () => [] },
});

const canvasRef = ref(null);

const canvasStyle = computed(() => ({
  width: `${Math.max(0, Number(props.width || 0))}px`,
  height: `${Math.max(0, Number(props.height || 0))}px`,
}));

function draw() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const width = Math.max(1, Number(props.width || 0));
  const height = Math.max(1, Number(props.height || 0));
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, width, height);
  const segments = Array.isArray(props.segments) ? props.segments : [];
  if (!segments.length) return;
  context.save();
  context.lineWidth = 2;
  for (const segment of segments) {
    const fromX = Number(segment?.fromX || 0);
    const fromY = Number(segment?.fromY || 0);
    const toX = Number(segment?.toX || 0);
    const toY = Number(segment?.toY || 0);
    const highlighted = segment?.highlighted === true;
    const midY = fromY + (toY - fromY) * 0.45;
    context.strokeStyle = highlighted
      ? "rgba(109, 74, 255, 0.9)"
      : "rgba(109, 74, 255, 0.38)";
    context.beginPath();
    context.moveTo(fromX, fromY);
    context.bezierCurveTo(fromX, midY, toX, midY, toX, toY - 4);
    context.stroke();

    context.beginPath();
    context.moveTo(toX, toY - 4);
    context.lineTo(toX - 5, toY - 11);
    context.lineTo(toX + 5, toY - 11);
    context.closePath();
    context.fillStyle = highlighted
      ? "rgba(109, 74, 255, 0.95)"
      : "rgba(109, 74, 255, 0.62)";
    context.fill();
  }
  context.restore();
}

onMounted(async () => {
  await nextTick();
  draw();
});

watch(
  () =>
    `${Number(props.width || 0)}|${Number(props.height || 0)}|${(Array.isArray(props.segments) ? props.segments.length : 0)}`,
  async () => {
    await nextTick();
    draw();
  },
);

watch(
  () => JSON.stringify(Array.isArray(props.segments) ? props.segments : []),
  async () => {
    await nextTick();
    draw();
  },
);
</script>

<template>
  <canvas ref="canvasRef" class="workflow-canvas" :style="canvasStyle" />
</template>

<style scoped>
.workflow-canvas {
  display: block;
}
</style>

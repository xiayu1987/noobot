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
  const canvasStyles = getComputedStyle(canvas);
  const edgeColor = canvasStyles.getPropertyValue("--workflow-edge-color").trim();
  const edgeHighlightedColor = canvasStyles
    .getPropertyValue("--workflow-edge-highlighted-color")
    .trim();
  const arrowColor = canvasStyles.getPropertyValue("--workflow-arrow-color").trim();
  const arrowHighlightedColor = canvasStyles
    .getPropertyValue("--workflow-arrow-highlighted-color")
    .trim();
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
    const busXRaw = Number(segment?.busX);
    const hasBusX = Number.isFinite(busXRaw);
    const dx = toX - fromX;
    const dy = toY - fromY;
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    context.strokeStyle = highlighted ? edgeHighlightedColor : edgeColor;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(fromX, fromY);
    if (hasBusX) {
      const busX = busXRaw;
      context.lineTo(busX, fromY);
      context.lineTo(busX, toY);
      context.lineTo(toX, toY);
    } else if (horizontal) {
      const midX = fromX + dx * 0.5;
      context.bezierCurveTo(midX, fromY, midX, toY, toX, toY);
    } else {
      const midY = fromY + dy * 0.45;
      context.bezierCurveTo(fromX, midY, toX, midY, toX, toY);
    }
    context.stroke();

    const angle = hasBusX ? Math.atan2(0, toX - busXRaw) : Math.atan2(dy, dx);
    const arrowLength = 8;
    const arrowWidth = 5;
    const tipX = toX;
    const tipY = toY;
    const leftX = tipX - arrowLength * Math.cos(angle) + arrowWidth * Math.sin(angle);
    const leftY = tipY - arrowLength * Math.sin(angle) - arrowWidth * Math.cos(angle);
    const rightX = tipX - arrowLength * Math.cos(angle) - arrowWidth * Math.sin(angle);
    const rightY = tipY - arrowLength * Math.sin(angle) + arrowWidth * Math.cos(angle);
    context.beginPath();
    context.moveTo(tipX, tipY);
    context.lineTo(leftX, leftY);
    context.lineTo(rightX, rightY);
    context.closePath();
    context.fillStyle = highlighted ? arrowHighlightedColor : arrowColor;
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
    `${Number(props.width || 0)}|${Number(props.height || 0)}|${Array.isArray(props.segments) ? props.segments.length : 0}`,
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
  --workflow-edge-color: rgba(var(--workflow-accent-rgb), 0.38);
  --workflow-edge-highlighted-color: rgba(var(--workflow-accent-rgb), 0.9);
  --workflow-arrow-color: rgba(var(--workflow-accent-rgb), 0.62);
  --workflow-arrow-highlighted-color: rgba(var(--workflow-accent-rgb), 0.95);
  display: block;
}
</style>

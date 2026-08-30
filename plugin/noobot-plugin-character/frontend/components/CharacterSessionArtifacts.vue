<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import CharacterAnimationCard from "./CharacterAnimationCard.vue";
import { animationRuntimeState } from "../runtime/animationState.js";

defineProps({ sessionId: { type: String, default: "" } });
</script>

<template>
  <section
    v-if="animationRuntimeState.sessionId === sessionId && animationRuntimeState.cards.length"
    class="character-session-artifacts"
  >
    <CharacterAnimationCard
      v-for="card in animationRuntimeState.cards"
      :key="card.animationId"
      :card="card"
    />
  </section>
</template>

<style scoped>
.character-session-artifacts {
  display: grid;
  gap: var(--noobot-space-sm);
}
</style>

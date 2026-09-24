<template>
  <div class="toast-layer">
    <TransitionGroup name="toast">
      <div v-for="item in scene.toasts" :key="item.id" class="toast" :class="'toast--' + item.type">
        {{ item.message }}
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup>
import { useSceneStore } from '@/stores/scene.js'

const scene = useSceneStore()
</script>

<style scoped>
.toast-layer {
  position: absolute;
  top: 70px;
  left: 50%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transform: translateX(-50%);
  pointer-events: none;
}

.toast {
  padding: 7px 16px;
  border: 1px solid var(--c-border);
  border-radius: 3px;
  background: rgba(11, 24, 38, 0.92);
  color: var(--c-text);
  font-size: 13px;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.4);
}

.toast--warn {
  border-color: rgba(255, 209, 102, 0.6);
  color: #ffd166;
}

.toast--error {
  border-color: rgba(255, 77, 109, 0.6);
  color: #ff8095;
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>

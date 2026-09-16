import './styles.css';
import type { ActionName } from './action-controller';

export const EXPRESSION_NAMES = [
  'Neutral',
  'Smile',
  'Happy',
  'Shy',
  'Angry',
  'Sad',
  'Surprised',
  'Sleepy',
  'Cry',
  'Wink_L',
  'Wink_R',
  'HappyCat',
] as const;

export type ExpressionName = (typeof EXPRESSION_NAMES)[number];
export type OutfitValue = 0 | 1 | 2;

export interface UICallbacks {
  expression(name: string): void;
  action(name: ActionName): void;
  greet(): void;
  pause(paused: boolean): void;
  zoom(value: number): void;
  follow(enabled: boolean): void;
  move(enabled: boolean): void;
  outfit(value: OutfitValue): void;
  center(): void;
  reset(): void;
  retry(): void;
}

export interface UIHandle {
  setLoading(detail: string): void;
  setReady(): void;
  setError(message: string): void;
}

type BackgroundName = 'night' | 'snow' | 'rose';

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const getReducedMotionPreference = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

const setPressed = (element: HTMLElement, pressed: boolean): void => {
  element.setAttribute('aria-pressed', String(pressed));
  element.classList.toggle('is-selected', pressed);
};

export function setupUI(callbacks: UICallbacks): UIHandle {
  const root = document.querySelector<HTMLElement>('[data-showcase]');
  if (!root) throw new Error('Showcase root is missing');

  const pauseButton = document.querySelector<HTMLButtonElement>('#pause-toggle');
  const pauseLabel = pauseButton?.querySelector<HTMLElement>('[data-pause-label]');
  const settingsToggle = document.querySelector<HTMLButtonElement>('#settings-toggle');
  const settingsPanel = document.querySelector<HTMLElement>('#settings-panel');
  const settingsClose = document.querySelector<HTMLButtonElement>('#settings-close');
  const followButton = document.querySelector<HTMLButtonElement>('#follow-toggle');
  const moveButton = document.querySelector<HTMLButtonElement>('#move-toggle');
  const moveLabel = moveButton?.querySelector<HTMLElement>('[data-move-label]');
  const centerButton = document.querySelector<HTMLButtonElement>('#center-button');
  const greetButton = document.querySelector<HTMLButtonElement>('#greet-button');
  const interactionHint = document.querySelector<HTMLElement>('#interaction-hint');
  const interactionMessage = document.querySelector<HTMLElement>('#interaction-message');
  const resetButton = document.querySelector<HTMLButtonElement>('#reset-button');
  const retryButton = document.querySelector<HTMLButtonElement>('#retry-button');
  const status = document.querySelector<HTMLElement>('#model-status');
  const statusLabel = status?.querySelector<HTMLElement>('[data-status-label]');
  const statusDetail = document.querySelector<HTMLElement>('#loading-text');
  const modelFallback = document.querySelector<HTMLElement>('#model-fallback');
  const expressionIndex = document.querySelector<HTMLElement>('#expression-index');
  const zoomRange = document.querySelector<HTMLInputElement>('#zoom-range');
  const zoomOutput = document.querySelector<HTMLOutputElement>('#zoom-output');

  const expressionButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[data-expression]'),
  );
  const actionButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('button[data-hikari-action]'),
  );
  const backgroundButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[data-background]'),
  );
  const zoomButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-zoom]'));
  const outfitButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-outfit]'));
  const controls = Array.from(
    document.querySelectorAll<HTMLButtonElement | HTMLInputElement>('[data-ui-control]'),
  );

  const reducedMotion = getReducedMotionPreference();
  let isLoading = true;
  let isPaused = reducedMotion;
  let isFollowing = !reducedMotion;
  let isMoving = false;
  let activeExpression: ExpressionName = 'Neutral';
  let activeBackground: BackgroundName = 'night';
  let activeZoom = 1;
  let activeOutfit: OutfitValue = 0;
  let settingsWasOpen = false;
  let interactionTimer: number | undefined;
  let lastInteractionAt = Number.NEGATIVE_INFINITY;
  let supportedActions = new Set<ActionName>();
  const actionMessages: Record<'curiosity' | 'shy' | 'smug', string> = {
    curiosity: '好奇地看看你～',
    shy: '别、别一直看啦……',
    smug: '哼哼，被我发现啦。',
  };
  const isVisibleAction = (value: string): value is 'curiosity' | 'shy' | 'smug' =>
    value === 'curiosity' || value === 'shy' || value === 'smug';

  const updateInteractionHint = (): void => {
    if (!interactionHint) return;
    if (isMoving) {
      interactionHint.textContent = '移动模式：拖动平移，滚轮或双指缩放；方向键微调，Home 回中。';
    } else if (isFollowing) {
      interactionHint.textContent = '移动鼠标与她对视，点击角色互动；开启移动后可拖动角色。';
    } else {
      interactionHint.textContent = '点击角色试试互动；开启全页鼠标跟随后，她会随鼠标轻轻转向。';
    }
  };

  const updateActionAvailability = (): void => {
    actionButtons.forEach((button) => {
      const action = button.dataset.hikariAction;
      const supported = !!action && supportedActions.has(action as ActionName);
      button.disabled = isLoading || !supported;
      button.dataset.supported = String(supported);
    });
  };

  const updatePauseButton = (): void => {
    if (!pauseButton) return;
    pauseButton.setAttribute('aria-pressed', String(isPaused));
    pauseButton.setAttribute('aria-label', isPaused ? '继续播放动态' : '暂停动态');
    pauseButton.classList.toggle('is-selected', isPaused);
    if (pauseLabel) pauseLabel.textContent = isPaused ? '继续播放' : '暂停动态';
    pauseButton.dataset.paused = String(isPaused);
  };

  const updateFollowButton = (): void => {
    if (!followButton) return;
    setPressed(followButton, isFollowing);
    followButton.setAttribute('aria-label', isFollowing ? '关闭全页鼠标跟随' : '开启全页鼠标跟随');
    followButton.dataset.enabled = String(isFollowing);
    updateInteractionHint();
  };

  const updateMoveButton = (): void => {
    if (moveButton) {
      setPressed(moveButton, isMoving);
      moveButton.setAttribute('aria-label', isMoving ? '关闭移动模式' : '开启移动模式');
      moveButton.dataset.enabled = String(isMoving);
    }
    if (moveLabel) moveLabel.textContent = isMoving ? '退出移动' : '移动角色';
    updateInteractionHint();
  };

  const updateZoom = (nextZoom: number, notify = true): void => {
    activeZoom = clamp(Number.isFinite(nextZoom) ? nextZoom : 1, 0.85, 1.6);
    if (zoomRange) zoomRange.value = activeZoom.toFixed(2);
    if (zoomOutput) zoomOutput.value = `${Math.round(activeZoom * 100)}%`;
    if (zoomOutput) zoomOutput.textContent = `${Math.round(activeZoom * 100)}%`;
    zoomButtons.forEach((button) => {
      const preset = Number(button.dataset.zoom);
      setPressed(button, Math.abs(preset - activeZoom) < 0.026);
    });
    root.style.setProperty('--model-zoom', String(activeZoom));
    if (notify) callbacks.zoom(activeZoom);
  };

  const parseOutfit = (value: string | undefined): OutfitValue | null => {
    if (value === '0') return 0;
    if (value === '1') return 1;
    if (value === '2') return 2;
    return null;
  };

  const updateOutfit = (value: OutfitValue, notify = true): void => {
    activeOutfit = value;
    outfitButtons.forEach((button) => {
      const selected = parseOutfit(button.dataset.outfit) === activeOutfit;
      setPressed(button, selected);
      button.dataset.active = String(selected);
    });
    if (notify) callbacks.outfit(activeOutfit);
  };

  const updateExpression = (name: string, notify = true): void => {
    if (!EXPRESSION_NAMES.includes(name as ExpressionName)) return;
    activeExpression = name as ExpressionName;
    expressionButtons.forEach((button) => {
      const selected = button.dataset.expression === activeExpression;
      setPressed(button, selected);
      button.dataset.active = String(selected);
    });
    const selectedButton = expressionButtons.find(
      (button) => button.dataset.expression === activeExpression,
    );
    if (expressionIndex && selectedButton) {
      const index = expressionButtons.indexOf(selectedButton) + 1;
      expressionIndex.textContent = String(index).padStart(2, '0');
      const list = selectedButton.parentElement;
      if (list && list.scrollWidth > list.clientWidth) {
        const itemRect = selectedButton.getBoundingClientRect();
        const listRect = list.getBoundingClientRect();
        const delta = itemRect.left < listRect.left ? itemRect.left - listRect.left
          : itemRect.right > listRect.right ? itemRect.right - listRect.right : 0;
        if (delta) list.scrollBy({left:delta,behavior:'auto'});
      }
    }
    if (notify) callbacks.expression(activeExpression);
  };

  const updateBackground = (background: string): void => {
    if (!['night', 'snow', 'rose'].includes(background)) return;
    activeBackground = background as BackgroundName;
    root.dataset.background = activeBackground;
    backgroundButtons.forEach((button) => {
      setPressed(button, button.dataset.background === activeBackground);
    });
  };

  const clearInteractionMessage = (resetRateLimit = true): void => {
    if (interactionTimer !== undefined) {
      window.clearTimeout(interactionTimer);
      interactionTimer = undefined;
    }
    if (interactionMessage) {
      interactionMessage.hidden = true;
      interactionMessage.textContent = '';
    }
    if (resetRateLimit) lastInteractionAt = Number.NEGATIVE_INFINITY;
  };

  const announceInteraction = (message: string): boolean => {
    if (isLoading || root.dataset.state !== 'ready' || !interactionMessage) return false;
    const now = Date.now();
    if (now - lastInteractionAt < 600) return false;
    lastInteractionAt = now;
    if (interactionTimer !== undefined) window.clearTimeout(interactionTimer);
    interactionMessage.textContent = message;
    interactionMessage.hidden = false;
    interactionTimer = window.setTimeout(() => {
      interactionMessage.hidden = true;
      interactionMessage.textContent = '';
      interactionTimer = undefined;
    }, 4000);
    return true;
  };

  const choose = <T,>(items: readonly T[]): T =>
    items[Math.floor(Math.random() * items.length)] ?? items[0];

  const tapReactions: Record<'head' | 'body', { expressions: ExpressionName[]; messages: string[] }> = {
    head: {
      expressions: ['Smile', 'Shy', 'Wink_L', 'Wink_R'],
      messages: ['摸摸头收到啦，欸嘿～', '再轻一点嘛，耳朵会痒。', '我有在认真看着你哦。'],
    },
    body: {
      expressions: ['Happy', 'HappyCat', 'Surprised', 'Smile'],
      messages: ['收到你的招呼啦～', '我在这里，今天也请多关照。', '要一起换个心情吗？'],
    },
  };

  const onHikariTap = (event: Event): void => {
    if (isLoading) return;
    const area = (event as CustomEvent<{ area?: string }>).detail?.area;
    if (area !== 'head' && area !== 'body') return;
    const reaction = tapReactions[area];
    if (!announceInteraction(choose(reaction.messages))) return;
    updateExpression(choose(reaction.expressions));
    callbacks.greet();
  };

  const onHikariZoom = (event: Event): void => {
    if (root.dataset.state !== 'ready') return;
    const zoom = (event as CustomEvent<{ zoom?: number }>).detail?.zoom;
    if (typeof zoom === 'number' && Number.isFinite(zoom)) updateZoom(zoom, false);
  };

  const setControlsDisabled = (disabled: boolean, keepRetryEnabled = false): void => {
    controls.forEach((control) => {
      control.disabled = disabled && !(keepRetryEnabled && control === retryButton);
    });
    updateActionAvailability();
  };

  const closeSettings = (restoreFocus = true): void => {
    if (!settingsPanel || !settingsToggle) return;
    settingsWasOpen = false;
    settingsPanel.hidden = true;
    settingsPanel.setAttribute('aria-hidden', 'true');
    settingsToggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) settingsToggle.focus();
  };

  const openSettings = (): void => {
    if (!settingsPanel || !settingsToggle || isLoading) return;
    settingsWasOpen = true;
    settingsPanel.hidden = false;
    settingsPanel.setAttribute('aria-hidden', 'false');
    settingsToggle.setAttribute('aria-expanded', 'true');
    settingsClose?.focus();
  };

  pauseButton?.addEventListener('click', () => {
    if (isLoading) return;
    isPaused = !isPaused;
    updatePauseButton();
    callbacks.pause(isPaused);
  });

  settingsToggle?.addEventListener('click', () => {
    if (settingsWasOpen) closeSettings();
    else openSettings();
  });

  settingsClose?.addEventListener('click', () => closeSettings());

  expressionButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (isLoading) return;
      updateExpression(button.dataset.expression ?? 'Neutral');
    });
  });

  actionButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (isLoading || button.disabled) return;
      const value = button.dataset.hikariAction;
      if (!value || !isVisibleAction(value) || !supportedActions.has(value)) return;
      callbacks.action(value);
      announceInteraction(actionMessages[value]);
    });
  });

  backgroundButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (isLoading) return;
      updateBackground(button.dataset.background ?? 'night');
    });
  });

  zoomButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (isLoading) return;
      updateZoom(Number(button.dataset.zoom));
    });
  });

  zoomRange?.addEventListener('input', () => {
    if (isLoading) return;
    updateZoom(Number(zoomRange.value));
  });

  outfitButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (isLoading) return;
      const value = parseOutfit(button.dataset.outfit);
      if (value === null) return;
      updateOutfit(value);
    });
  });

  followButton?.addEventListener('click', () => {
    if (isLoading) return;
    isFollowing = !isFollowing;
    updateFollowButton();
    callbacks.follow(isFollowing);
  });

  moveButton?.addEventListener('click', () => {
    if (isLoading) return;
    isMoving = !isMoving;
    updateMoveButton();
    callbacks.move(isMoving);
    announceInteraction(isMoving ? '移动模式已开启，可以拖动角色。' : '移动模式已关闭，页面可以正常滚动。');
  });

  centerButton?.addEventListener('click', () => {
    if (isLoading) return;
    callbacks.center();
    announceInteraction('角色已回到中心。');
  });

  greetButton?.addEventListener('click', () => {
    if (isLoading || !announceInteraction('嗨～今天也一起发光吧。')) return;
    updateExpression('Smile');
    callbacks.greet();
  });

  resetButton?.addEventListener('click', () => {
    if (isLoading) return;
    activeExpression = 'Neutral';
    isPaused = reducedMotion;
    isFollowing = !reducedMotion;
    isMoving = false;
    updateOutfit(0, false);
    updateExpression(activeExpression, false);
    updatePauseButton();
    updateFollowButton();
    updateMoveButton();
    updateBackground('night');
    updateZoom(1, false);
    clearInteractionMessage();
    callbacks.reset();
    callbacks.pause(isPaused);
    callbacks.follow(isFollowing);
    callbacks.move(false);
    closeSettings();
  });

  retryButton?.addEventListener('click', () => {
    if (isLoading) return;
    handle.setLoading('正在重新加载角色资源…');
    callbacks.retry();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && settingsWasOpen) {
      event.preventDefault();
      closeSettings();
    }
  });

  root.addEventListener('hikari:tap', onHikariTap);
  root.addEventListener('hikari:zoom', onHikariZoom);
  document.addEventListener('hikari:actions-supported', (event: Event) => {
    const actions = (event as CustomEvent<{ actions?: unknown }>).detail?.actions;
    supportedActions = new Set(
      Array.isArray(actions)
        ? actions.filter((value): value is ActionName => typeof value === 'string')
        : [],
    );
    updateActionAvailability();
  });

  const handle: UIHandle = {
    setLoading(detail: string): void {
      isLoading = true;
      supportedActions = new Set();
      clearInteractionMessage();
      root.dataset.state = 'loading';
      status?.setAttribute('data-status', 'loading');
      if (statusLabel) statusLabel.textContent = 'MODEL LOADING';
      if (statusDetail) statusDetail.textContent = detail;
      if (modelFallback) modelFallback.hidden = false;
      if (retryButton) retryButton.hidden = true;
      setControlsDisabled(true);
      if (settingsWasOpen) closeSettings(false);
      updateActionAvailability();
    },
    setReady(): void {
      isLoading = false;
      root.dataset.state = 'ready';
      status?.setAttribute('data-status', 'ready');
      if (statusLabel) statusLabel.textContent = 'MODEL READY';
      if (statusDetail) {
        statusDetail.textContent = reducedMotion ? '已就绪 · 减少动态已开启' : '已就绪 · 可以开始互动';
      }
      if (modelFallback) modelFallback.hidden = true;
      if (retryButton) retryButton.hidden = true;
      setControlsDisabled(false);
      updatePauseButton();
      updateFollowButton();
      updateZoom(activeZoom, false);
      updateOutfit(activeOutfit, false);
      callbacks.expression(activeExpression);
      callbacks.outfit(activeOutfit);
      updateActionAvailability();
    },
    setError(message: string): void {
      isLoading = false;
      supportedActions = new Set();
      clearInteractionMessage();
      root.dataset.state = 'error';
      status?.setAttribute('data-status', 'error');
      if (statusLabel) statusLabel.textContent = 'MODEL UNAVAILABLE';
      if (statusDetail) statusDetail.textContent = message;
      if (modelFallback) modelFallback.hidden = false;
      if (retryButton) retryButton.hidden = false;
      setControlsDisabled(true, true);
      updateActionAvailability();
    },
  };

  updateExpression(activeExpression, false);
  updateBackground(activeBackground);
  updateZoom(activeZoom, false);
  updateOutfit(activeOutfit, false);
  updatePauseButton();
  updateFollowButton();
  updateMoveButton();
  callbacks.pause(isPaused);
  callbacks.follow(isFollowing);
  callbacks.zoom(activeZoom);
  callbacks.move(false);
  callbacks.outfit(activeOutfit);

  return handle;
}

<script lang="ts">
	// Press-and-hold to reveal. Deliberately *not* a toggle: holding is the
	// friction (THREATS.md §7 rule 1 — friction is consent), and it means
	// names can never be left showing on an unattended screen. Releasing,
	// tabbing away, or backgrounding the tab all re-hide immediately.
	import { onDestroy } from 'svelte';

	let {
		revealed = $bindable(false),
		label = 'Hold to show names',
		revealedLabel = 'Showing names — release to hide',
		disabled = false
	}: {
		revealed?: boolean;
		label?: string;
		revealedLabel?: string;
		disabled?: boolean;
	} = $props();

	// Tracked so a keyup that arrives after the pointer already released
	// (or vice versa) doesn't un-hide while the other input is still held.
	let pointerHeld = $state(false);
	let keyHeld = $state(false);

	function sync() {
		revealed = !disabled && (pointerHeld || keyHeld);
	}

	function hold(e: PointerEvent) {
		if (disabled) return;
		// Capture so we still get pointerup if the finger/cursor slides off
		// the button — otherwise a drag-away leaves names stuck on screen.
		// Best-effort: a synthetic event has no live pointer id and throws.
		try {
			(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
		} catch {
			// no capture; the window-level handlers below still re-hide.
		}
		pointerHeld = true;
		sync();
	}

	function release() {
		pointerHeld = false;
		sync();
	}

	function keyDown(e: KeyboardEvent) {
		if (disabled) return;
		if (e.key !== ' ' && e.key !== 'Enter') return;
		// Space would scroll the page; Enter would fire click-then-release.
		e.preventDefault();
		if (e.repeat) return;
		keyHeld = true;
		sync();
	}

	function keyUp(e: KeyboardEvent) {
		if (e.key !== ' ' && e.key !== 'Enter') return;
		keyHeld = false;
		sync();
	}

	function hideAll() {
		pointerHeld = false;
		keyHeld = false;
		sync();
	}

	// Losing focus, switching tabs, or minimising must all re-hide: those are
	// exactly the moments someone else may end up looking at the screen.
	$effect(() => {
		if (disabled) hideAll();
	});

	if (typeof window !== 'undefined') {
		window.addEventListener('blur', hideAll);
		document.addEventListener('visibilitychange', hideAll);
		onDestroy(() => {
			window.removeEventListener('blur', hideAll);
			document.removeEventListener('visibilitychange', hideAll);
		});
	}
</script>

<button
	type="button"
	class="hold"
	class:active={revealed}
	{disabled}
	aria-pressed={revealed}
	onpointerdown={hold}
	onpointerup={release}
	onpointercancel={release}
	onlostpointercapture={release}
	onkeydown={keyDown}
	onkeyup={keyUp}
	onblur={hideAll}
	oncontextmenu={(e) => e.preventDefault()}
>
	<span aria-hidden="true">{revealed ? '👁' : '🙈'}</span>
	{revealed ? revealedLabel : label}
</button>

<style>
	.hold {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		background: transparent;
		border: 1px solid rgba(255, 255, 255, 0.15);
		color: var(--color-muted);
		padding: var(--space-2) var(--space-3);
		border-radius: 4px;
		font: inherit;
		font-size: 0.9em;
		cursor: pointer;
		/* A long-press on touch otherwise selects text or opens the
		   callout menu instead of holding the button. */
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
		touch-action: none;
	}
	.hold:hover:not(:disabled) {
		color: var(--color-fg);
		border-color: var(--color-accent);
	}
	.hold:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}
	.hold.active {
		background: rgba(255, 170, 80, 0.12);
		border-color: rgba(255, 170, 80, 0.5);
		color: #ffcc90;
	}
	.hold:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>

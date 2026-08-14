<script lang="ts">
	// Consent gate in front of PNG export.
	//
	// An exported image is the one artefact that leaves the app entirely:
	// no encryption, no revocation, no expiry (THREATS.md T2, T3). It also
	// names people who never agreed to be in it (T6). So the export is
	// gated on naming every affected person out loud and ticking an
	// explicit confirmation — the same "friction is consent" principle as
	// hold-to-reveal, applied to the higher-stakes action.
	import type { NamedMember } from '$lib/graphs/network/privacy.js';

	let {
		members,
		onconfirm,
		oncancel
	}: {
		members: NamedMember[];
		onconfirm: () => void;
		oncancel: () => void;
	} = $props();

	let confirmed = $state(false);
	const unconfirmedLinks = $derived(members.filter((m) => m.unconfirmedLink));

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') oncancel();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div
	class="backdrop"
	role="presentation"
	onclick={(e) => {
		if (e.target === e.currentTarget) oncancel();
	}}
>
	<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="export-png-title">
		<h2 id="export-png-title">Export this network as a PNG</h2>

		<p class="warn">
			The image will show <strong>everyone's real name</strong>. A PNG isn't encrypted, can't be
			un-shared, and doesn't expire — once you send it, it's out of your hands and out of theirs.
		</p>

		{#if members.length > 0}
			<p>Ask each of these people whether they're okay with being named in an image you share:</p>
			<ul class="members">
				{#each members as m (m.id)}
					<li>
						<span class="name">{m.label}</span>
						{#if m.unconfirmedLink}
							<span class="flag" title="This person hasn't confirmed the link to their account">
								link not confirmed
							</span>
						{/if}
					</li>
				{/each}
			</ul>
			{#if unconfirmedLinks.length > 0}
				<p class="warn subtle">
					{unconfirmedLinks.length === 1
						? 'One person here has'
						: `${unconfirmedLinks.length} people here have`}
					not confirmed the link to their queer-curves account. Naming them in an exported image is exactly
					what that consent step exists to prevent.
				</p>
			{/if}
		{:else}
			<p class="muted">Nobody but you is named in this network.</p>
		{/if}

		<label class="consent">
			<input type="checkbox" bind:checked={confirmed} />
			<span>
				{members.length > 0
					? 'I have asked everyone named above, and they agreed to appear in an image I may share.'
					: 'I understand this image is unencrypted and permanent once shared.'}
			</span>
		</label>

		<div class="actions">
			<button type="button" class="cancel" onclick={oncancel}>Cancel</button>
			<button type="button" class="primary" disabled={!confirmed} onclick={onconfirm}>
				Export PNG with names
			</button>
		</div>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(10, 6, 18, 0.75);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-4);
		z-index: 50;
	}
	.dialog {
		background: var(--color-bg);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 8px;
		padding: var(--space-4);
		max-width: 52ch;
		width: 100%;
		max-height: 85vh;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	h2 {
		margin: 0;
		font-size: 1.1rem;
		color: var(--color-accent);
	}
	p {
		margin: 0;
	}
	.warn {
		padding: var(--space-2) var(--space-3);
		background: rgba(255, 170, 80, 0.1);
		border: 1px solid rgba(255, 170, 80, 0.35);
		border-radius: 4px;
		color: #ffcc90;
	}
	.warn.subtle {
		background: rgba(255, 120, 120, 0.08);
		border-color: rgba(255, 120, 120, 0.3);
		color: #ffb0b0;
		font-size: 0.9em;
	}
	.muted {
		color: var(--color-muted);
	}
	.members {
		margin: 0;
		padding-left: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.name {
		color: var(--color-fg);
	}
	.flag {
		margin-left: var(--space-2);
		padding: 1px 8px;
		border-radius: 999px;
		background: rgba(255, 120, 120, 0.15);
		color: #ffb0b0;
		font-size: 0.75em;
	}
	.consent {
		display: flex;
		gap: var(--space-2);
		align-items: flex-start;
		font-size: 0.95em;
		cursor: pointer;
	}
	.consent input {
		margin-top: 0.25em;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}
	button.primary {
		background: var(--color-accent);
		color: #1a0a2a;
		border: none;
		padding: var(--space-2) var(--space-4);
		border-radius: 4px;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	button.primary:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	button.cancel {
		background: transparent;
		border: 1px solid rgba(255, 255, 255, 0.15);
		color: var(--color-muted);
		padding: var(--space-2) var(--space-3);
		border-radius: 4px;
		font: inherit;
		cursor: pointer;
	}
	button.cancel:hover {
		color: var(--color-fg);
		border-color: var(--color-accent);
	}
</style>

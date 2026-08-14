<script lang="ts">
	import {
		inviteToUserGraph,
		listUserGraphMembers,
		revokeGraphAccess,
		type GraphMember,
		type ShareGrant
	} from '$lib/store/graphs.js';
	import { matrixStore } from '$lib/matrix/store.svelte.js';

	let { graphId }: { graphId: string } = $props();

	let members = $state<GraphMember[]>([]);
	let invitee = $state('');
	// Least sharing is the default (THREATS.md §7 rule 1); history is the
	// grant you opt into.
	let grant = $state<ShareGrant>('current');
	let submitting = $state(false);
	let inviteError = $state<string | null>(null);
	let inviteSuccess = $state<string | null>(null);
	let revoking = $state<string | null>(null);
	let revokeError = $state<string | null>(null);

	const selfUserId = $derived(matrixStore.session?.userId ?? null);

	// Only Matrix-backed graphs can be shared — the dispatcher will throw
	// for localStorage ids. Surface that as a disabled state so the user
	// understands why the form is greyed out instead of just bouncing
	// errors at them on submit.
	const isShareable = $derived(
		graphId.startsWith('!') &&
			matrixStore.session !== null &&
			matrixStore.cryptoStatus?.ready === true
	);

	// Re-fetch the member list whenever sync changes (rooms-epoch covers
	// state events too) so newly-joined invitees appear without a reload.
	$effect(() => {
		void matrixStore.roomsEpoch;
		if (!isShareable) return;
		(async () => {
			try {
				members = await listUserGraphMembers(graphId);
			} catch (e) {
				console.warn('listUserGraphMembers failed', e);
			}
		})();
	});

	async function handleInvite(e: SubmitEvent) {
		e.preventDefault();
		if (submitting) return;
		inviteError = null;
		inviteSuccess = null;
		submitting = true;
		try {
			await inviteToUserGraph(graphId, invitee, grant);
			inviteSuccess =
				grant === 'current'
					? `Invited ${invitee.trim()} — they'll see the current state after they accept.`
					: `Invited ${invitee.trim()} — they'll see this graph and its full history after they accept.`;
			invitee = '';
			members = await listUserGraphMembers(graphId);
		} catch (e) {
			inviteError = e instanceof Error ? e.message : String(e);
		} finally {
			submitting = false;
		}
	}

	async function handleRevoke(userId: string) {
		if (revoking) return;
		// Distinct verb, honest caveat (THREATS.md §7 rules 4 and 13): a
		// revoke stops the future, it cannot retract the past.
		if (
			!confirm(
				`Remove ${userId} from this graph?\n\nThey'll stop seeing any future changes. Anything they've already seen stays on their device — removing them can't take that back.`
			)
		) {
			return;
		}
		revokeError = null;
		revoking = userId;
		try {
			await revokeGraphAccess(graphId, userId);
			members = await listUserGraphMembers(graphId);
		} catch (e) {
			revokeError = e instanceof Error ? e.message : String(e);
		} finally {
			revoking = null;
		}
	}

	function labelFor(membership: string): string {
		switch (membership) {
			case 'join':
				return 'member';
			case 'invite':
				return 'pending';
			case 'leave':
				return 'left';
			case 'ban':
				return 'banned';
			default:
				return membership;
		}
	}

	function grantLabel(g: GraphMember['grant']): string {
		switch (g) {
			case 'owner':
				return 'owner';
			case 'current':
				return 'current only';
			case 'history':
				return 'full history';
			case 'legacy':
				// Invited before per-grant rooms existed; they de facto hold
				// full history, and pretending otherwise would be dishonest.
				return 'full history (older share)';
		}
	}
</script>

<section class="share">
	<h3>Share this graph</h3>
	{#if !isShareable}
		<p class="muted">
			This graph is stored locally on this device. Move it to encrypted storage from the home page
			before inviting anyone.
		</p>
	{:else}
		<form onsubmit={handleInvite}>
			<label class="field">
				<span class="label">Matrix user id</span>
				<input
					type="text"
					bind:value={invitee}
					placeholder="@bob:example.org"
					autocomplete="off"
					spellcheck="false"
					disabled={submitting}
				/>
			</label>
			<!-- Honest disclosure per grant (THREATS.md §7 rules 1, 2, 13):
			     least sharing is the default, history is a distinct ceremony,
			     and each option says exactly what leaves your device. -->
			<fieldset class="grant">
				<legend class="label">What they can see</legend>
				<label class="grant-option">
					<input type="radio" bind:group={grant} value="current" disabled={submitting} />
					<span>
						<strong>Current state only</strong> — where things stand now. Past entries and their timing
						stay yours.
					</span>
				</label>
				<label class="grant-option">
					<input type="radio" bind:group={grant} value="history" disabled={submitting} />
					<span>
						<strong>Full history</strong> — every datapoint and entry ever recorded, including when each
						one happened. This can't be un-shared later.
					</span>
				</label>
			</fieldset>
			{#if inviteError}
				<p class="error" role="alert">{inviteError}</p>
			{/if}
			{#if inviteSuccess}
				<p class="success" role="status">{inviteSuccess}</p>
			{/if}
			<div class="actions">
				<button type="submit" class="primary" disabled={submitting || !invitee.trim()}>
					{submitting ? 'Inviting…' : 'Invite'}
				</button>
			</div>
		</form>

		{#if members.length > 0}
			<ul class="member-list">
				{#each members as m (`${m.roomId}:${m.userId}`)}
					<li>
						<span class="user-id">{m.userId}</span>
						<span class="role">{grantLabel(m.grant)} · {labelFor(m.membership)}</span>
						{#if m.userId !== selfUserId && (m.membership === 'join' || m.membership === 'invite')}
							<button
								type="button"
								class="revoke"
								onclick={() => handleRevoke(m.userId)}
								disabled={revoking !== null}
							>
								{revoking === m.userId ? 'Removing…' : 'Remove'}
							</button>
						{/if}
					</li>
				{/each}
			</ul>
			{#if revokeError}
				<p class="error" role="alert">{revokeError}</p>
			{/if}
			<p class="muted small">
				Removing someone stops them from seeing future changes. It can't take back what they've
				already seen. To simply pause sharing, stop updating the graph instead.
			</p>
		{/if}
	{/if}
</section>

<style>
	.share {
		margin-top: var(--space-4);
		padding: var(--space-3) var(--space-4);
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 6px;
	}
	h3 {
		margin: 0 0 var(--space-2);
		color: var(--color-accent);
		font-size: 1.05rem;
	}
	.muted {
		color: var(--color-muted);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-bottom: var(--space-2);
	}
	.label {
		font-size: 0.85em;
		color: var(--color-muted);
	}
	input {
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: var(--color-fg);
		padding: var(--space-2);
		border-radius: 4px;
		font: inherit;
		font-family: var(--font-mono);
	}
	input:focus {
		outline: none;
		border-color: var(--color-accent);
	}
	.error {
		padding: var(--space-2) var(--space-3);
		background: rgba(255, 100, 100, 0.1);
		border: 1px solid rgba(255, 100, 100, 0.3);
		color: rgba(255, 180, 180, 1);
		border-radius: 4px;
		font-size: 0.9em;
	}
	.success {
		padding: var(--space-2) var(--space-3);
		background: rgba(120, 200, 140, 0.08);
		border: 1px solid rgba(120, 200, 140, 0.25);
		color: rgba(180, 230, 200, 1);
		border-radius: 4px;
		font-size: 0.9em;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
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
		opacity: 0.5;
		cursor: not-allowed;
	}
	button.primary:not(:disabled):hover {
		filter: brightness(1.1);
	}
	.member-list {
		list-style: none;
		padding: 0;
		margin: var(--space-3) 0 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.member-list li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-1) var(--space-2);
		background: rgba(255, 255, 255, 0.02);
		border-radius: 4px;
		font-size: 0.9em;
	}
	.user-id {
		font-family: var(--font-mono);
		color: var(--color-fg);
	}
	.role {
		color: var(--color-muted);
		font-size: 0.85em;
		margin-left: auto;
	}
	.small {
		font-size: 0.85em;
		margin: var(--space-2) 0 0;
	}
	fieldset.grant {
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 4px;
		padding: var(--space-2) var(--space-3);
		margin: 0 0 var(--space-2);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.grant-option {
		display: flex;
		gap: var(--space-2);
		align-items: baseline;
		font-size: 0.9em;
		color: var(--color-fg);
		cursor: pointer;
	}
	.grant-option input {
		flex: none;
	}
	button.revoke {
		background: transparent;
		border: 1px solid rgba(255, 100, 100, 0.35);
		color: rgba(255, 160, 160, 1);
		padding: 2px var(--space-2);
		border-radius: 4px;
		font: inherit;
		font-size: 0.85em;
		cursor: pointer;
		margin-left: var(--space-2);
	}
	button.revoke:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	button.revoke:not(:disabled):hover {
		background: rgba(255, 100, 100, 0.1);
	}
</style>

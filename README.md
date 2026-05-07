# queer-curves

Privacy-respecting graphs for tracking and sharing identity over time. Built on Matrix for federation and end-to-end encryption.

## Status

**Pre-development.** Design docs are written; implementation has not started beyond the SvelteKit scaffold. See the planning docs:

- [Data model](data_model.md) — what a graph is, schema, customization.
- [Sharing model](sharing_model.md) — how access works, on top of Matrix rooms.
- [Threat model](THREATS.md) — what we defend against and what we don't.
- [Stack](STACK.md) — technology choices and dependency hygiene.

## Getting started

Requires Node 22 LTS and pnpm 9+.

```sh
pnpm install
pnpm dev
```

## License

[AGPL-3.0-or-later](LICENSE)

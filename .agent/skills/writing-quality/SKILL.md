---
name: writing-quality
description: Improve Renova prose and UI copy while preserving technical and business truth. Use for PR descriptions, governed documentation, product copy, error messages, release notes, or explanations that need to be concise, human, specific, and free of formulaic AI-style filler.
---

# Writing Quality for Renova

Improve wording only after the underlying facts and contracts are known.

## Preserve before editing

Do not change for style alone:

- code identifiers, API paths, commands, issue/PR numbers, SHAs, status enums, role names, or migration IDs;
- financial/legal meanings, recognition timing, authorization semantics, evidence levels, or provider states;
- quoted evidence, test counts, error output, or source-backed limitations.

If a sentence is awkward because the underlying concept is ambiguous, surface the ambiguity instead of polishing it away.

## Edit for useful human prose

- Remove filler, ceremonial introductions, repeated conclusions, and claims that add no decision value.
- Prefer a concrete actor and action when that improves accountability and clarity.
- Replace vague praise such as "robust", "seamless", or "comprehensive" with the exact property that was checked.
- Keep sentence rhythm natural; do not force every paragraph into the same template.
- Use headings and lists only when they improve navigation through real structure.
- Keep Russian product-facing language natural and concise; preserve established English technical terms where the repository already uses them contractually.
- State uncertainty directly: `NOT VERIFIED`, `EXTERNAL ACTION REQUIRED`, or an equivalent factual limitation when that is the evidence state.

## Final check

A polished text must remain semantically equivalent to the evidence. If readability and contractual precision conflict, precision wins.

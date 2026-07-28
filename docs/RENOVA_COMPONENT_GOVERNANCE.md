# Renova Component Governance

## Purpose

Keep the interface consistent while the product grows.

## Component ownership

Shared components are the source of truth for repeated patterns:

- buttons;
- sheets;
- rows;
- chips;
- empty states;
- confirmations.

## Before creating a new component

Check:

1. Does an existing component solve the problem?
2. Is the new pattern repeated more than once?
3. Does the new component follow Renova hierarchy?

## Avoid

- local button variants without reason;
- duplicated card styles;
- screen-specific interaction rules;
- custom controls replacing shared primitives.

## Review standard

A new UI element should improve one of:

- clarity;
- speed of decision;
- confidence;
- consistency.

If it only adds information, reconsider placement.

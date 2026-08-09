export type InboxSnapshotDecision<T> = {
  items: T[];
  acceptedCandidate: boolean;
};

/**
 * A partial/degraded aggregate must never replace the last confirmed inbox.
 * With no confirmed snapshot yet, fail closed to no non-chat task rows; the
 * caller may still add an independently confirmed chat row afterwards.
 */
export function selectConfirmedInboxSnapshot<T>(opts: {
  candidateItems: T[];
  previousItems: T[];
  issueCount: number;
  hasConfirmedSnapshot: boolean;
}): InboxSnapshotDecision<T> {
  if (opts.issueCount === 0) {
    return { items: opts.candidateItems, acceptedCandidate: true };
  }
  return {
    items: opts.hasConfirmedSnapshot ? opts.previousItems : [],
    acceptedCandidate: false,
  };
}

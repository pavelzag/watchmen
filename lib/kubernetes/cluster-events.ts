export const SELF_MANAGED_CLUSTERS_CHANGED_EVENT = "watchmen:self-managed-clusters-changed";

export function notifySelfManagedClustersChanged(hasClusters?: boolean) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(SELF_MANAGED_CLUSTERS_CHANGED_EVENT, {
        detail: hasClusters !== undefined ? { hasClusters } : undefined,
      })
    );
  }
}

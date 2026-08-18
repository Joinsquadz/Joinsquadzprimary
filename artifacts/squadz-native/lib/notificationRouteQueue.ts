/**
 * Serializes notification navigation without coupling queue mechanics to React
 * or to React Native's InteractionManager. A second tap may append while the
 * first stack transition is still active; that must not cancel the first
 * completion or start a competing navigation.
 */
export function createNotificationRouteDrainer<T>(
  route: (value: T) => void,
  scheduleAfterRoute: (done: () => void) => void,
  onRouteSettled: () => void,
) {
  let draining = false;

  return {
    drain(value: T | undefined): boolean {
      if (draining || value === undefined) return false;
      draining = true;
      try {
        route(value);
      } catch {
        // Drop a bad route and continue to later, independently valid taps.
      }
      scheduleAfterRoute(() => {
        draining = false;
        onRouteSettled();
      });
      return true;
    },
    isDraining(): boolean {
      return draining;
    },
  };
}
/** A live route may become ineligible without invalidating other pinned candidates. */
export function isRouteAvailabilityRejection(error: unknown): boolean {
  return error instanceof Error
    && /^planned_(?:prefill|decode)_pipeline_is_infeasible:route_availability_below_minimum$/.test(error.message);
}

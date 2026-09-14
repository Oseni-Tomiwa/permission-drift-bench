import type {
  AttemptedAction,
  AuthorizationState,
  Permission,
} from "../schemas/permission.js";

function hasValidStepBounds(permission: Permission): boolean {
  return (
    (permission.validFrom === undefined ||
      Number.isInteger(permission.validFrom)) &&
    (permission.validUntil === undefined ||
      Number.isInteger(permission.validUntil))
  );
}

function isActive(permission: Permission, currentStep: number): boolean {
  if (!hasValidStepBounds(permission)) {
    return false;
  }
  if (
    permission.validFrom !== undefined &&
    currentStep < permission.validFrom
  ) {
    return false;
  }
  if (
    permission.validUntil !== undefined &&
    currentStep > permission.validUntil
  ) {
    return false;
  }
  return true;
}

function matches(
  permission: Permission,
  attemptedAction: AttemptedAction,
  authorizationState: AuthorizationState,
): boolean {
  if (
    permission.principal !== attemptedAction.principal ||
    permission.action !== attemptedAction.action ||
    permission.resource !== attemptedAction.resource
  ) {
    return false;
  }

  if (
    authorizationState.activeDimensions?.purpose === true &&
    permission.purpose !== attemptedAction.purpose
  ) {
    return false;
  }

  if (
    authorizationState.activeDimensions?.context === true &&
    permission.context !== attemptedAction.context
  ) {
    return false;
  }

  return true;
}

export function isAuthorized(
  authorizationState: AuthorizationState,
  attemptedAction: AttemptedAction,
  currentStep: number,
): boolean {
  if (
    !Number.isInteger(currentStep) ||
    !Number.isInteger(attemptedAction.step) ||
    attemptedAction.step !== currentStep
  ) {
    return false;
  }

  return authorizationState.permissions.some(
    (permission) =>
      isActive(permission, currentStep) &&
      matches(permission, attemptedAction, authorizationState),
  );
}

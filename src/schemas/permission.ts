export interface Permission {
  readonly principal: string;
  readonly action: string;
  readonly resource: string;
  readonly purpose?: string;
  readonly context?: string;
  readonly validFrom?: number;
  readonly validUntil?: number;
  readonly delegable: boolean;
}

export type PermissionInput = Omit<Permission, "delegable"> & {
  readonly delegable?: boolean;
};

export function createPermission(input: PermissionInput): Permission {
  return Object.freeze({
    ...input,
    delegable: input.delegable ?? false,
  });
}

export interface AttemptedAction {
  readonly principal: string;
  readonly action: string;
  readonly resource: string;
  readonly purpose?: string;
  readonly context?: string;
  readonly step: number;
}

export interface ActivePermissionDimensions {
  readonly purpose?: boolean;
  readonly context?: boolean;
}

export interface AuthorizationState {
  readonly permissions: readonly Permission[];
  readonly activeDimensions?: ActivePermissionDimensions;
}

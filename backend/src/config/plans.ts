import { FEATURES, FEATURE_KEYS, isFeatureKey, type FeatureKey } from './features';

export const PLAN_CODES = ['STARTER', 'PROFESSIONAL', 'ENTERPRISE'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export interface PlanDefinition {
  code: PlanCode;
  label: string;
  description: string;
  cameraLimit: number | null;
  storageLimitBytes: number | null;
  retentionMaxDays: number;
  features: readonly FeatureKey[];
}

const STARTER: readonly FeatureKey[] = ['dashboard', 'liveMonitoring', 'cameraManagement', 'detectionHistory', 'notifications', 'userManagement'];

const PROFESSIONAL: readonly FeatureKey[] = [
  ...STARTER,
  'multiCameraDashboard',
  'faceRegistration',
  'unknownAlerts',
  'evidenceCapture',
  'reportsExport',
  'exportDownload',
  'emailAlerts',
  'settings',
  'auditLogs',
];

export const PLANS: Record<PlanCode, PlanDefinition> = {
  STARTER: {
    code: 'STARTER',
    label: 'Starter',
    description: 'Live monitoring, detection history, cameras and user management',
    cameraLimit: 8,
    storageLimitBytes: 5 * 1024 * 1024 * 1024,
    retentionMaxDays: 15,
    features: STARTER,
  },
  PROFESSIONAL: {
    code: 'PROFESSIONAL',
    label: 'Professional',
    description: 'Face recognition, evidence, reports, multi-camera monitoring and audit',
    cameraLimit: 32,
    storageLimitBytes: 50 * 1024 * 1024 * 1024,
    retentionMaxDays: 90,
    features: PROFESSIONAL,
  },
  ENTERPRISE: {
    code: 'ENTERPRISE',
    label: 'Enterprise',
    description: 'Every feature supported by this deployment, with higher camera and storage limits',
    cameraLimit: null,
    storageLimitBytes: null,
    retentionMaxDays: 3650,
    features: FEATURE_KEYS.filter((key) => FEATURES[key].supported),
  },
};

export function isPlanCode(value: string): value is PlanCode {
  return (PLAN_CODES as readonly string[]).includes(value);
}

export function planAllowsFeature(plan: PlanCode, key: FeatureKey): boolean {
  return PLANS[plan].features.includes(key);
}

export interface PlanSelection {
  features: string[];
  retentionDays: number;
  cameraLimit: number | null;
  storageLimitBytes: number | null;
}

/** Returns human-readable problems. Empty means the selection matches the plan and the deployment. */
export function planSelectionErrors(plan: PlanCode, selection: PlanSelection): string[] {
  const def = PLANS[plan];
  const errors: string[] = [];
  for (const key of selection.features) {
    if (!isFeatureKey(key)) {
      errors.push(`Unknown feature "${key}"`);
      continue;
    }
    if (!FEATURES[key].supported) errors.push(`${FEATURES[key].label} is not available in this deployment`);
    else if (!def.features.includes(key)) errors.push(`${FEATURES[key].label} is not included in the ${def.label} plan`);
  }
  if (selection.retentionDays > def.retentionMaxDays) {
    errors.push(`The ${def.label} plan keeps detection history for at most ${def.retentionMaxDays} days`);
  }
  if (def.cameraLimit != null && selection.cameraLimit != null && selection.cameraLimit > def.cameraLimit) {
    errors.push(`The ${def.label} plan allows at most ${def.cameraLimit} cameras`);
  }
  if (def.storageLimitBytes != null && selection.storageLimitBytes != null && selection.storageLimitBytes > def.storageLimitBytes) {
    errors.push(`The ${def.label} plan allows at most ${def.storageLimitBytes} bytes of evidence storage`);
  }
  return errors;
}

export function planCatalog() {
  return PLAN_CODES.map((code) => {
    const plan = PLANS[code];
    return {
      code: plan.code,
      label: plan.label,
      description: plan.description,
      cameraLimit: plan.cameraLimit,
      storageLimitBytes: plan.storageLimitBytes,
      retentionMaxDays: plan.retentionMaxDays,
      features: [...plan.features],
    };
  });
}

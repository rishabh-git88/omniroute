import { validateRoutingRegistry } from '@omniroute/config/registry-seed';
import { parseApiEnvironment } from '@omniroute/config/api';
import type { RegisteredModel } from '../model-registry/model-registry.repository.js';
import { executionEnabled } from './execution-gateway.js';

export function routingRegistry(entries: RegisteredModel[], now = new Date()) {
  const region = parseApiEnvironment(process.env).AI_ROUTING_REGION;
  const latest = new Map<string, RegisteredModel>();
  for (const entry of entries) {
    if (
      !executionEnabled(entry.provider.key) ||
      entry.effectiveAt > now ||
      entry.retiredAt ||
      !entry.enabled ||
      entry.rolloutState === 'DISABLED' ||
      (parseApiEnvironment(process.env).NODE_ENV === 'production' &&
        entry.rolloutState !== 'GENERAL') ||
      (entry.regionConstraints.length > 0 &&
        (!region || !entry.regionConstraints.includes(region)))
    )
      continue;
    try {
      validateRoutingRegistry({
        provider: entry.provider.key,
        modelKey: entry.model.modelKey,
        providerModelId: entry.model.providerModelId,
        displayName: entry.model.displayName,
        registryVersion: entry.registryVersion,
        capabilities: entry.capabilities,
        pricing: entry.pricing,
        pricingVersion: entry.pricingVersion,
        effectiveAt: entry.effectiveAt.toISOString(),
        regionConstraints: entry.regionConstraints,
      });
    } catch {
      continue;
    }
    const prior = latest.get(entry.modelId);
    if (!prior || prior.registryVersion < entry.registryVersion)
      latest.set(entry.modelId, entry);
  }
  return [...latest.values()];
}

export function routingSnapshot(entry: RegisteredModel) {
  return {
    registryEntryId: entry.id,
    provider: entry.provider.key,
    modelKey: entry.model.modelKey,
    providerModelId: entry.model.providerModelId,
    registryVersion: entry.registryVersion,
    enabled: entry.enabled,
    capabilities: entry.capabilities,
    pricing: entry.pricing,
    pricingVersion: entry.pricingVersion,
    regionConstraints: entry.regionConstraints,
  };
}

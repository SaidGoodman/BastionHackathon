import { INDUSTRIAL_PROTOCOLS, type DataProtocol, type IndustrialProtocol } from './types.js';

/** Приводит протокол из текста к одному из поддерживаемых. Ничего не угадывает: неизвестное → null. */
export function normalizeProtocol(raw: string | null | undefined): DataProtocol | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  if (s === 'tcp') return 'TCP';
  if (s === 'udp') return 'UDP';
  if (s.includes('mqtt')) return 'MQTT';
  if (s.includes('modbus')) return 'Modbus TCP';
  if (s.includes('104') || s.includes('iec') || s.includes('мэк')) return 'МЭК 104';
  return null;
}

export function isIndustrial(p: string | null | undefined): p is IndustrialProtocol {
  return !!p && (INDUSTRIAL_PROTOCOLS as string[]).includes(p);
}

export function supportsOneWay(p: string | null | undefined): boolean {
  return p === 'TCP' || p === 'UDP';
}

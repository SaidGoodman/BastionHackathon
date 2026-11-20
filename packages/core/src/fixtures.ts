/**
 * Сценарии в виде операций — то, что должна вернуть модель-извлекатель на открытые примеры.
 * Используются в тестах движка и позже как few-shot примеры для промпта извлечения.
 */
import type { Op } from './ops.js';

const office = (name = 'Офисная сеть'): Op => ({ op: 'set_network', id: 'n1', name, trust: 'open' });
const shop = (name = 'Сеть цеха'): Op => ({ op: 'set_network', id: 'n2', name, trust: 'closed' });

export const F02: Op[] = [
  { op: 'set_network', id: 'n1', name: 'Общая сеть водоканала', trust: 'open' },
  { op: 'set_network', id: 'n2', name: 'Сеть насосной станции', trust: 'closed' },
  { op: 'upsert_device', id: 'dispatcher', name: 'Программа диспетчера', networkId: 'n1' },
  { op: 'upsert_device', id: 'monitoring', name: 'Сервер мониторинга', networkId: 'n1' },
  { op: 'upsert_device', id: 'ntp-office', name: 'Сервер времени', networkId: 'n1', note: 'источник времени' },
  { op: 'upsert_device', id: 'controller', name: 'Контроллер насосов', networkId: 'n2' },
  { op: 'upsert_device', id: 'operator', name: 'Компьютер оператора', networkId: 'n2' },
  { op: 'upsert_device', id: 'ntp-station', name: 'Сервер времени станции', networkId: 'n2' },
  {
    op: 'upsert_data_flow', id: 'f1', description: 'Опрос контроллера насосов программой диспетчера', purpose: 'polling',
    senders: ['dispatcher'], receivers: ['controller'], protocol: 'Modbus TCP', port: 502, reverse: true,
  },
  {
    op: 'upsert_data_flow', id: 'f2', description: 'Журналы событий на сервер мониторинга', purpose: 'logs',
    senders: ['operator'], receivers: ['monitoring'], protocol: 'UDP', port: 514, reverse: false,
  },
  {
    op: 'upsert_data_flow', id: 'f3', description: 'Синхронизация времени', purpose: 'time', isTimeSync: true,
    senders: ['ntp-office'], receivers: ['ntp-station'], protocol: 'UDP', port: 123, reverse: false,
  },
];

export const F07: Op[] = [
  office(),
  shop(),
  { op: 'upsert_device', id: 'broker-office', name: 'MQTT-брокер офиса', networkId: 'n1' },
  { op: 'upsert_device', id: 'ntp-office', name: 'Сервер времени офиса', networkId: 'n1' },
  { op: 'upsert_device', id: 'broker-shop', name: 'MQTT-брокер цеха', networkId: 'n2' },
  { op: 'upsert_device', id: 'ntp-shop', name: 'Сервер времени цеха', networkId: 'n2' },
  { op: 'upsert_device', id: 'fileserver', name: 'Файловый сервер цеха', networkId: 'n2' },
  {
    op: 'upsert_data_flow', id: 'f1', description: 'Показания датчиков с брокера цеха на брокер офиса', purpose: 'telemetry',
    senders: ['broker-shop'], receivers: ['broker-office'], protocol: 'MQTT', port: null, reverse: false,
  },
  {
    op: 'upsert_data_flow', id: 'f2', description: 'Синхронизация времени', isTimeSync: true,
    senders: ['ntp-office'], receivers: ['ntp-shop'], protocol: 'UDP', port: 123, reverse: false,
  },
  {
    op: 'upsert_file_flow', id: 'f3', description: 'Обновления с флешки на файловый сервер цеха',
    transfers: [{ from: 'n1', to: 'n2', send: { method: 'usb' }, receive: { method: 'push', protocol: 'SMB', storage: 'fileserver' } }],
    checks: ['icap_av'], differentChecks: null, isolation: null, users: { exact: 1 }, userNames: ['подрядчик'],
  },
];

export const F01: Op[] = [
  office(),
  shop(),
  { op: 'upsert_device', id: 'machines', name: 'Станки цеха', networkId: 'n2', count: 3 },
  { op: 'upsert_device', id: 'logsrv', name: 'Сервер журналов', networkId: 'n1' },
  {
    op: 'upsert_data_flow', id: 'f1', description: 'Журналы событий трёх станков на сервер журналов', purpose: 'logs',
    senders: ['machines'], receivers: ['logsrv'], protocol: 'UDP', port: 514, reverse: false,
  },
];

export const F04: Op[] = [
  office(),
  shop(),
  { op: 'upsert_device', id: 'engineer', name: 'АРМ инженера', networkId: 'n1' },
  { op: 'upsert_device', id: 'fileserver', name: 'Файловый сервер цеха', networkId: 'n2', note: 'общая папка' },
  {
    op: 'upsert_file_flow', id: 'f1', description: 'Файлы программ для станка',
    transfers: [{ from: 'n1', to: 'n2', send: { method: 'manual', protocol: 'SFTP', actor: 'engineer' }, receive: { method: 'push', protocol: 'SMB', storage: 'fileserver' } }],
    checks: ['name_mask', 'size', 'icap_av'], differentChecks: false, isolation: false, users: { exact: 1 }, userNames: ['инженер'],
  },
];

export const N01: Op[] = [
  { op: 'set_network', id: 'n1', name: 'Офис', trust: null },
  shop(),
  {
    op: 'upsert_file_flow', id: 'f1', description: 'Обмен файлами между офисом и цехом',
    transfers: [
      { from: 'n1', to: 'n2', send: null, receive: null },
      { from: 'n2', to: 'n1', send: null, receive: null },
    ],
    checks: null, differentChecks: null, isolation: null, users: null,
  },
];

export const N05: Op[] = [
  office(),
  shop(),
  { op: 'upsert_device', id: 'logsrc', name: 'Системы цеха', networkId: 'n2' },
  { op: 'upsert_device', id: 'logsrv', name: 'Сервер в офисе', networkId: 'n1' },
  {
    op: 'upsert_data_flow', id: 'f1', description: 'Журналы событий на сервер в офисе', purpose: 'logs',
    senders: ['logsrc'], receivers: ['logsrv'], protocol: 'UDP', port: 514, reverse: false,
  },
  {
    op: 'upsert_file_flow', id: 'f2', description: 'Файлы обновлений в цех',
    transfers: [{ from: 'n1', to: 'n2', send: null, receive: null }],
    checks: null, differentChecks: null, isolation: null, users: null,
  },
];

/** Ответ пользователя N05 после уточнения — как его разобрала бы модель. */
export const N05_followup: Op[] = [
  { op: 'upsert_device', id: 'fileserver', name: 'Файловый сервер цеха', networkId: 'n2' },
  {
    op: 'upsert_file_flow', id: 'f2', description: 'Обновления с флешки на файловый сервер цеха',
    transfers: [{ from: 'n1', to: 'n2', send: { method: 'usb' }, receive: { method: 'push', protocol: 'SMB', storage: 'fileserver' } }],
    checks: ['icap_av'], differentChecks: false, isolation: false, users: { exact: 1 },
  },
];

export const U01: Op[] = [
  office(),
  shop(),
  { op: 'upsert_device', id: 'st-office', name: 'Хранилище офиса', networkId: 'n1' },
  { op: 'upsert_device', id: 'st-shop', name: 'Хранилище цеха', networkId: 'n2' },
  {
    op: 'upsert_file_flow', id: 'f1', description: 'Автоматический обмен между хранилищами',
    transfers: [
      { from: 'n1', to: 'n2', send: { method: 'pull', protocol: 'SFTP', storage: 'st-office' }, receive: { method: 'push', protocol: 'SFTP', storage: 'st-shop' } },
      { from: 'n2', to: 'n1', send: { method: 'pull', protocol: 'SFTP', storage: 'st-shop' }, receive: { method: 'push', protocol: 'SFTP', storage: 'st-office' } },
    ],
    checks: [], differentChecks: false, isolation: false, users: { exact: 0 },
  },
];

/** U02, вариант 1: два отдела, общие проверки, изоляция принятых файлов. */
export const U02a: Op[] = [
  office(),
  shop(),
  {
    op: 'upsert_file_flow', id: 'f1', description: 'Файлы двух отделов офиса в закрытый сегмент',
    transfers: [{ from: 'n1', to: 'n2', send: { method: 'manual', protocol: 'SFTP' }, receive: { method: 'manual', protocol: 'SFTP' } }],
    checks: ['icap_av'], differentChecks: false, isolation: true, isolatedGroups: 2, users: null,
  },
];

/** U02, вариант 2: одна группа, разные проверки на двух узлах. */
export const U02b: Op[] = [
  office(),
  shop(),
  {
    op: 'upsert_file_flow', id: 'f1', description: 'Файлы группы в закрытый сегмент',
    transfers: [{ from: 'n1', to: 'n2', send: { method: 'manual', protocol: 'SFTP' }, receive: { method: 'manual', protocol: 'SFTP' } }],
    checks: [], checksByNode: { n1: ['size'], n2: ['icap_av'] }, differentChecks: false, isolation: false, users: { min: 2, max: 10 },
  },
];

export const THREE_NETS: Op[] = [
  { op: 'set_network', id: 'n1', name: 'Офис', trust: null },
  { op: 'set_network', id: 'n2', name: 'Цех', trust: null },
  { op: 'set_network', id: 'n3', name: 'Сеть подрядчиков', trust: null },
];

export const BOTH_OPEN: Op[] = [
  { op: 'set_network', id: 'n1', name: 'Сеть бухгалтерии', trust: 'open' },
  { op: 'set_network', id: 'n2', name: 'Сеть отдела продаж', trust: 'open' },
  { op: 'upsert_device', id: 'a', name: 'Сервер отчётов', networkId: 'n1' },
  { op: 'upsert_device', id: 'b', name: 'База CRM', networkId: 'n2' },
  {
    op: 'upsert_data_flow', id: 'f1', description: 'Запросы к базе CRM', senders: ['a'], receivers: ['b'], protocol: 'TCP', port: 5432, reverse: true,
  },
];

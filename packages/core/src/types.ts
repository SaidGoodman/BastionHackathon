/**
 * Модель состояния проектной сессии.
 *
 * Тройное значение параметра:
 *   T         — значение известно;
 *   null      — ещё не выяснено → движок задаёт вопрос;
 *   'unknown' — пользователь ответил «не знаю» → больше не спрашиваем, результат предварительный.
 */
export type Maybe<T> = T | null | 'unknown';

export const UNKNOWN = 'unknown' as const;

export function isKnown<T>(v: Maybe<T>): v is T {
  return v !== null && v !== UNKNOWN;
}

export type Trust = 'open' | 'closed';

export interface Network {
  /** Внутренний id ('n1', 'n2', ...). В экспортируемом JSON заменяется на 'open' / 'closed'. */
  id: string;
  name: string;
  /** Как пользователь назвал сеть: открытая / закрытая. */
  trust: Maybe<Trust>;
}

export interface Device {
  id: string;
  name: string;
  networkId: string;
  /** Короткое пояснение для карточки на схеме («источник времени», «получает журналы»). */
  note?: string;
  /** Группа однотипных систем (например «3 станка»). */
  count?: number;
}

// ---------------------------------------------------------------- data

export type IndustrialProtocol = 'MQTT' | 'Modbus TCP' | 'МЭК 104';
export type DataProtocol = 'TCP' | 'UDP' | IndustrialProtocol;

export const DATA_PROTOCOLS: DataProtocol[] = ['TCP', 'UDP', 'MQTT', 'Modbus TCP', 'МЭК 104'];
export const INDUSTRIAL_PROTOCOLS: IndustrialProtocol[] = ['MQTT', 'Modbus TCP', 'МЭК 104'];

export type DataPurpose = 'logs' | 'telemetry' | 'time' | 'backup' | 'polling' | 'database' | 'video' | 'other';

export interface DataFlow {
  id: string;
  kind: 'data';
  /** Описание словами пользователя: «Журналы событий трёх станков на сервер журналов». */
  description: string;
  purpose?: DataPurpose;
  /** Синхронизация времени NTP — особое правило методики. */
  isTimeSync?: boolean;
  /** Отправители / инициаторы соединения (id устройств). */
  senders: string[];
  /**
   * Конечные получатели. Каждый получатель — отдельное правило.
   * null — не выяснено, 'unknown' — пользователь не знает.
   */
  receivers: Maybe<string[]>;
  /** Сети, если устройства не названы. Иначе выводятся из устройств. */
  fromNetwork?: Maybe<string>;
  toNetwork?: Maybe<string>;
  /** Известный протокол из списка либо произвольный текст (неподдерживаемый). */
  protocol: Maybe<string>;
  /** Порт: никогда не угадываем. Неизвестный порт не блокирует результат. */
  port: Maybe<number>;
  /** Нужна ли обратная передача / ответ получателя (важно только для TCP/UDP). */
  reverse: Maybe<boolean>;
}

// ---------------------------------------------------------------- files

export type FileSendMethod = 'manual' | 'pull' | 'usb';
export type FileReceiveMethod = 'manual' | 'push' | 'usb';
export type FileProtocol = 'SFTP' | 'FTP' | 'SMB';

export interface SendSpec {
  method: FileSendMethod;
  /** Для pull: SFTP | FTP | SMB; для manual — всегда SFTP; для usb — нет. */
  protocol?: Maybe<FileProtocol>;
  /** id устройства-хранилища для PULL. */
  storage?: string;
  /** Для manual: устройство/рабочее место человека, если названо. */
  actor?: string;
}

export interface ReceiveSpec {
  method: FileReceiveMethod;
  protocol?: Maybe<FileProtocol>;
  /** id устройства-хранилища для PUSH. */
  storage?: string;
  /** Для manual: устройство/рабочее место человека, если названо. */
  actor?: string;
}

/** Одно направление передачи файлов. */
export interface FileTransfer {
  from: string;
  to: string;
  send: Maybe<SendSpec>;
  receive: Maybe<ReceiveSpec>;
}

export type FileCheck =
  | 'name_mask'
  | 'type_ext'
  | 'size'
  | 'integrity'
  | 'icap_av'
  | 'icap_sandbox'
  | 'icap_dlp';

export const FILE_CHECKS: FileCheck[] = ['name_mask', 'type_ext', 'size', 'integrity', 'icap_av', 'icap_sandbox', 'icap_dlp'];

export interface UsersCount {
  exact?: number;
  min?: number;
  /** null — открытая верхняя граница («больше 100»). */
  max?: number | null;
}

/**
 * Файловый поток — одна группа требований: общий профиль проверок и общая видимость файлов.
 * Если группы с разными проверками/изоляцией описаны явно — это разные FileFlow.
 * Если пользователь лишь сказал «нужны N разных наборов» — используем splitBy.
 */
export interface FileFlow {
  id: string;
  kind: 'file';
  description: string;
  /** Направления. null — не выяснено. Два элемента — обмен в обе стороны. */
  transfers: Maybe<FileTransfer[]>;
  /** Проверки, общие для правила (или на отправляющей стороне). [] — проверки не нужны. */
  checks: Maybe<FileCheck[]>;
  /** Разные проверки на двух узлах: { [networkId]: checks }. */
  checksByNode?: Record<string, FileCheck[]>;
  /** Нужны ли на одной стороне разные наборы проверок (для разных файлов/пользователей). */
  differentChecks: Maybe<boolean>;
  /** Сколько разных наборов, если differentChecks = true. */
  checkProfiles?: Maybe<number>;
  /** Должны ли пользователи не видеть принятые файлы друг друга. */
  isolation: Maybe<boolean>;
  /** Сколько изолированных групп, если isolation = true. */
  isolatedGroups?: Maybe<number>;
  /** Сколько фактических групп требований, если заданы и проверки, и изоляция. */
  combinedGroups?: number;
  /** Люди, вручную кладущие или забирающие файлы (включая USB). */
  users: Maybe<UsersCount>;
  /** Имена/роли людей, если явно названы — чтобы не считать одного человека дважды. */
  userNames?: string[];
  /** Группа пользователей, к которой относится поток (для подписи). */
  group?: string;
}

export type Flow = DataFlow | FileFlow;

// ---------------------------------------------------------------- session

export interface VendorRequest {
  text: string;
  source: 'unsupported' | 'other_answer';
  /** Исходная формулировка пользователя. */
  quote?: string;
  turnId?: string;
}

export interface Assumption {
  text: string;
  /** Явно согласовано пользователем. */
  agreed: boolean;
}

export interface SessionState {
  networks: Network[];
  /**
   * Защищаемая сторона как проектное решение (если обе сети открытые или не указано).
   * Если trust одной из сетей = 'closed', выводится из него.
   */
  protectedNetwork: Maybe<string>;
  /** Есть ли у заказчика МЭ. Не блокирует: МЭ рекомендуем всегда. */
  existingFirewall: Maybe<boolean>;
  firewallName?: string;
  devices: Device[];
  flows: Flow[];
  assumptions: Assumption[];
  requestsForVendor: VendorRequest[];
  /** Пользователь просил поставить Синоникс вне закрытого сегмента. */
  placementRequest?: string;
  /** Пользователь просил что-то принципиально невозможное в текущем шаге (для объяснения). */
  rejected?: { text: string; reason: string }[];
  /** id вопросов, уже заданных пользователю, и сколько раз. */
  asked: Record<string, number>;
}

export function emptyState(): SessionState {
  return {
    networks: [],
    protectedNetwork: null,
    existingFirewall: null,
    devices: [],
    flows: [],
    assumptions: [],
    requestsForVendor: [],
    asked: {},
  };
}

// ---------------------------------------------------------------- result

export type Status = 'needs_clarification' | 'preliminary' | 'completed' | 'unsupported';
export type RuleMode = 'one-way' | 'two-way';

export interface SourceRef {
  file: string;
  section: string;
}

export interface Rule {
  id: number;
  type: 'data' | 'file';
  /** Внутренние id сетей. Для двунаправленного правила from — сторона инициатора. */
  from: string;
  to: string;
  mode: RuleMode | null;
  /** data: строка; file: { [networkId]: «SFTP, вручную» }. */
  protocol: string | null | Record<string, string>;
  port?: number | null;
  description: string;
  /** Обоснование для таблицы. */
  justification: string;
  senders: string[];
  receivers: string[];
  flowIds: string[];
  /** Правило синхронизации времени (NTP). */
  timeSync?: boolean;
  /** Что подключено к правилу с каждой стороны (для схемы): { [networkId]: RuleEnd }. */
  ends: Record<string, RuleEnd>;
  /** Узел-сторона отправителей (collect) и получателя (exchange) — для data. */
  collectNetwork?: string;
  exchangeNetwork?: string;
  // file
  methods?: Record<string, string[]>;
  checks?: string[];
  checksByNode?: Record<string, string[]>;
  pull?: boolean;
  usb?: boolean;
  /** Параметры правила, которые неизвестны. */
  unknowns: string[];
  sources: SourceRef[];
}

export interface RuleEnd {
  /** Системы этой стороны (отправители, получатель, хранилища, рабочие места). */
  devices: string[];
  /** Файлы на этой стороне кладут/забирают вручную (SFTP), а рабочее место не названо. */
  manual?: boolean;
  /** USB-носитель на Узле А: 'in' — с флешки в закрытый сегмент, 'out' — выгрузка на флешку. */
  usb?: 'in' | 'out' | 'both';
  /** Стрелка входит в эту сторону (получатель). */
  receives: boolean;
  /** Сторона отправляет. */
  sends: boolean;
  /** Короткая подпись способа на этой стороне: «SMB, PUSH», «SFTP вручную». */
  method?: string;
}

export interface QuestionOption {
  value: string;
  label: string;
}

export interface Question {
  id: string;
  /** Сгруппированный шаг: связанные вопросы показываются вместе. */
  group: string;
  text: string;
  /** К чему относится вопрос (для UI): «Журналы → сервер мониторинга». */
  context?: string;
  options: QuestionOption[];
  multi?: boolean;
  allowUnknown: boolean;
  allowOther: boolean;
}

export interface Unknown {
  /** Путь параметра: flow:<id>:protocol. */
  path: string;
  text: string;
  /** Влияет ли на число/корректность правил (true) или только на полноту описания (false). */
  affectsResult: boolean;
}

export interface Issue {
  severity: 'error' | 'warning' | 'info';
  text: string;
  sources?: SourceRef[];
}

export interface EngineResult {
  status: Status;
  rules: Rule[];
  rulesCount: number;
  /** Нижняя оценка, когда результат предварительный. */
  minRules: number;
  questions: Question[];
  unknowns: Unknown[];
  assumptions: Assumption[];
  issues: Issue[];
  fileUsers: { count: number | null; range: { min: number; max: number | null } | null; breakdown: string[] };
  firewall: { side: 'open' | 'both'; existing: Maybe<boolean>; name?: string };
  /** Защищаемая (закрытая) и открытая сети, если определены. */
  closedNetwork: string | null;
  openNetwork: string | null;
  sources: SourceRef[];
}

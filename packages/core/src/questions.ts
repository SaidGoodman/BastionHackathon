/**
 * Шаблоны уточняющих вопросов (02_methodology.md, раздел 4).
 * Варианты фиксированы кодом: модель вопросы не генерирует, поэтому не может «подсказать» порт или протокол.
 * У каждого вопроса есть «не знаю» и «другое» (allowUnknown / allowOther) — их рисует UI.
 */
import type { Network, Question, QuestionOption } from './types.js';

const q = (
  id: string,
  group: string,
  text: string,
  options: QuestionOption[],
  extra: Partial<Question> = {},
): Question => ({ id, group, text, options, allowUnknown: true, allowOther: true, ...extra });

const AUTO_PROTOCOLS = ['SMB', 'SFTP', 'FTP'] as const;

export const Q = {
  networkPair: (nets: Network[]): Question => {
    const opts: QuestionOption[] = [];
    for (let i = 0; i < nets.length; i++)
      for (let j = i + 1; j < nets.length; j++)
        opts.push({ value: `${nets[i].id}+${nets[j].id}`, label: `${nets[i].name} ↔ ${nets[j].name}` });
    return q('net:pair', 'networks', 'Одним «Синониксом» проектируется граница между двумя сетями. Какую пару сетей рассмотрим сейчас?', opts, {
      allowUnknown: false,
    });
  },

  secondNetwork: (): Question =>
    q('net:second', 'networks', 'Между какими двумя сетями нужен обмен? Опишите вторую сеть.', [], { allowUnknown: false }),

  protectedSide: (nets: Network[]): Question =>
    q(
      'net:protected',
      'networks',
      'Какая из сетей более защищаемая (её отделяем «Синониксом»)?',
      [...nets.map((n) => ({ value: n.id, label: n.name })), { value: 'both_open', label: 'обе открытые' }],
    ),

  protectedChoice: (nets: Network[]): Question =>
    q(
      'net:protected_choice',
      'networks',
      'Обе сети открытые. Какую сторону принять за защищаемую в этом проекте? Выбор будет зафиксирован как проектное решение.',
      nets.map((n) => ({ value: n.id, label: n.name })),
      { allowOther: false },
    ),

  whatToTransfer: (): Question =>
    q('flows:none', 'flows', 'Что нужно передавать между сетями?', [
      { value: 'backup', label: 'резервные копии' },
      { value: 'logs', label: 'журналы' },
      { value: 'telemetry', label: 'телеметрия' },
      { value: 'time', label: 'время' },
      { value: 'files', label: 'файлы' },
    ], { multi: true, allowUnknown: false }),

  // ------------------------------------------------------------ data

  dataDirection: (flowId: string, ctx: string, nets: Network[]): Question =>
    q(`flow:${flowId}:direction`, `flow:${flowId}`, 'В какую сторону идут эти данные (кто начинает обмен)?', [
      { value: `${nets[0].id}>${nets[1].id}`, label: `из «${nets[0].name}» в «${nets[1].name}»` },
      { value: `${nets[1].id}>${nets[0].id}`, label: `из «${nets[1].name}» в «${nets[0].name}»` },
    ], { context: ctx }),

  dataReceivers: (flowId: string, ctx: string): Question =>
    q(`flow:${flowId}:receivers`, `flow:${flowId}`, 'Сколько систем принимают эти данные?', [
      { value: 'one', label: 'одна' },
      { value: 'several', label: 'несколько (укажите какие в поле «другое»)' },
    ], { context: ctx }),

  dataProtocol: (flowId: string, ctx: string): Question =>
    q(`flow:${flowId}:protocol`, `flow:${flowId}`, 'По какому протоколу идут данные?', [
      { value: 'TCP', label: 'TCP' },
      { value: 'UDP', label: 'UDP' },
      { value: 'MQTT', label: 'MQTT' },
      { value: 'Modbus TCP', label: 'Modbus TCP' },
      { value: 'МЭК 104', label: 'МЭК 104' },
    ], { context: ctx }),

  dataReverse: (flowId: string, ctx: string): Question =>
    q(`flow:${flowId}:reverse`, `flow:${flowId}`, 'Нужна ли передача в обратную сторону?', [
      { value: 'no', label: 'нет, только в одну сторону' },
      { value: 'yes', label: 'да, нужна (ответ на запрос или обмен в обе стороны)' },
    ], { context: ctx, allowOther: false }),

  // ------------------------------------------------------------ files

  fileDirection: (flowId: string, ctx: string, nets: Network[]): Question =>
    q(`ff:${flowId}:direction`, `ff:${flowId}`, 'В какую сторону передаются файлы?', [
      { value: `${nets[0].id}>${nets[1].id}`, label: `из «${nets[0].name}» в «${nets[1].name}»` },
      { value: `${nets[1].id}>${nets[0].id}`, label: `из «${nets[1].name}» в «${nets[0].name}»` },
      { value: 'both', label: 'в обе стороны' },
    ], { context: ctx }),

  fileSend: (flowId: string, ctx: string, net: Network, usbAllowed: boolean): Question =>
    q(`ff:${flowId}:send:${net.id}`, `ff:${flowId}`, `Как файлы будут отправляться из «${net.name}»?`, [
      { value: 'manual', label: 'вручную (человек кладёт файл по SFTP)' },
      // Протокол автоматики спрашиваем тем же шагом, чтобы не было отдельного уточнения.
      ...AUTO_PROTOCOLS.map((p) => ({ value: `pull:${p}`, label: `автоматически по расписанию из хранилища (${p})` })),
      { value: 'pull', label: 'автоматически из хранилища, протокол не знаю' },
      ...(usbAllowed ? [{ value: 'usb', label: 'с флешки (USB-порт Узла А)' }] : []),
    ], { context: ctx }),

  fileReceive: (flowId: string, ctx: string, net: Network, usbAllowed: boolean): Question =>
    q(`ff:${flowId}:recv:${net.id}`, `ff:${flowId}`, `Куда файлы должны попасть в «${net.name}»?`, [
      { value: 'manual', label: 'заберёт человек вручную (SFTP)' },
      ...AUTO_PROTOCOLS.map((p) => ({ value: `push:${p}`, label: `автоматически в хранилище, как только файл пришёл (${p})` })),
      { value: 'push', label: 'автоматически в хранилище, протокол не знаю' },
      ...(usbAllowed ? [{ value: 'usb', label: 'на флешку (USB-порт Узла А)' }] : []),
    ], { context: ctx }),

  fileAutoProtocol: (flowId: string, ctx: string, net: Network, dir: 'send' | 'recv'): Question =>
    q(
      `ff:${flowId}:proto:${dir}:${net.id}`,
      `ff:${flowId}`,
      dir === 'send'
        ? `По какому протоколу «Синоникс» забирает файлы из хранилища в «${net.name}»?`
        : `По какому протоколу «Синоникс» доставляет файлы в хранилище в «${net.name}»?`,
      [
        { value: 'SFTP', label: 'SFTP' },
        { value: 'FTP', label: 'FTP' },
        { value: 'SMB', label: 'SMB' },
      ],
      { context: ctx },
    ),

  fileChecks: (flowId: string, ctx: string): Question =>
    q(`ff:${flowId}:checks`, `ff:${flowId}`, 'Какие проверки файлов нужны?', [
      { value: 'name_mask', label: 'маска имени' },
      { value: 'type_ext', label: 'тип и расширение' },
      { value: 'size', label: 'размер' },
      { value: 'integrity', label: 'целостность (цифровая подпись)' },
      { value: 'icap_av', label: 'внешний антивирус по ICAP' },
      { value: 'icap_sandbox', label: 'внешняя песочница по ICAP' },
      { value: 'icap_dlp', label: 'внешняя DLP по ICAP' },
      { value: 'none', label: 'проверки не нужны' },
    ], { context: ctx, multi: true }),

  fileDifferentChecks: (flowId: string, ctx: string): Question =>
    q(`ff:${flowId}:differentChecks`, `ff:${flowId}`, 'Нужны ли на одной стороне разные проверки для разных файлов или пользователей?', [
      { value: 'no', label: 'нет, проверки для всех одни' },
      { value: '2', label: 'да, 2 разных набора' },
      { value: '3', label: 'да, 3 разных набора' },
      { value: 'yes', label: 'да, количество наборов уточню позже' },
    ], { context: ctx }),

  fileIsolation: (flowId: string, ctx: string): Question =>
    q(`ff:${flowId}:isolation`, `ff:${flowId}`, 'Могут ли пользователи видеть принятые файлы друг друга?', [
      { value: 'shared', label: 'да, файлы общие' },
      { value: '2', label: 'нет, 2 группы не должны видеть файлы друг друга' },
      { value: '3', label: 'нет, 3 таких группы' },
      { value: 'yes', label: 'нет, количество групп уточню позже' },
    ], { context: ctx }),

  fileUsers: (flowId: string, ctx: string): Question =>
    q(`ff:${flowId}:users`, `ff:${flowId}`, 'Сколько человек будут вручную передавать или забирать файлы?', [
      { value: '1', label: '1 человек' },
      { value: '2-10', label: '2–10' },
      { value: '11-50', label: '11–50' },
      { value: '51-100', label: '51–100' },
      { value: '101-', label: 'больше 100' },
    ], { context: ctx }),
};

import type { FileCheck, FileProtocol, ReceiveSpec, SendSpec, SourceRef } from './types.js';

export const CHECK_LABELS: Record<FileCheck, string> = {
  name_mask: 'маска имени',
  type_ext: 'тип и расширение',
  size: 'размер',
  integrity: 'целостность (цифровая подпись)',
  icap_av: 'ICAP: внешний антивирус',
  icap_sandbox: 'ICAP: внешняя песочница',
  icap_dlp: 'ICAP: внешняя DLP',
};

export function checkLabel(c: FileCheck): string {
  return CHECK_LABELS[c] ?? c;
}

export function sendLabel(s: SendSpec): string {
  switch (s.method) {
    case 'manual':
      return 'SFTP, вручную';
    case 'usb':
      return 'USB-носитель на Узле А';
    case 'pull':
      return `${protoLabel(s.protocol)}, автоматически по расписанию (PULL)`;
  }
}

export function receiveLabel(r: ReceiveSpec): string {
  switch (r.method) {
    case 'manual':
      return 'SFTP, вручную';
    case 'usb':
      return 'выгрузка на USB-носитель на Узле А';
    case 'push':
      return `${protoLabel(r.protocol)}, автоматически при поступлении (PUSH)`;
  }
}

function protoLabel(p: FileProtocol | null | 'unknown' | undefined): string {
  if (!p || p === 'unknown') return 'протокол не указан';
  return p;
}

/** Ссылки на базу знаний. Разделы — как в заголовках файлов. */
export const SRC = {
  placement: { file: '02_methodology.md', section: '2. Размещение' },
  dataRules: { file: '02_methodology.md', section: '3.1. Правила передачи данных' },
  fileRules: { file: '02_methodology.md', section: '3.2. Правила передачи файлов' },
  modes: { file: '02_methodology.md', section: '3.3. Направление и режим правила' },
  questions: { file: '02_methodology.md', section: '4. Уточняющие вопросы' },
  fileUsers: { file: '02_methodology.md', section: '7. Дополнительное задание' },
  scopeDataSetup: { file: '01_scope_functions_synonyx_1.9.md', section: '4. Передача данных — Как настраивается правило передачи данных' },
  scopeProtocols: { file: '01_scope_functions_synonyx_1.9.md', section: '4. Передача данных — Протоколы и режимы' },
  scopeFileMethods: { file: '01_scope_functions_synonyx_1.9.md', section: '5. Передача файлов — Способы передачи' },
  scopeFileSetup: { file: '01_scope_functions_synonyx_1.9.md', section: '5. Передача файлов — Как настраивается правило передачи файлов' },
  scopeChecks: { file: '01_scope_functions_synonyx_1.9.md', section: '5. Передача файлов — Проверки файлов' },
  scopeLimits: { file: '01_scope_functions_synonyx_1.9.md', section: '9. Ограничения' },
  scopeRulesLimit: { file: '01_scope_functions_synonyx_1.9.md', section: '3. Общие принципы правил' },
  scopeDevice: { file: '01_scope_functions_synonyx_1.9.md', section: '2. Как устроено устройство' },
  scopeVsNgfw: { file: '01_scope_functions_synonyx_1.9.md', section: '10. Отличия от NGFW и диода данных' },
} satisfies Record<string, SourceRef>;

export function uniqSources(list: SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  return list.filter((s) => {
    const k = s.file + '|' + s.section;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const MAX_RULES = 256;

/** Minimal managed-terminal interface. Deployment serves this self-hosted module only
 * at the approved private origin; no public Next route, storage, URL tokens or telemetry.
 * Managed-browser/certificate/physical privacy acceptance remains a deployment gate.
 */
type Lane = 'OPERATOR' | 'SUBJECT';
const operatorFields: Readonly<Record<string, readonly string[]>> = {
  context: [],
  register: ['enrollmentRef', 'appointmentRef', 'contactRef', 'approvalRef', 'currentPassword'],
  verify: ['caseId', 'expectedRevision', 'evidenceReceiptRef', 'currentPassword'],
  approve: ['caseId', 'expectedRevision', 'preNoticeReceiptRef', 'currentPassword'],
  pair: ['caseId', 'expectedRevision', 'currentPassword'],
  issue: ['caseId', 'expectedRevision', 'deliveryReceiptRef', 'currentPassword'],
  ready: ['caseId', 'currentPassword'],
  complete: ['caseId', 'expectedRevision', 'submissionRef', 'currentPassword'],
  cancel: ['caseId', 'expectedRevision', 'currentPassword'],
  outcome: ['caseId', 'currentPassword'],
  ack: ['caseId', 'noticeKind', 'expectedRevision', 'receiptRef', 'currentPassword'],
};
const subjectFields: Readonly<Record<string, readonly string[]>> = {
  context: ['pairingCode'],
  ticket: [],
  submit: ['newPassword'],
};
export function mountRecoveryTerminal(root: HTMLElement, lane: Lane, approvedOrigin: string) {
  const doc = root.ownerDocument,
    win = doc.defaultView;
  if (
    !win ||
    win.location.protocol !== 'https:' ||
    win.location.origin !== approvedOrigin ||
    !['OPERATOR', 'SUBJECT'].includes(lane)
  )
    throw new Error('RECOVERY_REJECTED');
  const fields = lane === 'OPERATOR' ? operatorFields : subjectFields;
  let csrf = '',
    ticket = '',
    busy = false;
  let request: AbortController | undefined;
  const inputs = new Map<string, HTMLInputElement>();
  const form = doc.createElement('form'),
    operation = doc.createElement('select'),
    status = doc.createElement('output'),
    submit = doc.createElement('button');
  submit.type = 'submit';
  submit.textContent = '确认执行';
  form.autocomplete = 'off';
  for (const name of Object.keys(fields)) {
    const option = doc.createElement('option');
    option.value = name;
    option.textContent = name;
    operation.append(option);
  }
  form.append(operation);
  for (const name of new Set(Object.values(fields).flat())) {
    const label = doc.createElement('label'),
      input = doc.createElement('input');
    label.textContent = name;
    input.name = name;
    input.type = name.endsWith('Password') ? 'password' : 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.maxLength = name.endsWith('Password') ? 1024 : 128;
    label.append(input);
    form.append(label);
    inputs.set(name, input);
  }
  form.append(submit, status);
  root.replaceChildren(form);
  const clear = () => {
    request?.abort();
    csrf = '';
    ticket = '';
    for (const input of inputs.values()) input.value = '';
    status.textContent = '上下文已清除';
  };
  const show = () => {
    for (const [name, input] of inputs)
      input.parentElement!.hidden = !fields[operation.value].includes(name);
  };
  operation.addEventListener('change', show);
  show();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    submit.disabled = true;
    const op = operation.value,
      body: Record<string, string> = {};
    for (const name of fields[op]) {
      const input = inputs.get(name)!;
      body[name] = input.value;
      if (name.endsWith('Password') || name === 'pairingCode') input.value = '';
    }
    if (lane === 'SUBJECT' && op === 'submit') body.ticket = ticket;
    request = new AbortController();
    const requestTimeout = win.setTimeout(() => request?.abort(), 30000);
    try {
      const response = await win.fetch('/_zhiban_recovery/v1/' + lane.toLowerCase() + '/' + op, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: request.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Zhiban-Request': 'manual-recovery-v1',
          ...(op === 'context' ? {} : { 'X-Zhiban-CSRF': csrf }),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        status.textContent = '请求被拒绝或服务不可用；不自动重试。必要时重新认证后查询 outcome。';
        return;
      }
      const result: unknown = await response.json();
      if (!result || typeof result !== 'object') throw new Error('RECOVERY_REJECTED');
      const r = result as Record<string, unknown>;
      if (op === 'context' && typeof r.csrf === 'string') csrf = r.csrf;
      if (lane === 'SUBJECT' && op === 'ticket') {
        ticket = typeof r.ticket === 'string' ? r.ticket : '';
        status.textContent = ticket ? '已领取票据，请本人私密设置密码' : '尚无可领取票据';
        return;
      }
      if (lane === 'OPERATOR')
        for (const [key, source] of [
          ['caseId', 'caseId'],
          ['expectedRevision', 'revision'],
          ['submissionRef', 'submissionRef'],
        ] as const) {
          if (typeof r[source] === 'string' && inputs.has(key))
            inputs.get(key)!.value = r[source] as string;
        }
      // Pairing locator is transient; no ticket/password/verifier is rendered to staff.
      status.textContent =
        lane === 'OPERATOR' && op === 'pair' && typeof r.pairingCode === 'string'
          ? r.pairingCode
          : typeof r.status === 'string'
            ? r.status
            : typeof r.state === 'string'
              ? r.state
              : '请求完成';
      if (op === 'cancel' || op === 'complete') {
        ticket = '';
      }
    } catch {
      status.textContent = '结果未知；不自动重试。工作人员应重新认证后查询 outcome。';
    } finally {
      win.clearTimeout(requestTimeout);
      request = undefined;
      for (const name of Object.keys(body)) body[name] = '';
      busy = false;
      submit.disabled = false;
    }
  });
  const timer = win.setTimeout(clear, 600000);
  win.addEventListener('pagehide', clear);
  const clearVisibleSecrets = () => {
    for (const [name, input] of inputs)
      if (name.endsWith('Password') || name === 'pairingCode') input.value = '';
    if (operation.value === 'pair') status.textContent = '';
  };
  win.addEventListener('blur', clearVisibleSecrets);
  return () => {
    win.clearTimeout(timer);
    win.removeEventListener('pagehide', clear);
    win.removeEventListener('blur', clearVisibleSecrets);
    clear();
    root.replaceChildren();
  };
}

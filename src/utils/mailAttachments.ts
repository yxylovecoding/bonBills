import { useMonthlyStore } from '../stores/monthlyStore';
import { getActiveSyncSecret } from './syncEngine';

type MailAttachmentPayload = {
  kind?: 'bill' | 'investment';
  fileName: string;
  contentType?: string;
  base64: string;
  subject?: string;
  uid?: number;
};

type BillAttachmentResponse = MailAttachmentPayload & {
  attachments?: MailAttachmentPayload[];
};

export type MailAttachment = {
  kind: 'bill' | 'investment';
  file: File;
  subject?: string;
  uid?: number;
};

function base64ToFile(base64: string, fileName: string, contentType?: string): File {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], fileName, { type: contentType || 'application/vnd.ms-excel' });
}

export async function fetchLatestMailAttachments(): Promise<MailAttachment[]> {
  const secret = getActiveSyncSecret();
  if (!secret) throw new Error('缺少同步密码');
  const lastInvestmentMailUid = useMonthlyStore.getState().records.reduce(
    (latest, record) => Math.max(latest, record.lastInvestmentMailUid ?? 0),
    0,
  );
  const query = lastInvestmentMailUid > 0 ? `?sinceInvestmentUid=${lastInvestmentMailUid}` : '';
  const response = await fetch(`/api/latest-bill-attachment${query}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || `HTTP ${response.status}`);
  }
  const body = await response.json() as BillAttachmentResponse;
  const attachments = body.attachments?.length ? body.attachments : [body];
  return attachments.map((attachment) => ({
    kind: attachment.kind === 'investment' ? 'investment' : 'bill',
    file: base64ToFile(attachment.base64, attachment.fileName, attachment.contentType),
    subject: attachment.subject,
    uid: attachment.uid,
  }));
}

/**
 * 3S Verse — automatic order invoice.
 *
 * Builds a complete InvoiceData straight from the DealerStore order lines,
 * so the customer's success screen can show the real invoice the moment the
 * order is placed — no manual step for the seller. Prices always come from
 * the catalog (launch offer included) via catalogInvoiceItem.
 */
import {
  INVOICE_DUE_DAYS,
  catalogInvoiceItem,
  dueDateISO,
  invoiceNumberFromRef,
  todayLong,
  type InvoiceData,
  type InvoiceItem,
} from './invoice';
import { isRecurringModel, type ModelId } from './catalog';

export interface AutoOrderLine {
  productId: string;
  model: ModelId;
  /** How many PCs this license covers. */
  pcs: number;
  qty: number;
}

export interface AutoOrderInput {
  ref: string;
  name: string;
  company?: string;
  email: string;
  notes?: string;
  lines: AutoOrderLine[];
}

export function buildOrderInvoice(input: AutoOrderInput): InvoiceData {
  const items = input.lines
    .map((l) => catalogInvoiceItem(l.productId, l.model, l.pcs, l.qty))
    .filter((i): i is InvoiceItem => i !== null);

  const recurring = input.lines.some((l) => isRecurringModel(l.model));
  const recurringNote = recurring
    ? `Monthly plans renew every month and annual plans renew every year until cancelled — reply to this email to cancel or switch to a lifetime license anytime. `
    : '';

  return {
    invoiceNo: invoiceNumberFromRef(input.ref),
    orderRef: input.ref,
    date: todayLong(),
    status: 'DUE',
    validUntil: dueDateISO(INVOICE_DUE_DAYS),
    customer: {
      name: input.name,
      company: input.company ?? '',
      email: input.email,
    },
    paymentNote: 'Bank transfer · Wise · PayPal · USDT — pay within 7 days',
    items,
    keys: [],
    notes:
      (input.notes ? `${input.notes}\n\n` : '') +
      recurringNote +
      `Pay by bank transfer, Wise, PayPal, or USDT — reply to Connect@3SVerse.com ` +
      `with your payment receipt and order reference ${input.ref}. ` +
      `License keys + download links are delivered right after payment is confirmed. ` +
      `This invoice auto-cancels if payment is not received within ${INVOICE_DUE_DAYS} days.`,
  };
}

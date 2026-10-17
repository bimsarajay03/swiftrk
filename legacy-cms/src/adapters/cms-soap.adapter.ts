/**
 * =============================================================================
 * CMS ADAPTER - canonical JSON <-> SOAP 1.1
 * =============================================================================
 *
 * Translates cms_* commands from the saga into SOAP envelopes, POSTs them to
 * the CMS endpoint and translates the XML reply (or SOAP Fault) back into the
 * canonical reply the saga expects.
 *
 *   orderId                    -> OrderRef
 *   customerId/Name/Email      -> Client/ClientId/ClientName/ClientEmail
 *   items[].productId/...      -> LineItems/Item/Sku/Description/Qty/UnitPrice
 *   totalPrice                 -> TotalAmount (2 dp, currency="LKR")
 *   <CmsOrderId>               -> cmsOrderId
 *   <Fault><detail><ErrorCode> -> error
 * =============================================================================
 */

import { Logger } from '@nestjs/common';
import {
  CMS_ACTIONS,
  SOAP_CONTENT_TYPE,
  XmlNode,
  buildEnvelope,
  child,
  parseEnvelope,
  textOf,
} from '../protocols/soap';
import { transportFailure } from './adapter-error';
import {
  BaseReply,
  CmsCancelOrderCommand,
  CmsCreateOrderCommand,
  CmsCreateOrderReply,
} from './commands';

export interface CmsSoapAdapterOptions {
  url: string;
  timeoutMs: number;
}

type SoapCallResult =
  | { ok: true; body: XmlNode }
  | { ok: false; error: string; message: string };

const money = (value: number) => (Number(value) || 0).toFixed(2);

export function toCreateOrderEnvelope(cmd: CmsCreateOrderCommand): string {
  return buildEnvelope({
    'cms:CreateOrderRequest': {
      'cms:OrderRef': cmd.orderId,
      'cms:Client': {
        'cms:ClientId': cmd.customerId,
        'cms:ClientName': cmd.customerName,
        'cms:ClientEmail': cmd.customerEmail,
      },
      'cms:LineItems': {
        'cms:Item': (cmd.items ?? []).map((item) => ({
          'cms:Sku': item.productId,
          'cms:Description': item.productName ?? '',
          'cms:Qty': item.quantity,
          'cms:UnitPrice': money(item.unitPrice ?? 0),
        })),
      },
      'cms:TotalAmount': {
        '#text': money(cmd.totalPrice),
        '@_currency': 'LKR',
      },
    },
  });
}

export function toCancelOrderEnvelope(cmd: CmsCancelOrderCommand): string {
  return buildEnvelope({
    'cms:CancelOrderRequest': {
      'cms:OrderRef': cmd.orderId,
      'cms:CmsOrderId': cmd.cmsOrderId ?? '',
    },
  });
}

export class CmsSoapAdapter {
  private readonly logger = new Logger(CmsSoapAdapter.name);

  constructor(private readonly options: CmsSoapAdapterOptions) {}

  async createOrder(cmd: CmsCreateOrderCommand): Promise<CmsCreateOrderReply> {
    const result = await this.call(
      CMS_ACTIONS.CreateOrder,
      toCreateOrderEnvelope(cmd),
    );
    if (!result.ok) {
      return { success: false, error: result.error, message: result.message };
    }

    const cmsOrderId = textOf(
      child(result.body, 'CreateOrderResponse', 'CmsOrderId'),
    );
    if (!cmsOrderId) {
      return {
        success: false,
        error: 'CMS_BAD_RESPONSE',
        message: 'CreateOrderResponse had no CmsOrderId',
      };
    }

    return {
      success: true,
      cmsOrderId,
      message: 'Order created in CMS (SOAP/XML)',
    };
  }

  async cancelOrder(cmd: CmsCancelOrderCommand): Promise<BaseReply> {
    const result = await this.call(
      CMS_ACTIONS.CancelOrder,
      toCancelOrderEnvelope(cmd),
    );
    if (!result.ok) {
      // Nothing to undo: compensation is idempotent.
      if (result.error === 'CMS_ORDER_NOT_FOUND') {
        return {
          success: true,
          message: 'Order not present in CMS; nothing to cancel',
        };
      }
      return { success: false, error: result.error, message: result.message };
    }

    return {
      success: true,
      message: 'Order cancelled in CMS (SOAP/XML compensating transaction)',
    };
  }

  private async call(
    action: string,
    envelope: string,
  ): Promise<SoapCallResult> {
    this.logger.debug(
      `→ POST ${this.options.url} SOAPAction ${action}\n${envelope}`,
    );

    let status: number;
    let text: string;
    try {
      const response = await fetch(this.options.url, {
        method: 'POST',
        headers: {
          'Content-Type': SOAP_CONTENT_TYPE,
          SOAPAction: `"${action}"`,
        },
        body: envelope,
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
      status = response.status;
      text = await response.text();
    } catch (err) {
      const failure = transportFailure('CMS', err);
      this.logger.warn(`✗ ${action}: ${failure.code} ${failure.message}`);
      return { ok: false, error: failure.code, message: failure.message };
    }

    this.logger.debug(`← HTTP ${status}\n${text}`);

    let parsed: ReturnType<typeof parseEnvelope>;
    try {
      parsed = parseEnvelope(text);
    } catch (err) {
      // Not SOAP at all: a proxy error page, or the service is down behind a gateway.
      const error = status >= 500 ? 'CMS_UNAVAILABLE' : 'CMS_BAD_RESPONSE';
      return {
        ok: false,
        error,
        message: `HTTP ${status}: ${(err as Error).message}`,
      };
    }

    // A Fault wins whatever the HTTP status (SOAP 1.1 sends faults with 500).
    if (parsed.fault) {
      return {
        ok: false,
        error: parsed.fault.errorCode ?? 'CMS_FAULT',
        message: `SOAP Fault ${parsed.fault.faultCode}: ${parsed.fault.faultString}`,
      };
    }

    if (status < 200 || status >= 300) {
      return {
        ok: false,
        error: 'CMS_BAD_RESPONSE',
        message: `Unexpected HTTP ${status} without a Fault`,
      };
    }

    return { ok: true, body: parsed.body };
  }
}

/**
 * =============================================================================
 * CMS SIMULATOR - SOAP 1.1 over HTTP
 * =============================================================================
 *
 * Stands in for the on-premise Client Management System.
 *
 *   POST /cms/soap   SOAPAction: urn:swifttrack:cms#CreateOrder | #CancelOrder
 *   GET  /health
 *
 * State is in memory:
 *   - CreateOrder is idempotent on OrderRef: a repeat returns the same CmsOrderId,
 *     so a redelivered saga message never creates a duplicate CMS order.
 *   - CancelOrder for an unknown CmsOrderId returns a Fault (CMS_ORDER_NOT_FOUND).
 *
 * Errors follow the SOAP 1.1 convention: HTTP 500 with a soapenv:Fault body.
 * =============================================================================
 */

import express, { Request, Response } from 'express';
import { Logger } from '@nestjs/common';
import {
  CMS_ACTIONS,
  SOAP_CONTENT_TYPE,
  XmlNode,
  buildEnvelope,
  buildFault,
  child,
  parseEnvelope,
  textOf,
} from '../protocols/soap';
import { RunningServer, listenHttp, randomInt } from './running-server';

export interface CmsServerOptions {
  port?: number;
}

export async function startCmsServer(
  options: CmsServerOptions = {},
): Promise<RunningServer> {
  const logger = new Logger('CMS-System');
  const ordersByRef = new Map<string, string>(); // OrderRef -> CmsOrderId
  const refsByCmsId = new Map<string, string>(); // CmsOrderId -> OrderRef

  const app = express();
  app.disable('x-powered-by');

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', system: 'CMS', orders: ordersByRef.size });
  });

  app.post(
    '/cms/soap',
    express.text({
      type: ['text/xml', 'application/soap+xml'],
      limit: '256kb',
    }),
    (req: Request, res: Response) => {
      const sendFault = (
        code: 'Client' | 'Server',
        text: string,
        errorCode?: string,
      ) => {
        logger.warn(`Fault ${errorCode ?? code}: ${text}`);
        res
          .status(500)
          .type(SOAP_CONTENT_TYPE)
          .send(buildFault(code, text, errorCode));
      };

      if (typeof req.body !== 'string' || req.body.length === 0) {
        return sendFault(
          'Client',
          'Expected a text/xml SOAP envelope',
          'CMS_BAD_REQUEST',
        );
      }

      let body: XmlNode;
      try {
        body = parseEnvelope(req.body).body;
      } catch (err) {
        return sendFault('Client', (err as Error).message, 'CMS_BAD_REQUEST');
      }

      // SOAPAction is usually quoted: "urn:swifttrack:cms#CreateOrder"
      const action = String(req.header('SOAPAction') ?? '').replace(
        /^"|"$/g,
        '',
      );

      if (
        action === CMS_ACTIONS.CreateOrder ||
        (!action && body.CreateOrderRequest)
      ) {
        return handleCreateOrder(body.CreateOrderRequest);
      }
      if (
        action === CMS_ACTIONS.CancelOrder ||
        (!action && body.CancelOrderRequest)
      ) {
        return handleCancelOrder(body.CancelOrderRequest);
      }
      return sendFault(
        'Client',
        `Unknown SOAPAction "${action}"`,
        'CMS_UNKNOWN_ACTION',
      );

      function handleCreateOrder(request: unknown) {
        const orderRef = textOf(child(request, 'OrderRef'));
        const lineItems = child(request, 'LineItems', 'Item');
        const items = Array.isArray(lineItems) ? lineItems : [];
        if (!orderRef || items.length === 0) {
          return sendFault(
            'Client',
            'OrderRef and at least one LineItems/Item are required',
            'CMS_VALIDATION_ERROR',
          );
        }

        let cmsOrderId = ordersByRef.get(orderRef);
        if (cmsOrderId) {
          logger.log(
            `CreateOrder ${orderRef}: already exists as ${cmsOrderId} (idempotent replay)`,
          );
        } else {
          cmsOrderId = `CMS-${Date.now()}-${String(randomInt(10000)).padStart(4, '0')}`;
          ordersByRef.set(orderRef, cmsOrderId);
          refsByCmsId.set(cmsOrderId, orderRef);
          logger.log(
            `CreateOrder ${orderRef}: created ${cmsOrderId} (${items.length} line items)`,
          );
        }

        res.type(SOAP_CONTENT_TYPE).send(
          buildEnvelope({
            'cms:CreateOrderResponse': {
              'cms:Status': 'ACCEPTED',
              'cms:CmsOrderId': cmsOrderId,
            },
          }),
        );
      }

      function handleCancelOrder(request: unknown) {
        const cmsOrderId = textOf(child(request, 'CmsOrderId'));
        const orderRef = cmsOrderId ? refsByCmsId.get(cmsOrderId) : undefined;
        if (!cmsOrderId || !orderRef) {
          return sendFault(
            'Client',
            `Unknown CmsOrderId ${cmsOrderId ?? '(missing)'}`,
            'CMS_ORDER_NOT_FOUND',
          );
        }

        refsByCmsId.delete(cmsOrderId);
        ordersByRef.delete(orderRef);
        logger.log(`CancelOrder ${cmsOrderId} (${orderRef}): cancelled`);

        res.type(SOAP_CONTENT_TYPE).send(
          buildEnvelope({
            'cms:CancelOrderResponse': {
              'cms:Status': 'CANCELLED',
              'cms:CmsOrderId': cmsOrderId,
            },
          }),
        );
      }
    },
  );

  return listenHttp(app, options.port ?? 0);
}

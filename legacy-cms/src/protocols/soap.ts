/**
 * =============================================================================
 * SOAP 1.1 CODEC (CMS)
 * =============================================================================
 *
 * Builds and parses SOAP envelopes for the CMS. Shared by the CMS adapter
 * (client side) and the CMS simulator (server side).
 *
 * Envelopes are built with fast-xml-parser's XMLBuilder, never with template
 * strings, so text such as "Smith & Sons <Ltd>" is escaped correctly.
 *
 * Parsing strips namespace prefixes (`removeNSPrefix`), so callers read
 * `body.CreateOrderResponse` whatever prefix the other side chose.
 * =============================================================================
 */

import { XMLBuilder, XMLParser } from 'fast-xml-parser';

export const SOAP_ENV_NS = 'http://schemas.xmlsoap.org/soap/envelope/';
export const CMS_NS = 'urn:swifttrack:cms';

export const CMS_ACTIONS = {
  CreateOrder: 'urn:swifttrack:cms#CreateOrder',
  CancelOrder: 'urn:swifttrack:cms#CancelOrder',
} as const;

export const SOAP_CONTENT_TYPE = 'text/xml; charset=utf-8';

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>\n';

/** Elements that are lists in the CMS schema, even when only one is present. */
const ARRAY_ELEMENTS = new Set(['Item']);

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  indentBy: '  ',
  suppressEmptyNode: true,
});

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  // Keep every value as a string: "0042" must not become 42.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ARRAY_ELEMENTS.has(name),
});

export type XmlNode = { [key: string]: unknown };

export interface SoapFault {
  faultCode: string;
  faultString: string;
  /** Application error code from <detail><cms:ErrorCode>, if present. */
  errorCode?: string;
}

export interface ParsedEnvelope {
  /** Contents of <Body>, namespace prefixes removed. */
  body: XmlNode;
  fault?: SoapFault;
}

export class SoapParseError extends Error {
  readonly name = 'SoapParseError';
}

/**
 * Wraps body content (keys already prefixed, e.g. `cms:CreateOrderRequest`)
 * in a SOAP 1.1 envelope that declares both the soapenv and cms namespaces.
 */
export function buildEnvelope(body: XmlNode): string {
  return (
    XML_DECLARATION +
    builder.build({
      'soapenv:Envelope': {
        '@_xmlns:soapenv': SOAP_ENV_NS,
        '@_xmlns:cms': CMS_NS,
        'soapenv:Header': '',
        'soapenv:Body': body,
      },
    })
  );
}

/** Builds a SOAP 1.1 Fault envelope. `faultCode` is `Client` or `Server`. */
export function buildFault(
  faultCode: 'Client' | 'Server',
  faultString: string,
  errorCode?: string,
): string {
  return buildEnvelope({
    'soapenv:Fault': {
      faultcode: `soapenv:${faultCode}`,
      faultstring: faultString,
      ...(errorCode ? { detail: { 'cms:ErrorCode': errorCode } } : {}),
    },
  });
}

/** Parses a SOAP envelope. Throws SoapParseError if it is not well-formed SOAP. */
export function parseEnvelope(xml: string): ParsedEnvelope {
  let doc: unknown;
  try {
    doc = parser.parse(xml, true);
  } catch (err) {
    throw new SoapParseError(`Malformed XML: ${(err as Error).message}`);
  }

  const body = child(doc, 'Envelope', 'Body');
  if (!body || typeof body !== 'object') {
    throw new SoapParseError('Missing soap:Envelope/soap:Body');
  }

  const fault = child(body, 'Fault');
  if (fault && typeof fault === 'object') {
    return {
      body: body as XmlNode,
      fault: {
        faultCode: textOf(child(fault, 'faultcode')) ?? 'Server',
        faultString:
          textOf(child(fault, 'faultstring')) ?? 'Unknown SOAP fault',
        errorCode: textOf(child(fault, 'detail', 'ErrorCode')) || undefined,
      },
    };
  }

  return { body: body as XmlNode };
}

/** Walks a parsed XML tree; returns undefined as soon as a step is missing. */
export function child(node: unknown, ...path: string[]): unknown {
  let current = node;
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as XmlNode)[key];
  }
  return current;
}

/** Text content of a parsed element (plain string, or `#text` when it has attributes). */
export function textOf(node: unknown): string | undefined {
  if (node === undefined || node === null) return undefined;
  if (typeof node === 'string') return node;
  if (typeof node === 'number' || typeof node === 'boolean')
    return String(node);
  if (typeof node === 'object' && '#text' in node) {
    return textOf((node as XmlNode)['#text']);
  }
  return undefined;
}

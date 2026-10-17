import {
  toCancelOrderEnvelope,
  toCreateOrderEnvelope,
} from '../adapters/cms-soap.adapter';
import { SoapParseError, buildFault, child, parseEnvelope } from './soap';

const ORDER = {
  orderId: 'ORD-1',
  customerId: 'CUST-001',
  customerName: 'Smith & Sons <Ltd>',
  customerEmail: 'jane@example.com',
  items: [
    { productId: 'PROD-001', productName: 'Box', quantity: 2, unitPrice: 1500 },
  ],
  totalPrice: 3000,
};

describe('SOAP codec', () => {
  it('builds the CreateOrder envelope byte for byte (golden)', () => {
    expect(toCreateOrderEnvelope(ORDER)).toBe(
      `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cms="urn:swifttrack:cms">
  <soapenv:Header/>
  <soapenv:Body>
    <cms:CreateOrderRequest>
      <cms:OrderRef>ORD-1</cms:OrderRef>
      <cms:Client>
        <cms:ClientId>CUST-001</cms:ClientId>
        <cms:ClientName>Smith &amp; Sons &lt;Ltd&gt;</cms:ClientName>
        <cms:ClientEmail>jane@example.com</cms:ClientEmail>
      </cms:Client>
      <cms:LineItems>
        <cms:Item>
          <cms:Sku>PROD-001</cms:Sku>
          <cms:Description>Box</cms:Description>
          <cms:Qty>2</cms:Qty>
          <cms:UnitPrice>1500.00</cms:UnitPrice>
        </cms:Item>
      </cms:LineItems>
      <cms:TotalAmount currency="LKR">3000.00</cms:TotalAmount>
    </cms:CreateOrderRequest>
  </soapenv:Body>
</soapenv:Envelope>
`,
    );
  });

  it('parses a single Item as an array and unescapes text', () => {
    const { body, fault } = parseEnvelope(toCreateOrderEnvelope(ORDER));
    expect(fault).toBeUndefined();

    const items = child(body, 'CreateOrderRequest', 'LineItems', 'Item');
    expect(Array.isArray(items)).toBe(true);
    expect(items).toHaveLength(1);
    expect(child(body, 'CreateOrderRequest', 'Client', 'ClientName')).toBe(
      'Smith & Sons <Ltd>',
    );
  });

  it('parses several Items in order', () => {
    const xml = toCreateOrderEnvelope({
      ...ORDER,
      items: [
        { productId: 'A', quantity: 1, unitPrice: 1 },
        { productId: 'B', quantity: 2, unitPrice: 2 },
        { productId: 'C', quantity: 3, unitPrice: 3 },
      ],
    });
    const items = child(
      parseEnvelope(xml).body,
      'CreateOrderRequest',
      'LineItems',
      'Item',
    ) as Array<{ Sku: string; Qty: string }>;
    expect(items.map((i) => `${i.Sku}:${i.Qty}`)).toEqual([
      'A:1',
      'B:2',
      'C:3',
    ]);
  });

  it('keeps values as strings (no "0042" -> 42)', () => {
    const xml = toCancelOrderEnvelope({ orderId: 'ORD-1', cmsOrderId: '0042' });
    expect(
      child(parseEnvelope(xml).body, 'CancelOrderRequest', 'CmsOrderId'),
    ).toBe('0042');
  });

  it('reads a fault, including the application error code', () => {
    const parsed = parseEnvelope(
      buildFault('Client', 'Unknown CmsOrderId X', 'CMS_ORDER_NOT_FOUND'),
    );
    expect(parsed.fault).toEqual({
      faultCode: 'soapenv:Client',
      faultString: 'Unknown CmsOrderId X',
      errorCode: 'CMS_ORDER_NOT_FOUND',
    });
  });

  it('reads a fault whatever namespace prefix the server used', () => {
    const xml = `<?xml version="1.0"?>
      <S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/">
        <S:Body><S:Fault><faultcode>S:Server</faultcode><faultstring>boom</faultstring></S:Fault></S:Body>
      </S:Envelope>`;
    expect(parseEnvelope(xml).fault).toEqual({
      faultCode: 'S:Server',
      faultString: 'boom',
      errorCode: undefined,
    });
  });

  it('rejects malformed XML and non-SOAP documents', () => {
    expect(() => parseEnvelope('<oops>')).toThrow(SoapParseError);
    expect(() => parseEnvelope('<html><body>502</body></html>')).toThrow(
      SoapParseError,
    );
  });
});

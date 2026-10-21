import https from 'node:https';
import { lookup } from 'node:dns';
import { isIP } from 'node:net';

/** Reject non-public addresses at the socket's DNS lookup, not in a separate
 * preflight lookup (which would allow DNS rebinding between check and use).
 * IPv6 is deliberately restricted to global unicast, excluding mapped IPv4.
 */
export function publicAiAddress(address: string): boolean {
  if (isIP(address) === 6)
    return /^[23][0-9a-f]{3}:/i.test(address) && !address.toLowerCase().startsWith('2001:db8:');
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || b === 2)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}
export type VisionTransport = (
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
) => Promise<{ status: number; data: unknown }>;
/** No redirect following, bounded response bytes, and the caller's deadline
 * covers DNS, TLS, headers and body. Provider bodies are never error messages.
 */
export const visionTransport: VisionTransport = (url, headers, body, signal) =>
  new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: 'POST',
        headers,
        signal,
        lookup(host, options, callback) {
          lookup(host, { all: true }, (error, addresses) => {
            if (error) {
              callback(error, [], 0);
              return;
            }
            if (!addresses.length || addresses.some((item) => !publicAiAddress(item.address))) {
              callback(new Error('Non-public AI destination'), [], 0);
              return;
            }
            if (options.all) callback(null, addresses);
            else callback(null, addresses[0].address, addresses[0].family);
          });
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('error', reject);
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 64 * 1024) {
            request.destroy(new Error('AI response too large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          // HTTP backoff must work even when a gateway sends an HTML/plain-text
          // error page. Only successful responses need a JSON payload.
          if ((response.statusCode ?? 0) < 200 || (response.statusCode ?? 0) >= 300) {
            resolve({ status: response.statusCode ?? 0, data: null });
            return;
          }
          try {
            resolve({
              status: response.statusCode ?? 0,
              data: JSON.parse(Buffer.concat(chunks).toString('utf8')),
            });
          } catch {
            reject(new Error('Invalid AI response'));
          }
        });
      },
    );
    request.on('error', reject);
    request.end(JSON.stringify(body));
  });

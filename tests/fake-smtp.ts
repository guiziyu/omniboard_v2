import { createServer, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
// 测试用 SMTP 服务器:明文、AUTH PLAIN,记录收到的邮件(不支持 STARTTLS,连接串要写 ?requireTLS=false)。
export type Mail = { auth?: string; from: string; to: string[]; subject: string; text: string };

function decode(body: string, encoding: string) {
  if (encoding === 'base64') return Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8');
  if (encoding === 'quoted-printable')
    return Buffer.from(
      body
        .replace(/=\r\n/g, '')
        .replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))),
      'latin1',
    ).toString('utf8');
  return body;
}
/** 头部的 RFC 2047 编码词(非 ASCII 的标题),相邻编码词之间的空白不保留。 */
const decodeHeader = (value: string) =>
  value
    .replace(/(\?=)\s+(=\?)/g, '$1$2')
    .replace(/=\?UTF-8\?([QB])\?([^?]*)\?=/gi, (_, kind: string, text: string) =>
      kind.toUpperCase() === 'B'
        ? Buffer.from(text, 'base64').toString('utf8')
        : decode(text.replace(/_/g, ' '), 'quoted-printable'),
    );
function parse(envelope: Omit<Mail, 'subject' | 'text'>, data: string): Mail {
  const split = data.indexOf('\r\n\r\n');
  const headers = new Map<string, string>();
  for (const line of data
    .slice(0, split)
    .replace(/\r\n[ \t]+/g, ' ')
    .split('\r\n')) {
    const colon = line.indexOf(':');
    headers.set(line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim());
  }
  const text = decode(
    data.slice(split + 4),
    headers.get('content-transfer-encoding') ?? '7bit',
  ).replace(/\r\n$/, '');
  return {
    ...envelope,
    subject: decodeHeader(headers.get('subject') ?? ''),
    text: text.replace(/\r\n/g, '\n'),
  };
}
export async function fakeSmtp(options: { onMail?: (mail: Mail) => void } = {}) {
  const mails: Mail[] = [];
  const state = { rejectRecipients: false, silent: false };
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    if (state.silent) return; // 不发问候:客户端应当超时
    const say = (line: string) => socket.write(`${line}\r\n`);
    let envelope: Omit<Mail, 'subject' | 'text'> = { from: '', to: [] };
    let data: string | null = null;
    let buffer = '';
    say('220 fake.test ESMTP');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1');
      for (let end; (end = buffer.indexOf('\r\n')) >= 0;) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data !== null) {
          if (line !== '.') {
            data += `${line.startsWith('..') ? line.slice(1) : line}\r\n`;
            continue;
          }
          const mail = parse(envelope, data);
          mails.push(mail);
          options.onMail?.(mail);
          data = null;
          envelope = { auth: envelope.auth, from: '', to: [] };
          say('250 2.0.0 Queued');
          continue;
        }
        const address = () => /<([^>]*)>/.exec(line)?.[1] ?? '';
        switch (line.split(' ')[0]!.toUpperCase()) {
          case 'EHLO':
            say('250-fake.test');
            say('250 AUTH PLAIN');
            break;
          case 'AUTH': {
            const [, user, pass] = Buffer.from(line.split(' ')[2]!, 'base64')
              .toString('utf8')
              .split('\0');
            envelope.auth = `${user}:${pass}`;
            say('235 2.7.0 Authentication successful');
            break;
          }
          case 'MAIL':
            envelope.from = address();
            say('250 2.1.0 OK');
            break;
          case 'RCPT':
            if (state.rejectRecipients) say('550 5.1.1 Mailbox unavailable');
            else {
              envelope.to.push(address());
              say('250 2.1.5 OK');
            }
            break;
          case 'DATA':
            data = '';
            say('354 End data with <CR><LF>.<CR><LF>');
            break;
          case 'RSET':
            envelope = { auth: envelope.auth, from: '', to: [] };
            say('250 2.0.0 OK');
            break;
          case 'QUIT':
            say('221 2.0.0 Bye');
            socket.end();
            break;
          default:
            say('502 5.5.2 Command not implemented');
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    mails,
    state,
    url: (query = '?requireTLS=false') => `smtp://mailer:s3cret@127.0.0.1:${port}${query}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

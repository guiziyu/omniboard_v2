import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { setTimeout as sleep } from 'node:timers/promises';
import { problem } from './auth';
import { directoryStore, verified, type EvidenceStore } from './evidence';
// S3 证据桶(proposal §2、data-model §1):私有桶,键 evidence/<sha256>。版本控制、默认加密与禁止公开访问
// 在桶上配置(owner)。凭据走 SDK 默认链,生产是 EC2 实例角色,不放长期密钥。

export type StoreConfig = { bucket: string; region: string } | { dir: string };

const status = (error: unknown) =>
  error instanceof S3ServiceException ? error.$metadata.httpStatusCode : undefined;

export function s3Store(bucket: string, clientConfig: S3ClientConfig): EvidenceStore {
  // 完整性由 sha256 自己把关:上传带 SHA-256 校验和,读回再算一次;不需要 SDK 额外的 CRC32。
  const client = new S3Client({
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    ...clientConfig,
  });
  const key = (sha: string) => `evidence/${sha}`;
  return {
    async put(sha, bytes, contentType) {
      for (let attempt = 1; ; attempt++) {
        try {
          await client.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: key(sha),
              Body: bytes,
              ContentType: contentType,
              // S3 校验收到的内容与 sha256 一致,不一致拒收(BadDigest)。
              ChecksumSHA256: Buffer.from(sha, 'hex').toString('base64'),
              // 同内容只写一次:已有对象返回 412,版本化的桶里不堆重复版本。
              IfNoneMatch: '*',
            }),
          );
          return;
        } catch (error) {
          if (status(error) === 412) return;
          // 409:同一键上另一个条件写入尚未完成,稍后重试。
          if (status(error) === 409 && attempt < 3) {
            await sleep(200 * attempt);
            continue;
          }
          throw error;
        }
      }
    },
    async get(sha) {
      let bytes: Buffer;
      try {
        const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key(sha) }));
        bytes = Buffer.from(await object.Body!.transformToByteArray());
      } catch (error) {
        // 需要 s3:ListBucket,缺失的对象才返回 404 而不是 403(README)。
        if (status(error) === 404) problem(404, 'The original file is missing from storage.');
        throw error;
      }
      return verified(sha, bytes);
    },
  };
}

export function openStore(config: StoreConfig): EvidenceStore {
  return 'dir' in config
    ? directoryStore(config.dir)
    : s3Store(config.bucket, { region: config.region });
}

export const describeStore = (config: StoreConfig) =>
  'dir' in config ? `local directory ${config.dir}` : `S3 bucket ${config.bucket}`;
